/**
 * The mixer: three channels (voice, nav, bed) and the rules that stop them talking over each other.
 *
 * THE VOICE CHANNEL is a small state machine, one entry at a time (`voice`), plus at most one `retiring` entry that is
 * fading out after a stop or a replacement. The phases of an entry:
 *
 *   loading  the clip is not sounding yet (it waits for the nav channel, the 250 ms resume delay or a retiring clip)
 *   in       fading in (0.20 s), the clip is sounding
 *   playing  sounding at full level. A "plan" may be armed here: the narration is running on to a phrase break so
 *            that a cue can speak at the end of a sentence
 *   out      fading out (0.15 s) for a reason: "nav" (a cue wants the channel), "pause" (the rider), "seek"
 *   silent   faded out and paused, holding a `cut`: where it will resume. Held by nav, by the rider, or both
 *
 *   loading --reconcile--> in --0.20 s--> playing
 *   in | playing --nav arrives, urgent or no break within 3 s--> out(nav) --0.15 s--> silent
 *   playing --nav arrives, break b within 3 s--> plan --clip reaches b - 0.20--> out(nav) (silent by b - 0.05) --> silent
 *   plan --urgent nav arrives--> out(nav) at once
 *   in | playing --rider pause--> out(pause) --> silent        silent --rider resume--> (reconcile) in
 *   in | playing --seekVoice--> out(seek) --> silent(exact target) --> (reconcile) in
 *   silent --nav queue empty for 250 ms, rider not paused--> in, from the cut's resume position
 *   any --stopVoice / playVoice--> `retiring`, fading out; the new clip waits until it is silent
 *   in | playing | out --clip ends--> done
 *
 * Only `reconcile` ever starts sound (a nav entry or the voice), and it starts the voice only when nothing is on the
 * nav channel, the 250 ms resume delay is over and nothing is retiring. A nav entry starts only when the voice is
 * silent (loading, silent or absent) and nothing is retiring. So two speech sounds are never on at once; the fuzz
 * test in tests/unit/mixer.test.ts checks it on the sound timeline.
 *
 * Resume positions (`cut`): after a break yield, 0.25 s before that break. After an immediate cut at c, the last break
 * at or before c within 6 s (0.25 s before it), else 1.5 s before c. After the rider's pause, c itself, or the replay
 * point when the pause lasted over 20 s on the mixer clock. After a seek, the target exactly.
 *
 * THE NAV CHANNEL is a FIFO of cues and signals (at most three waiting) on two elements used in turn, so that the
 * next entry is loaded while the current one plays and a distance call and its cue sound as one utterance.
 */
import type { Mixer, MixerOptions, PlayHandle, SignalName, SoundEvent } from "../types";
import { type BedEmit, type LayerKind, createBed } from "./bed";
import catalogue from "./catalogue.json";
import { type Clip, type ClipFactory, elementClipFactory, prepareElement, silentWavUri, virtualClipFactory } from "./clips";
import type { Fader } from "./graph";

/** The mixer plus a view of the bed, so tests can see what the director asked for. */
export interface MixerWithBed extends Mixer {
  readonly bed: { ambience: string | null; music: string | null } | null;
  /** How many times `tick` has been called (any mode), for tests. */
  readonly ticks: number;
  /** The level last given to `setBedLevel`; 1 until then. */
  readonly bedLevel: number;
  /** Everything heard so far, oldest first (at most 5000 entries). Also `window.__verstaAudio.timeline()` in real mode. */
  readonly timeline: readonly SoundEvent[];
  /** The distinct `preload` requests so far, in order. */
  readonly preloaded: readonly string[];
}

interface Deferred { promise: Promise<void>; resolve(): void; reject(reason: "stopped" | "error"): void; settled: boolean }

function deferred(): Deferred {
  const d = { settled: false } as Deferred;
  d.promise = new Promise<void>((res, rej) => {
    d.resolve = () => { if (!d.settled) { d.settled = true; res(); } };
    d.reject = (r) => { if (!d.settled) { d.settled = true; rej(r); } };
  });
  // callers may ignore `done`; a stopped clip is not an unhandled rejection
  d.promise.catch(() => {});
  return d;
}

type Phase = "loading" | "in" | "playing" | "out" | "silent";
type Reason = "nav" | "pause" | "seek";
interface Cut { kind: "cut" | "break" | "pause" | "exact"; pos: number; at: number }

