import type { Aside, Cue, Director, DirectorDeps, DirectorLogEntry, NavEvent, NavState, NowPlaying, PlayHandle, SignalName, Story } from "../types";

const WORDS_PER_SECOND = 2.6;
const END_GAP_MS = 2500;
/** The soft bed under a passing-by story fades out over this long when the aside ends. */
const ASIDE_BED_FADE = 1.5;
/** An arrival cuts a passing-by story over this long, and its bed over the next. */
const ASIDE_CUT_FADE = 0.4;
const ASIDE_CUT_BED_FADE = 1;
/** The story of a stop starts this long after the arrival; its bed rises at once. */
const ARRIVAL_LEAD_SECONDS = 3;
/** The bed lingers this long after the last story of a stop, then fades over LINGER_FADE. */
const LINGER_SECONDS = 20;
const LINGER_FADE = 6;
/** Arrival without auto-play: the stop's soundscape alone plays this long, then fades over LINGER_FADE. */
const ARRIVAL_BED_SECONDS = 30;
/** Riding away from a stop: the bed fades over this long. */
const LEAVE_FADE = 4;
const STOP_ALL_FADE = 1;
/** An effect fires this long before the paragraph it leads into. */
const EFFECT_LEAD_SECONDS = 1.2;
/** A turn cue may make the narration wait for a phrase break only when the turn is at least this many seconds away. */
const MIN_WAIT_SECONDS = 11;
const PARA_LEAD_SECONDS = 0.15;
const MIN_RIDING_SECONDS = 60;
const ASIDE_GAP_SECONDS = { sparse: 300, rich: 90 };
const NEAR_STOP_METRES = 150;
const NEAR_TURN_METRES = 80;
/** Below this many metres to the turn only the cue is spoken, without a distance. */
const MIN_DISTANCE_CALL = 40;
/** A distance clip is chosen for the turn distance plus this much, since it is spoken a moment before the cue. */
const DISTANCE_SLACK = 15;
const REROUTING_GAP_MS = 60_000;

type StoryNow = Extract<NonNullable<NowPlaying>, { kind: "story" }>;
/** `fired` holds the indexes into story.sfx that have sounded in this play. */
type CurrentStory = StoryNow & { ended: boolean; handle: PlayHandle | null; fired: Set<number> };
interface Queued { stop: number; story: Story }

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Index of the paragraph being read at `time`: the last one whose mark has been reached (with a short lead). */
function paraAt(marks: number[], time: number): number {
  let p = 0;
  for (let i = 0; i < marks.length; i++) if (time >= marks[i]! - PARA_LEAD_SECONDS) p = i;
  return p;
}

