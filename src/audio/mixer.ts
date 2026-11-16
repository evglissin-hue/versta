import type { Mixer, MixerOptions, PlayHandle, Story } from "../types";
import { createBed } from "./bed";
import { type Clip, type ClipFactory, elementClipFactory, silentWavUri, virtualClipFactory } from "./clips";

/** The mixer plus a view of the bed, so tests can see what the director asked for. */
export interface MixerWithBed extends Mixer {
  readonly bed: { ambience: string | null; mood: Story["mood"] | null } | null;
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

interface VoiceEntry {
  src: string;
  est: number | undefined;
  onTime: ((s: number) => void) | undefined;
  def: Deferred;
  clip: Clip | null;
  /** The clip is actually sounding. */
  playing: boolean;
  /** The caller paused it. A nav cue pausing it does not set this. */
  userPaused: boolean;
}

interface NavEntry { src: string; est: number | undefined; def: Deferred; clip: Clip | null }

const NAV_QUEUE_MAX = 3;
const RESUME_DELAY_MS = 250;
const DEFAULT_FADE = 1;

export function createMixer(opts: MixerOptions): MixerWithBed {
  const timeScale = opts.timeScale && opts.timeScale > 0 ? opts.timeScale : 1;
  const real = !opts.virtual && typeof Audio !== "undefined";
  const bed = createBed();
  let bedState: { ambience: string | null; mood: Story["mood"] | null } | null = null;

  const resolveUrl = (src: string): string => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src) ? src : opts.baseUrl + src);
  let voiceEl: HTMLAudioElement | null = null;
  let navEl: HTMLAudioElement | null = null;
  let voiceFactory: ClipFactory;
  let navFactory: ClipFactory;
  if (real) {
    voiceEl = new Audio();
    navEl = new Audio();
    voiceEl.preload = navEl.preload = "auto";
    voiceFactory = elementClipFactory(voiceEl, resolveUrl);
    navFactory = elementClipFactory(navEl, resolveUrl);
  } else {
    voiceFactory = navFactory = virtualClipFactory(timeScale);
  }

  let voice: VoiceEntry | null = null;
  let navCurrent: NavEntry | null = null;
  const navWaiting: NavEntry[] = [];
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;

  const held = (): boolean => navCurrent !== null || resumeTimer !== undefined;

  function updateDuck(): void {
    bed.duck(navCurrent !== null || (voice !== null && voice.playing));
  }

  /** Make the voice clip match what it should be doing: sounding only when the rider has not paused it and nav is quiet. */
  function applyVoice(): void {
    const v = voice;
    if (!v) { updateDuck(); return; }
    const want = !v.userPaused && !held();
    if (want && !v.playing) {
      if (!v.clip) {
        v.clip = voiceFactory(v.src, v.est, {
          onTime: v.onTime,
          onEnd: () => { if (voice === v) { voice = null; v.playing = false; v.def.resolve(); updateDuck(); } },
          onError: () => { if (voice === v) { voice = null; v.playing = false; v.def.reject("error"); updateDuck(); } },
        });
      }
      v.playing = true;
      v.clip.play();
    } else if (!want && v.playing) {
      v.playing = false;
      v.clip?.pause();
    }
    updateDuck();
  }

  function dropVoice(reason: "stopped"): void {
    const v = voice;
    if (!v) return;
    voice = null;
    v.playing = false;
    v.clip?.dispose();
    v.def.reject(reason);
  }

  function pumpNav(): void {
    if (navCurrent) return;
    const next = navWaiting.shift();
    if (!next) {
      if (resumeTimer === undefined) {
        resumeTimer = setTimeout(() => { resumeTimer = undefined; applyVoice(); }, RESUME_DELAY_MS);
      }
      applyVoice();
      return;
    }
    clearTimeout(resumeTimer);
    resumeTimer = undefined;
    navCurrent = next;
    next.clip = navFactory(next.src, next.est, {
      onEnd: () => { if (navCurrent === next) { navCurrent = null; next.def.resolve(); pumpNav(); } },
      onError: () => { if (navCurrent === next) { navCurrent = null; next.def.reject("error"); pumpNav(); } },
    });
    applyVoice();
    next.clip.play();
  }

  const mixer: MixerWithBed = {
    async unlock() {
      if (!real) return;
      bed.ensure();
      const uri = silentWavUri();
      for (const el of [voiceEl, navEl]) {
        if (!el) continue;
        try {
          el.src = uri;
          await el.play();
          el.pause();
        } catch {
          // priming is best effort: a failure shows up later as a clip error
        }
      }
    },

    playVoice(src, o): PlayHandle {
      dropVoice("stopped");
      const entry: VoiceEntry = { src, est: o?.estimatedSeconds, onTime: o?.onTime, def: deferred(), clip: null, playing: false, userPaused: false };
      voice = entry;
      applyVoice();
      return { done: entry.def.promise, stop: () => { if (voice === entry) { dropVoice("stopped"); updateDuck(); } } };
    },
    pauseVoice() {
      if (!voice) return;
      voice.userPaused = true;
      applyVoice();
    },
    resumeVoice() {
      if (!voice) return;
      voice.userPaused = false;
      applyVoice();
    },
    stopVoice() {
      dropVoice("stopped");
      updateDuck();
    },

    playNav(src, o): PlayHandle {
      const entry: NavEntry = { src, est: o?.estimatedSeconds, def: deferred(), clip: null };
      navWaiting.push(entry);
      while (navWaiting.length > NAV_QUEUE_MAX && navCurrent) navWaiting.shift()?.def.reject("stopped");
      pumpNav();
      return {
        done: entry.def.promise,
        stop: () => {
          const i = navWaiting.indexOf(entry);
          if (i >= 0) { navWaiting.splice(i, 1); entry.def.reject("stopped"); return; }
          if (navCurrent === entry) {
            navCurrent = null;
            entry.clip?.dispose();
            entry.def.reject("stopped");
            pumpNav();
          }
        },
      };
    },

    chime() {
      if (!real) return new Promise<void>((res) => setTimeout(res, 1200 / timeScale));
      bed.chime();
      return new Promise<void>((res) => setTimeout(res, 1200));
    },

    startBed(ambience, mood) {
      bedState = ambience === null && mood === null ? null : { ambience, mood };
      if (real) bed.start(ambience, mood);
    },
    stopBed(fadeSeconds = DEFAULT_FADE) {
      bedState = null;
      if (real) bed.stop(fadeSeconds);
    },

    get navBusy() { return navCurrent !== null; },
    get voiceBusy() { return voice !== null; },
    get bed() { return bedState; },
  };
  return mixer;
}