interface VoiceEntry {
  src: string;
  est: number | undefined;
  onTime: ((s: number) => void) | undefined;
  breaks: number[];
  def: Deferred;
  clip: Clip | null;
  phase: Phase;
  reason: Reason | null;
  cut: Cut | null;
  seekTarget: number | null;
  userPause: boolean;
  /** An `on` is on the timeline without its `off`. */
  sounding: boolean;
  /** Cancels the pending fade-in or fade-out step. */
  timer: (() => void) | undefined;
  /** Cancels the armed yield to a break. */
  plan: (() => void) | null;
}

interface NavEntry {
  kind: "clip" | "signal";
  /** Pack-relative or absolute clip path, or the signal's file path. */
  path: string;
  /** What the timeline calls it: the clip path or the signal name. */
  label: string;
  est: number | undefined;
  urgent: boolean;
  def: Deferred;
  clip: Clip | null;
}

const FADE_OUT = 0.15;
const FADE_IN = 0.2;
/** A yield fades out from 0.20 s to 0.05 s before the phrase onset; a resume starts 0.25 s before it. */
const YIELD_LEAD = 0.2;
const RESUME_LEAD = 0.25;
const MAX_WAIT = 3;
const MAX_REPLAY = 6;
const STEP_BACK = 1.5;
const LONG_PAUSE_MS = 20_000;
const RESUME_DELAY_S = 0.25;
const NAV_QUEUE_MAX = 3;
const DEFAULT_FADE = 1;
const BED_IN_NEW = 3;
const BED_CROSSFADE = 2.5;
const TIMELINE_MAX = 5000;

const SIGNAL_SECONDS: Record<string, number> = Object.fromEntries(Object.entries(catalogue.signals).map(([k, v]) => [k, v.seconds]));
const EFFECT_SECONDS: Record<string, number> = Object.fromEntries(Object.entries(catalogue.effects).map(([k, v]) => [k, v.seconds]));