export function createDirector(deps: DirectorDeps): Director {
  const { pack, mixer } = deps;
  const scale = deps.timeScale > 0 ? deps.timeScale : 1;
  const heard = new Set<string>();
  const spokenCues = new Set<string>();
  const shownCues = new Set<string>();
  /** Cues whose approach was spoken: their "now" is a tick, not words. */
  const approached = new Set<string>();
  let lastRerouting: number | null = null;
  /** Where the story on screen has got to, seconds, as last reported. */
  let playhead = 0;

  let queue: Queued[] = [];
  /** The story on screen. `ended` means it has finished and is waiting out the pause before the next. */
  let current: CurrentStory | null = null;
  let asideNow: Aside | null = null;
  let asideHandle: PlayHandle | null = null;
  /** An aside has been chosen and its chime is ringing. */
  let asidePending = false;
  let token = 0;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAsideEnd: number | null = null;
  let ridingSince: number | null = null;
  let bedKey: string | null = null;
  /** Timers of the bed: the story that follows an arrival, the stop's soundscape alone, and the linger after the last story. */
  let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
  let bedOnlyTimer: ReturnType<typeof setTimeout> | undefined;
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;
  /** The rider has ridden away from the stop whose stories are still queued: they get no bed. */
  let leftStop = false;
  let primed = false;
  const prefetchedStops = new Set<number>();
  let lastNextCue: string | null = null;
  /** The soft bed under the aside now playing, when the aside started it. */
  let asideBed = false;
  let disposed = false;

  const log = (what: DirectorLogEntry["what"], id?: string, reason?: string): void => {
    const e: DirectorLogEntry = { at: deps.clock(), what };
    if (id !== undefined) e.id = id;
    if (reason !== undefined) e.reason = reason;
    deps.onLog(e);
  };

  const emit = (): void => {
    if (disposed) return;
    if (asideNow) deps.onNowPlaying({ kind: "aside", aside: asideNow });
    else if (current) deps.onNowPlaying({ kind: "story", stop: current.stop, story: current.story, para: current.para, paused: current.paused, manual: current.manual });
    else deps.onNowPlaying(null);
  };

  /* ---------------------------------------------------------------- media session */

  type MediaSessionLike = { metadata: unknown; setActionHandler(a: string, h: (() => void) | null): void };
  const mediaSession = (): MediaSessionLike | null => {
    const nav = (globalThis as { navigator?: { mediaSession?: MediaSessionLike } }).navigator;
    return nav?.mediaSession ?? null;
  };
  const setMediaSession = (stop: number, story: Story): void => {
    const ms = mediaSession();
    const Meta = (globalThis as { MediaMetadata?: new (init: { title: string; artist: string; album: string }) => unknown }).MediaMetadata;
    if (!ms || !Meta) return;
    try {
      ms.metadata = new Meta({ title: story.title, artist: pack.stops[stop]?.name ?? "", album: pack.name });
      ms.setActionHandler("play", () => api.togglePause());
      ms.setActionHandler("pause", () => api.togglePause());
    } catch {}
  };
  const clearMediaSession = (): void => {
    const ms = mediaSession();
    if (!ms) return;
    try { ms.setActionHandler("play", null); ms.setActionHandler("pause", null); } catch {}
  };

  /* ---------------------------------------------------------------- bed */

  const themeOf = (story: Story): string | null => (deps.settings().music ? (story.music ?? (story.mood === "minor" ? "solemn" : "bright")) : null);
  const scapeOf = (stop: number, story: Story | null): string | null =>
    deps.settings().ambience ? ((story?.ambience ?? pack.stops[stop]?.ambience) ?? "river") : null;

  function startBed(stop: number, story: Story): void {
    if (leftStop) return;
    const ambience = scapeOf(stop, story);
    const music = themeOf(story);
    const key = `${ambience ?? ""}|${music ?? ""}`;
    if (key === bedKey) return;
    bedKey = key;
    mixer.startBed(ambience, music);
  }
  /** Fade the whole bed out and forget it, with its timers. */
  function stopBed(seconds: number): void {
    clearTimeout(bedOnlyTimer);
    clearTimeout(lingerTimer);
    bedOnlyTimer = lingerTimer = undefined;
    bedKey = null;
    asideBed = false;
    mixer.stopBed(seconds);
  }
  /** The stop's soundscape alone, with no music, for a while: an arrival that starts no story. */
  function startStopBed(stop: number): void {
    const ambience = scapeOf(stop, null);
    if (ambience === null) return;
    bedKey = `${ambience}|`;
    mixer.startBed(ambience, null);
    clearTimeout(bedOnlyTimer);
    bedOnlyTimer = setTimeout(() => { bedOnlyTimer = undefined; stopBed(LINGER_FADE); }, (ARRIVAL_BED_SECONDS * 1000) / scale);
  }
  /** After the last story of a stop: the bed holds a while, then fades. A story started meanwhile cancels it. */
  function startLinger(): void {
    if (leftStop || bedKey === null || lingerTimer !== undefined) return;
    lingerTimer = setTimeout(() => { lingerTimer = undefined; stopBed(LINGER_FADE); }, (LINGER_SECONDS * 1000) / scale);
  }
  /** A soft bed under a passing-by story, from the stop the rider last left. A bed already running is left alone. */
  function startAsideBed(nav: NavState): void {
    if (!deps.settings().ambience || bedKey !== null) return;
    const ambience = pack.stops[Math.max(0, nav.seg - 1)]?.ambience ?? "river";
    bedKey = `${ambience}|`;
    asideBed = true;
    mixer.startBed(ambience, null);
  }
  function endAsideBed(seconds: number): void {
    if (asideBed) stopBed(seconds);
  }
  function signal(name: SignalName): void {
    log("signal", name);
    void mixer.signal(name).catch(() => {});
  }

  /* ---------------------------------------------------------------- effects */

  const effectAt = (story: Story, para: number): number | null => {
    const mark = story.audio?.marks[para];
    return mark === undefined ? null : Math.max(0, mark - EFFECT_LEAD_SECONDS);
  };
  function fireEffect(now: CurrentStory, i: number): void {
    now.fired.add(i);
    const e = now.story.sfx?.[i];
    if (!e || !deps.settings().ambience) return;
    log("effect", now.story.id, `${e.para}:${e.name}`);
    mixer.playEffect(e.name, { level: e.level });
  }
  /** The playhead reached `t`: fire every effect whose place has come. */
  function checkEffects(now: CurrentStory, t: number): void {
    const list = now.story.sfx;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      if (now.fired.has(i)) continue;
      const at = effectAt(now.story, list[i]!.para);
      if (at !== null && t >= at) fireEffect(now, i);
    }
  }
  /** Read by tapping: the effects of a paragraph fire when it appears. */
  function fireParaEffects(now: CurrentStory): void {
    const list = now.story.sfx;
    if (!list) return;
    for (let i = 0; i < list.length; i++) if (list[i]!.para === now.para && !now.fired.has(i)) fireEffect(now, i);
  }

  /* ---------------------------------------------------------------- stories */

  /** Cut off whatever story or aside is sounding. */
  function cutCurrent(reason: string): void {
    token++;
    clearTimeout(gapTimer);
    clearTimeout(arrivalTimer);
    gapTimer = arrivalTimer = undefined;
    if (current && !current.ended) log("story_stopped", current.story.id, reason);
    current = null;
    asideNow = null;
    asidePending = false;
    asideHandle = null;
    mixer.stopVoice();
    endAsideBed(ASIDE_BED_FADE);
  }

  function startStory(stop: number, story: Story): void {
    cutCurrent("replaced");
    const my = token;
    heard.add(story.id);
    log("story_start", story.id);
    const settings = deps.settings();
    const manual = !settings.storyVoice || !story.audio;
    playhead = 0;
    const now: CurrentStory = { kind: "story", stop, story, para: 0, paused: false, manual, ended: false, handle: null, fired: new Set() };
    current = now;
    // a story started during the linger or the soundscape-alone minute keeps the bed and adds its own music
    clearTimeout(bedOnlyTimer);
    clearTimeout(lingerTimer);
    bedOnlyTimer = lingerTimer = undefined;
    startBed(stop, story);
    setMediaSession(stop, story);
    emit();
    if (manual || !story.audio) { fireParaEffects(now); return; }
    const audio = story.audio;
    const handle = mixer.playVoice(audio.src, {
      estimatedSeconds: audio.dur,
      breaks: audio.breaks,
      onTime: (t) => {
        if (my !== token || current !== now) return;
        playhead = t;
        checkEffects(now, t);
        const p = paraAt(audio.marks, t);
        if (p !== now.para) { now.para = p; emit(); }
      },
    });
    now.handle = handle;
    handle.done.then(
      () => { if (my === token && current === now) endStory(); },
      (reason: unknown) => {
        if (my !== token || current !== now || reason === "stopped") return;
        // the clip could not play: fall back to reading by tapping
        now.manual = true;
        now.para = 0;
        now.handle = null;
        emit();
      },
    );
  }

  function endStory(): void {
    if (!current || current.ended) return;
    current.ended = true;
    log("story_end", current.story.id);
    if (queue.length === 0) startLinger();
    const my = token;
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => { gapTimer = undefined; if (my === token) advance(); }, END_GAP_MS / scale);
  }

  /** Start the next queued story, or close the story view. */
  function advance(): void {
    clearTimeout(gapTimer);
    gapTimer = undefined;
    const next = queue.shift();
    if (next) { startStory(next.stop, next.story); return; }
    token++;
    current = null;
    clearMediaSession();
    deps.onNowPlaying(null);
    if (!leftStop) {
      if (deps.settings().ambience) signal("close");
      startLinger();
    }
  }

  const unheardCore = (stop: number, except?: string): Queued[] =>
    (pack.stops[stop]?.stories ?? []).filter((s) => s.kind === "core" && !heard.has(s.id) && s.id !== except).map((story) => ({ stop, story }));

  /* ---------------------------------------------------------------- nav speech */

  const speakNav = (src: string, say: string, urgent = false): void => {
    const h = mixer.playNav(src, { estimatedSeconds: Math.max(1, words(say) / WORDS_PER_SECOND), urgent });
    h.done.catch(() => {});
  };

  /** An approach is urgent unless the rider takes long enough to reach the turn for the narration to run on to a break. */
  function approachUrgent(nav: NavState): boolean {
    if (nav.toCue === null) return true;
    const speed = Math.max(1, nav.speedAvg ?? nav.fix?.speed ?? 4);
    return nav.toCue / speed < MIN_WAIT_SECONDS;
  }

  /** Never speak a cue twice. A "now" after a spoken approach is therefore silent; a depart cue has no approach, so it speaks. */
  function handleCue(cue: Cue, phase: "approach" | "now", nav: NavState): void {
    if (spokenCues.has(cue.id)) {
      if (phase === "now" && approached.has(cue.id) && deps.settings().navVoice && !cue.quiet) mixer.tick?.();
      return;
    }
    const silent = cue.quiet === true || !deps.settings().navVoice;
    if (silent) {
      if (!shownCues.has(cue.id)) { shownCues.add(cue.id); log("cue_shown", cue.id); }
      return;
    }
    spokenCues.add(cue.id);
    log("cue_spoken", cue.id);
    // a depart cue is never urgent; a cue first spoken at the turn itself is
    const urgent = cue.turn === "depart" ? false : phase === "approach" ? approachUrgent(nav) : true;
    if (phase === "approach") {
      approached.add(cue.id);
      const call = distanceCall(nav.toCue);
      if (call) speakNav(call.src, `In ${call.metres} metres,`, urgent);
    }
    speakNav(cue.audio, cue.say, urgent);
  }

  /** The clip for "in a hundred metres" nearest below the distance to the turn, or null when none fits or the turn is close. */
  function distanceCall(toCue: number | null): { src: string; metres: number } | null {
    const table = pack.system.distances;
    if (!table || toCue === null || toCue < MIN_DISTANCE_CALL) return null;
    let best: { src: string; metres: number } | null = null;
    for (const [key, src] of Object.entries(table)) {
      const metres = Number(key);
      if (!Number.isFinite(metres) || !src || metres > toCue + DISTANCE_SLACK) continue;
      if (!best || metres > best.metres) best = { src, metres };
    }
    return best;
  }

  /* ---------------------------------------------------------------- asides */

  function asideSkipReason(aside: Aside, nav: NavState): string | null {
    const mode = deps.settings().asides;
    if (mode === "off") return "off";
    if (heard.has(aside.id)) return "heard";
    if (current !== null || asideNow !== null || asidePending || mixer.voiceBusy || mixer.navBusy) return "busy";
    if (nav.status !== "riding" || nav.offRoute) return "not_riding";
    if (nav.toStop <= NEAR_STOP_METRES) return "near_stop";
    if (nav.toCue !== null && nav.toCue <= NEAR_TURN_METRES) return "near_turn";
    const now = deps.clock();
    const gap = ASIDE_GAP_SECONDS[mode] * 1000;
    if (lastAsideEnd !== null && now - lastAsideEnd < gap) return "too_soon";
    if (ridingSince !== null && now - ridingSince < MIN_RIDING_SECONDS * 1000) return "too_soon";
    return null;
  }

  function playAside(aside: Aside, nav: NavState): void {
    asidePending = true;
    const my = ++token;
    mixer.preload([aside.audio]);
    log("signal", "aside");
    void mixer.signal("aside").then(() => {
      if (my !== token || disposed) return;
      asidePending = false;
      heard.add(aside.id);
      asideNow = aside;
      log("aside_played", aside.id);
      startAsideBed(nav);
      emit();
      const h = mixer.playVoice(aside.audio, { estimatedSeconds: words(aside.text) / WORDS_PER_SECOND, breaks: aside.breaks });
      asideHandle = h;
      const finish = (): void => {
        if (my !== token || asideHandle !== h) return;
        asideHandle = null;
        asideNow = null;
        lastAsideEnd = deps.clock();
        endAsideBed(ASIDE_BED_FADE);
        emit();
      };
      h.done.then(finish, (reason: unknown) => { if (reason !== "stopped") finish(); });
    }, () => { if (my === token) asidePending = false; });
  }

  /* ---------------------------------------------------------------- the director */

  /* ---------------------------------------------------------------- prefetch */

  /** The clips every ride may need, fetched once at the first call. */
  function preloadSystem(): void {
    const sys = pack.system;
    const srcs = [...Object.values(sys.distances ?? {}), ...Object.values(sys.turns ?? {}), sys.offRoute, sys.backOnRoute, sys.rerouting, sys.wrongWay];
    mixer.preload(srcs.filter((x): x is string => typeof x === "string" && x !== ""));
  }

  /** Riding towards a stop and close to it: its arrival clip and what the first story needs, once per stop. */
  function preloadStop(stop: number): void {
    if (prefetchedStops.has(stop) || !pack.stops[stop]) return;
    prefetchedStops.add(stop);
    const srcs: string[] = [];
    const arrival = pack.system.arrive[stop];
    if (arrival) srcs.push(arrival);
    const first = unheardCore(stop)[0];
    if (first) {
      if (first.story.audio) srcs.push(first.story.audio.src);
      const scape = scapeOf(stop, first.story);
      if (scape) srcs.push(`ambience:${scape}`);
      const theme = themeOf(first.story);
      if (theme) srcs.push(`music:${theme}`);
    }
    mixer.preload(srcs);
  }

  function prefetch(nav: NavState): void {
    if (!primed) { primed = true; preloadSystem(); }
    if (nav.status === "riding" && nav.toStop <= NEAR_STOP_METRES) preloadStop(nav.seg);
    const next = nav.nextCue;
    const id = next?.id ?? null;
    if (id !== lastNextCue) {
      lastNextCue = id;
      if (next && !next.quiet && next.audio) mixer.preload([next.audio]);
    }
  }

  const api: Director = {
    handle(events: NavEvent[], nav: NavState): void {
      if (disposed) return;
      if (nav.status === "riding" && ridingSince === null) ridingSince = deps.clock();
      prefetch(nav);
      for (const e of events) {
        switch (e.type) {
          case "cue":
            handleCue(e.cue, e.phase, nav);
            break;
          case "wrong_way":
            log("wrong_way");
            if (deps.settings().navVoice && pack.system.wrongWay) speakNav(pack.system.wrongWay, "You are going the wrong way.");
            break;
          case "off_route":
            log("off_route");
            if (deps.settings().navVoice) speakNav(pack.system.offRoute, "You are off the route.");
            break;
          case "back_on_route":
            log("back_on_route");
            if (deps.settings().navVoice) speakNav(pack.system.backOnRoute, "Back on the route.");
            break;
          case "detour":
            if (!e.found) break;
            log("detour");
            if (deps.settings().navVoice && pack.system.rerouting) {
              const at = deps.clock();
              if (lastRerouting === null || at - lastRerouting >= REROUTING_GAP_MS) {
                lastRerouting = at;
                speakNav(pack.system.rerouting, "Rerouting.");
              }
            }
            break;
          case "detour_turn": {
            log("detour_turn", e.turn, e.name);
            const clip = pack.system.turns?.[e.turn];
            if (clip && deps.settings().navVoice) speakNav(clip, e.turn.replace("_", " "), true);
            break;
          }
          case "arrive": {
            if (asideNow || asidePending) {
              token++;
              asideNow = null; asideHandle = null; asidePending = false;
              mixer.stopVoice(ASIDE_CUT_FADE);
              endAsideBed(ASIDE_CUT_BED_FADE);
              lastAsideEnd = deps.clock();
              emit();
            }
            log("arrive", String(e.stop));
            leftStop = false;
            clearTimeout(lingerTimer);
            clearTimeout(bedOnlyTimer);
            clearTimeout(arrivalTimer);
            lingerTimer = bedOnlyTimer = arrivalTimer = undefined;
            if (deps.settings().ambience) signal("arrive");
            const clip = pack.system.arrive[e.stop];
            if (clip && deps.settings().navVoice) speakNav(clip, `Arriving at ${pack.stops[e.stop]?.name ?? "the stop"}.`);
            const list = deps.settings().autoPlayStories ? unheardCore(e.stop) : [];
            const first = list.shift();
            if (first) {
              // the bed rises at once, under the signal and "Arriving at"; the story follows after the lead
              if (current) cutCurrent("replaced");
              queue = list;
              startBed(first.stop, first.story);
              const my = ++token;
              arrivalTimer = setTimeout(() => {
                arrivalTimer = undefined;
                if (my === token && !disposed) startStory(first.stop, first.story);
              }, (ARRIVAL_LEAD_SECONDS * 1000) / scale);
            } else if (!current) {
              startStopBed(e.stop);
            }
            break;
          }
          case "leave":
            ridingSince = deps.clock();
            // the bed never outlives the stop: a story still playing goes on without it
            leftStop = true;
            stopBed(LEAVE_FADE);
            break;
          case "aside": {
            const reason = asideSkipReason(e.aside, nav);
            if (reason) log("aside_skipped", e.aside.id, reason);
            else playAside(e.aside, nav);
            break;
          }
          case "finished":
            log("finished");
            if (deps.settings().ambience) signal("finish");
            break;
        }
      }
    },

    playStory(stop: number, storyId: string): void {
      const story = pack.stops[stop]?.stories.find((s) => s.id === storyId);
      if (!story) return;
      leftStop = false;
      queue = unheardCore(stop, storyId);
      startStory(stop, story);
    },

    playStop(stop: number): void {
      const list = unheardCore(stop);
      const first = list.shift();
      if (!first) return;
      leftStop = false;
      queue = list;
      startStory(first.stop, first.story);
    },

    togglePause(): void {
      if (!current || current.manual || current.ended) return;
      current.paused = !current.paused;
      if (current.paused) mixer.pauseVoice(); else mixer.resumeVoice();
      emit();
    },

    rewind(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      if (asideNow) { mixer.seekVoice?.(-seconds); return; }
      if (!current || current.manual || current.ended || !current.story.audio) return;
      const to = Math.max(0, playhead - seconds);
      mixer.seekVoice?.(-seconds); // may report the new playhead straight away
      playhead = to;
      // going back to before an effect's place arms it again
      const list = current.story.sfx ?? [];
      for (let i = 0; i < list.length; i++) {
        const at = effectAt(current.story, list[i]!.para);
        if (at !== null && at > to) current.fired.delete(i);
      }
      const p = paraAt(current.story.audio.marks, to);
      if (p !== current.para) { current.para = p; emit(); }
    },

    nextParagraph(): void {
      if (!current || !current.manual || current.ended) return;
      if (current.para + 1 >= current.story.paras.length) { endStory(); return; }
      current.para += 1;
      fireParaEffects(current);
      emit();
    },

    skip(): void {
      if (!current) return;
      if (!current.ended) {
        log("story_stopped", current.story.id, "skip");
        current.ended = true;
        token++;
        mixer.stopVoice();
      }
      advance();
    },

    stopAll(): void {
      cutCurrent("stop_all");
      queue = [];
      clearMediaSession();
      stopBed(STOP_ALL_FADE);
      deps.onNowPlaying(null);
    },

    markHeard(ids: string[]): void {
      for (const id of ids) heard.add(id);
    },

    get heard(): ReadonlySet<string> { return heard; },

    dispose(): void {
      disposed = true;
      token++;
      clearTimeout(gapTimer);
      clearTimeout(arrivalTimer);
      clearTimeout(bedOnlyTimer);
      clearTimeout(lingerTimer);
      gapTimer = arrivalTimer = bedOnlyTimer = lingerTimer = undefined;
      clearMediaSession();
    },
  };
  return api;
}