export function createMixer(opts: MixerOptions): MixerWithBed {
  const timeScale = opts.timeScale && opts.timeScale > 0 ? opts.timeScale : 1;
  const real = !opts.virtual && typeof Audio !== "undefined";
  /** Fades and delays take this many times less real time in virtual mode. */
  const scale = real ? 1 : timeScale;
  const clock = opts.clock ?? Date.now;
  const siteBase = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";

  const timeline: SoundEvent[] = [];
  const logEvent = (ch: SoundEvent["ch"], ev: "on" | "off", src: string, pos?: number): void => {
    const e: SoundEvent = { at: clock(), ch, ev, src };
    if (pos !== undefined) e.pos = pos;
    timeline.push(e);
    if (timeline.length > TIMELINE_MAX) timeline.shift();
  };

  const bedEmit: BedEmit = (ch, ev, src) => logEvent(ch, ev, src);
  const bed = createBed({ emit: bedEmit, timeline: () => timeline });
  let bedState: { ambience: string | null; music: string | null } | null = null;
  const layerNow: Record<LayerKind, string | null> = { ambience: null, music: null };
  let tickCount = 0;
  let bedLevel = 1;
  let disposed = false;
  const preloaded: string[] = [];
  const preloadSeen = new Set<string>();

  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** A timer that dispose cancels. Returns its cancel function. */
  function after(ms: number, fn: () => void): () => void {
    const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, ms));
    timers.add(t);
    return () => { clearTimeout(t); timers.delete(t); };
  }
  /** Seconds of fade, delay or clip time as milliseconds of real time. */
  const ms = (seconds: number): number => (seconds * 1000) / scale;

  const resolveUrl = (src: string): string => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src) ? src : opts.baseUrl + src);

  /* ------------------------------------------------------------ elements, factories, the voice fader */

  let routed = false;
  let voiceEl: HTMLAudioElement | null = null;
  const navEls: HTMLAudioElement[] = [];
  let voiceFactory: ClipFactory;
  const navFactories: ClipFactory[] = [];
  if (real) {
    voiceEl = new Audio();
    voiceEl.preload = "auto";
    voiceFactory = elementClipFactory(voiceEl, resolveUrl);
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = "auto";
      navEls.push(el);
      navFactories.push(elementClipFactory(el, resolveUrl));
    }
  } else {
    voiceFactory = virtualClipFactory(timeScale);
    navFactories.push(virtualClipFactory(timeScale));
  }

  /** Where an element is not routed through Web Audio the fade is element.volume in small steps (iOS ignores it). */
  let volTimer: ReturnType<typeof setInterval> | undefined;
  let vol = 1;
  const voiceFader: Fader = {
    set(v) {
      if (!real) return;
      if (routed && bed.graph) { bed.graph.voiceFader.set(v); return; }
      clearInterval(volTimer);
      vol = v;
      if (voiceEl) voiceEl.volume = v;
    },
    ramp(to, seconds) {
      if (!real) return;
      if (routed && bed.graph) { bed.graph.voiceFader.ramp(to, seconds); return; }
      clearInterval(volTimer);
      const from = vol, t0 = Date.now();
      volTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / (seconds * 1000));
        vol = from + (to - from) * k;
        if (voiceEl) voiceEl.volume = Math.max(0, Math.min(1, vol));
        if (k >= 1) clearInterval(volTimer);
      }, 20);
    },
  };

  /* ------------------------------------------------------------ shared state */

  let voice: VoiceEntry | null = null;
  let retiring: VoiceEntry | null = null;
  let navCurrent: NavEntry | null = null;
  const navWaiting: NavEntry[] = [];
  let navIdx = 0;
  let resumeTimer: (() => void) | null = null;

  /** Where the elements are not routed through Web Audio, tell the bed's pocket when speech is sounding. */
  function updateDuck(): void {
    const speaking = navCurrent !== null || retiring !== null || (voice !== null && (voice.phase === "in" || voice.phase === "playing" || voice.phase === "out"));
    bed.graph?.hint(speaking);
  }

  const voiceSilent = (): boolean => retiring === null && (voice === null || voice.phase === "loading" || voice.phase === "silent");

  /* ------------------------------------------------------------ the voice state machine */

  function logVoice(v: VoiceEntry, ev: "on" | "off"): void {
    if (ev === "on") v.sounding = true;
    else { if (!v.sounding) return; v.sounding = false; }
    logEvent("voice", ev, v.src, v.clip?.position() ?? 0);
  }

  function clearTimers(v: VoiceEntry): void {
    v.timer?.();
    v.timer = undefined;
    v.plan?.();
    v.plan = null;
  }

  /** Where the last break at or before `c` lies within 6 s: 0.25 s before it; else 1.5 s before `c`. */
  function replayPoint(v: VoiceEntry, c: number): number {
    let best: number | undefined;
    for (const b of v.breaks) { if (b <= c) best = b; else break; }
    if (best !== undefined && c - best <= MAX_REPLAY) return Math.max(0, best - RESUME_LEAD);
    return Math.max(0, c - STEP_BACK);
  }

  function resumePosition(v: VoiceEntry): number {
    const c = v.cut;
    if (!c) return v.clip?.position() ?? 0;
    switch (c.kind) {
      case "break": return Math.max(0, c.pos - RESUME_LEAD);
      case "cut": return replayPoint(v, c.pos);
      case "pause": return clock() - c.at > LONG_PAUSE_MS ? replayPoint(v, c.pos) : c.pos;
      case "exact": return c.pos;
    }
  }

  function ensureClip(v: VoiceEntry): Clip {
    if (!v.clip) {
      v.clip = voiceFactory(v.src, v.est, {
        onTime: v.onTime,
        onEnd: () => voiceEnded(v, "end"),
        onError: () => voiceEnded(v, "error"),
      });
    }
    return v.clip;
  }

  /** Start the fade in, from the start of the clip or from `from`. */
  function startSound(v: VoiceEntry, from?: number): void {
    const clip = ensureClip(v);
    if (routed) bed.ensure(); // resumes the context if the system suspended it
    if (from !== undefined) { clip.seekTo(from); v.onTime?.(from); }
    voiceFader.set(0);
    clip.play();
    voiceFader.ramp(1, FADE_IN);
    v.phase = "in";
    v.reason = null;
    v.cut = null;
    logVoice(v, "on");
    v.timer = after(ms(FADE_IN), () => { v.timer = undefined; if (voice === v && v.phase === "in") v.phase = "playing"; });
    updateDuck();
  }

  function fadeOut(v: VoiceEntry, reason: Reason, cut: Cut): void {
    clearTimers(v);
    v.cut = cut;
    v.reason = reason;
    v.phase = "out";
    voiceFader.ramp(0, FADE_OUT);
    v.timer = after(ms(FADE_OUT), () => finishOut(v));
  }

  function finishOut(v: VoiceEntry): void {
    v.timer = undefined;
    if (voice !== v || v.phase !== "out") return;
    v.clip?.pause();
    logVoice(v, "off");
    v.phase = "silent";
    if (v.reason === "seek") v.cut = { kind: "exact", pos: v.seekTarget ?? v.clip?.position() ?? 0, at: clock() };
    v.seekTarget = null;
    v.reason = null;
    updateDuck();
    reconcile();
  }

  const cutNow = (v: VoiceEntry, kind: Cut["kind"]): Cut => ({ kind, pos: v.clip?.position() ?? 0, at: clock() });

  /** The nav channel wants to speak: make the voice yield, at a break when there is time, else at once. */
  function demandYield(urgent: boolean): void {
    const v = voice;
    if (!v || retiring) return;
    if (v.phase !== "in" && v.phase !== "playing") return; // silent, loading or already fading: nav goes when it is silent
    if (v.plan) {
      if (urgent) { v.plan(); v.plan = null; fadeOut(v, "nav", cutNow(v, "cut")); }
      return;
    }
    const pos = v.clip?.position() ?? 0;
    const b = v.breaks.find((x) => x - YIELD_LEAD >= pos);
    if (urgent || b === undefined || b - pos > MAX_WAIT) { fadeOut(v, "nav", cutNow(v, "cut")); return; }
    const attempt = (): void => {
      v.plan = null;
      if (voice !== v || (v.phase !== "playing" && v.phase !== "in")) return;
      const left = b - YIELD_LEAD - (v.clip?.position() ?? 0);
      if (left > 0.03) { v.plan = after(ms(left), attempt); return; }
      fadeOut(v, "nav", { kind: "break", pos: b, at: clock() });
    };
    v.plan = after(ms(Math.max(0, b - YIELD_LEAD - pos)), attempt);
  }

  /** The clip ended by itself or failed. */
  function voiceEnded(v: VoiceEntry, how: "end" | "error"): void {
    if (v === retiring) {
      clearTimers(v);
      retiring = null;
      logVoice(v, "off");
      updateDuck();
      reconcile();
      return;
    }
    if (voice !== v) return;
    clearTimers(v);
    voice = null;
    logVoice(v, "off");
    if (how === "end") v.def.resolve(); else v.def.reject("error");
    updateDuck();
    reconcile();
  }

  /** Let go of a voice entry that was stopped or replaced: its `done` rejects at once, its sound fades over `fade`. */
  function retire(v: VoiceEntry, fade: number): void {
    clearTimers(v);
    v.def.reject("stopped");
    if (v.phase === "loading" || v.phase === "silent") { v.clip?.dispose(); return; }
    retiring = v;
    v.phase = "out";
    voiceFader.ramp(0, fade);
    v.timer = after(ms(fade), () => {
      v.timer = undefined;
      v.clip?.dispose();
      logVoice(v, "off");
      if (retiring === v) retiring = null;
      updateDuck();
      reconcile();
    });
    updateDuck();
  }

  /** Start whatever should be sounding next. The only place that starts a nav entry or the voice. */
  function reconcile(): void {
    if (disposed || navCurrent) return;
    if (navWaiting.length) {
      if (voiceSilent()) startNextNav();
      return;
    }
    if (resumeTimer || retiring) return;
    const v = voice;
    if (!v) { updateDuck(); return; }
    if (v.userPause) return;
    if (v.phase === "loading") startSound(v);
    else if (v.phase === "silent") startSound(v, resumePosition(v));
  }

  /* ------------------------------------------------------------ the nav channel */

  const signalPath = (name: string): string => `${siteBase}sounds/signals/${name}.mp3`;

  /** A settled entry: signals only ever resolve (a signal that fails to load counts as sounded). */
  function settle(e: NavEntry, how: "end" | "error" | "stopped"): void {
    if (how === "end" || e.kind === "signal") e.def.resolve();
    else e.def.reject(how);
  }

  function prepareNext(): void {
    const next = navWaiting[0];
    if (!real || !next) return;
    const el = navEls[navIdx ^ 1];
    if (el) prepareElement(el, resolveUrl(next.path));
  }

  function startNextNav(): void {
    resumeTimer?.();
    resumeTimer = null;
    const e = navWaiting.shift();
    if (!e) return;
    navCurrent = e;
    const cb = { onEnd: () => finishNav(e, "end"), onError: () => finishNav(e, "error") };
    if (real) navIdx ^= 1;
    const factory = navFactories[real ? navIdx : 0]!;
    e.clip = factory(e.path, e.est, cb);
    logEvent(e.kind === "signal" ? "signal" : "nav", "on", e.label);
    updateDuck();
    e.clip.play();
    prepareNext();
  }

  function finishNav(e: NavEntry, how: "end" | "error" | "stopped"): void {
    if (navCurrent !== e) return;
    navCurrent = null;
    if (how === "stopped") e.clip?.dispose();
    logEvent(e.kind === "signal" ? "signal" : "nav", "off", e.label);
    settle(e, how);
    if (navWaiting.length) {
      startNextNav();
    } else {
      // the voice comes back 250 ms after the queue empties
      resumeTimer = after(ms(RESUME_DELAY_S), () => { resumeTimer = null; reconcile(); });
      updateDuck();
    }
  }

  function enqueue(e: NavEntry): void {
    if (disposed) { settle(e, "stopped"); return; }
    navWaiting.push(e);
    while (navWaiting.length > NAV_QUEUE_MAX) { const dropped = navWaiting.shift(); if (dropped) settle(dropped, "stopped"); }
    demandYield(e.urgent);
    reconcile();
    prepareNext();
  }

  /** The queue emptied while the voice was only waiting for its break: carry on. */
  function navGaveUp(): void {
    if (navCurrent || navWaiting.length) return;
    const v = voice;
    if (v?.plan) { v.plan(); v.plan = null; }
    reconcile();
  }

  /* ------------------------------------------------------------ the bed */

  function setLayer(kind: LayerKind, name: string | null): void {
    const cur = layerNow[kind];
    if (name === cur) return; // the same layer keeps playing: no restart, no fade
    layerNow[kind] = name;
    const fadeIn = cur === null ? BED_IN_NEW : BED_CROSSFADE;
    if (real) { bed.setLayer(kind, name, fadeIn, BED_CROSSFADE); return; }
    if (cur !== null) after(ms(BED_CROSSFADE), () => logEvent(kind, "off", cur));
    if (name !== null) logEvent(kind, "on", name);
  }

  /* ------------------------------------------------------------ the mixer */

  const stoppedHandle = (): PlayHandle => {
    const d = deferred();
    d.reject("stopped");
    return { done: d.promise, stop() {} };
  };

  const mixer: MixerWithBed = {
    async unlock() {
      if (!real || disposed) return;
      if (bed.ensure() && bed.graph) {
        // route the elements through Web Audio, but only if the context really runs: otherwise play them directly
        const ctx = bed.graph.synth.ctx;
        if (ctx.state !== "running") {
          try { await Promise.race([ctx.resume(), new Promise<void>((res) => setTimeout(res, 1000))]); } catch {}
        }
        if (ctx.state === "running" && !routed) {
          routed = true;
          if (voiceEl && !bed.graph.route(voiceEl, "voice")) routed = false;
          for (const el of navEls) if (routed && !bed.graph.route(el, "nav")) routed = false;
        }
        bed.preload();
      }
      const uri = silentWavUri();
      for (const el of [voiceEl, ...navEls]) {
        if (!el) continue;
        try {
          prepareElement(el, uri);
          await el.play();
          el.pause();
        } catch {
          // priming is best effort: a failure shows up later as a clip error
        }
      }
    },

    playVoice(src, o): PlayHandle {
      if (disposed) return stoppedHandle();
      const old = voice;
      voice = null;
      if (old) retire(old, FADE_OUT);
      const breaks = (o?.breaks ?? []).filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b);
      const entry: VoiceEntry = {
        src, est: o?.estimatedSeconds, onTime: o?.onTime, breaks, def: deferred(), clip: null, phase: "loading", reason: null,
        cut: null, seekTarget: null, userPause: false, sounding: false, timer: undefined, plan: null,
      };
      voice = entry;
      reconcile();
      return { done: entry.def.promise, stop: () => { if (voice === entry) mixer.stopVoice(); } };
    },
    pauseVoice() {
      const v = voice;
      if (!v || v.userPause) return;
      v.userPause = true;
      if (v.phase === "in" || v.phase === "playing") fadeOut(v, "pause", cutNow(v, "pause"));
      else if (v.cut?.kind === "pause") v.cut.at = clock();
    },
    resumeVoice() {
      const v = voice;
      if (!v || !v.userPause) return;
      v.userPause = false;
      reconcile();
    },
    stopVoice(fadeSeconds = FADE_OUT) {
      const v = voice;
      if (!v) return;
      voice = null;
      retire(v, Math.max(0.02, fadeSeconds));
      updateDuck();
      reconcile();
    },
    seekVoice(deltaSeconds) {
      const v = voice;
      if (!v || !Number.isFinite(deltaSeconds) || v.phase === "loading" || !v.clip) return;
      const head = v.seekTarget ?? (v.phase === "silent" || v.phase === "out" ? resumePosition(v) : v.clip.position());
      let target: number;
      if (deltaSeconds < 0 && v.breaks.length) {
        // land on the last break at or before the target, or the start when there is none
        const want = head + deltaSeconds;
        let best: number | undefined;
        for (const b of v.breaks) { if (b <= want) best = b; else break; }
        target = best === undefined ? 0 : Math.max(0, best - RESUME_LEAD);
      } else {
        target = Math.max(0, head + deltaSeconds);
      }
      target = Math.min(target, v.clip.duration());
      if (v.phase === "in" || v.phase === "playing") {
        v.seekTarget = target;
        fadeOut(v, "seek", cutNow(v, "exact"));
      } else if (v.phase === "out" && v.reason === "seek") {
        v.seekTarget = target;
      } else {
        v.cut = { kind: "exact", pos: target, at: clock() };
      }
      v.onTime?.(target);
    },

    playNav(src, o): PlayHandle {
      const entry: NavEntry = { kind: "clip", path: src, label: src, est: o?.estimatedSeconds, urgent: o?.urgent === true, def: deferred(), clip: null };
      enqueue(entry);
      return {
        done: entry.def.promise,
        stop: () => {
          const i = navWaiting.indexOf(entry);
          if (i >= 0) { navWaiting.splice(i, 1); entry.def.reject("stopped"); navGaveUp(); return; }
          if (navCurrent === entry) finishNav(entry, "stopped");
        },
      };
    },

    signal(name: SignalName) {
      const entry: NavEntry = {
        kind: "signal", path: signalPath(name), label: name, est: SIGNAL_SECONDS[name] ?? 2, urgent: false, def: deferred(), clip: null,
      };
      enqueue(entry);
      return entry.def.promise;
    },

    playEffect(name, o) {
      if (disposed) return;
      const level = o?.level ?? 1;
      if (real) { bed.effect(name, level); return; }
      logEvent("effect", "on", name);
      after(ms(EFFECT_SECONDS[name] ?? 3), () => logEvent("effect", "off", name));
    },

    preload(srcs) {
      if (disposed) return;
      for (const s of srcs) {
        if (preloadSeen.has(s)) continue;
        preloadSeen.add(s);
        preloaded.push(s);
        if (!real) continue;
        try {
          if (s.startsWith("ambience:")) bed.preloadAmbience(s.slice("ambience:".length));
          else if (s.startsWith("music:")) bed.preloadMusic(s.slice("music:".length));
          else if (typeof fetch !== "undefined") void fetch(resolveUrl(s)).then((r) => r.arrayBuffer()).catch(() => {});
        } catch {}
      }
    },

    tick() {
      tickCount++;
      if (real) bed.tick();
    },
    setBedLevel(level) {
      bedLevel = Math.max(0, level);
      if (real) bed.setBedLevel(bedLevel);
    },

    startBed(ambience, music) {
      if (disposed) return;
      bedState = ambience === null && music === null ? null : { ambience, music };
      setLayer("ambience", ambience);
      setLayer("music", music);
    },
    stopBed(fadeSeconds = DEFAULT_FADE) {
      if (disposed) return;
      bedState = null;
      const fade = Math.max(0, fadeSeconds);
      if (real) bed.stop(fade);
      else {
        for (const kind of ["ambience", "music"] as const) {
          const cur = layerNow[kind];
          if (cur !== null) after(ms(fade), () => logEvent(kind, "off", cur));
        }
      }
      layerNow.ambience = layerNow.music = null;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      clearInterval(volTimer);
      const v = voice, r = retiring;
      voice = retiring = null;
      for (const x of [v, r]) if (x) { x.def.reject("stopped"); x.clip?.dispose(); }
      const cur = navCurrent;
      navCurrent = null;
      cur?.clip?.dispose();
      for (const e of [cur, ...navWaiting.splice(0)]) if (e) settle(e, "stopped");
      resumeTimer = null;
      for (const el of [voiceEl, ...navEls]) {
        if (!el) continue;
        try { el.pause(); el.removeAttribute("src"); el.load(); } catch {}
      }
      bed.dispose();
    },

    get navBusy() { return navCurrent !== null || navWaiting.length > 0; },
    get voiceBusy() { return voice !== null; },
    get bed() { return bedState; },
    get ticks() { return tickCount; },
    get bedLevel() { return bedLevel; },
    get timeline() { return timeline; },
    get preloaded() { return preloaded; },
  };
  return mixer;
}
