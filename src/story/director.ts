import type { Aside, Cue, Director, DirectorDeps, DirectorLogEntry, NavEvent, NavState, NowPlaying, PlayHandle, Story } from "../types";

const WORDS_PER_SECOND = 2.6;
const END_GAP_MS = 2500;
const BED_FADE_SECONDS = 1.5;
const PARA_LEAD_SECONDS = 0.15;
const MIN_RIDING_SECONDS = 60;
const ASIDE_GAP_SECONDS = { sparse: 300, rich: 90 };
const NEAR_STOP_METRES = 150;
const NEAR_TURN_METRES = 80;

type StoryNow = Extract<NonNullable<NowPlaying>, { kind: "story" }>;
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

  let queue: Queued[] = [];
  /** The story on screen. `ended` means it has finished and is waiting out the pause before the next. */
  let current: (StoryNow & { ended: boolean; handle: PlayHandle | null }) | null = null;
  let asideNow: Aside | null = null;
  let asideHandle: PlayHandle | null = null;
  /** An aside has been chosen and its chime is ringing. */
  let asidePending = false;
  let token = 0;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAsideEnd: number | null = null;
  let ridingSince: number | null = null;
  let bedKey: string | null = null;
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

  function startBed(stop: number, story: Story): void {
    const s = deps.settings();
    const ambience = s.ambience ? (story.ambience ?? pack.stops[stop]?.ambience ?? "river") : null;
    const mood = s.music ? story.mood : null;
    const key = `${ambience ?? ""}|${mood ?? ""}`;
    if (key === bedKey) return;
    bedKey = key;
    mixer.startBed(ambience, mood);
  }
  function fadeBed(): void {
    bedKey = null;
    asideBed = false;
    mixer.stopBed(BED_FADE_SECONDS);
  }
  /** A soft bed under a passing-by story, from the stop the rider last left. A bed already running is left alone. */
  function startAsideBed(nav: NavState): void {
    if (!deps.settings().ambience || bedKey !== null) return;
    const ambience = pack.stops[Math.max(0, nav.seg - 1)]?.ambience ?? "river";
    bedKey = `${ambience}|`;
    asideBed = true;
    mixer.startBed(ambience, null);
  }
  function endAsideBed(): void {
    if (asideBed) fadeBed();
  }

  /* ---------------------------------------------------------------- stories */

  /** Cut off whatever story or aside is sounding. */
  function cutCurrent(reason: string): void {
    token++;
    clearTimeout(gapTimer);
    gapTimer = undefined;
    if (current && !current.ended) log("story_stopped", current.story.id, reason);
    current = null;
    asideNow = null;
    asidePending = false;
    asideHandle = null;
    mixer.stopVoice();
    endAsideBed();
  }

  function startStory(stop: number, story: Story): void {
    cutCurrent("replaced");
    const my = token;
    heard.add(story.id);
    log("story_start", story.id);
    const settings = deps.settings();
    const manual = !settings.storyVoice || !story.audio;
    const now: NonNullable<typeof current> = { kind: "story", stop, story, para: 0, paused: false, manual, ended: false, handle: null };
    current = now;
    startBed(stop, story);
    setMediaSession(stop, story);
    emit();
    if (manual || !story.audio) return;
    const audio = story.audio;
    const handle = mixer.playVoice(audio.src, {
      estimatedSeconds: audio.dur,
      onTime: (t) => {
        if (my !== token || current !== now) return;
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
    fadeBed();
  }

  const unheardCore = (stop: number, except?: string): Queued[] =>
    (pack.stops[stop]?.stories ?? []).filter((s) => s.kind === "core" && !heard.has(s.id) && s.id !== except).map((story) => ({ stop, story }));

  /* ---------------------------------------------------------------- nav speech */

  const speakNav = (src: string, say: string): void => {
    const h = mixer.playNav(src, { estimatedSeconds: Math.max(1, words(say) / WORDS_PER_SECOND) });
    h.done.catch(() => {});
  };

  /** Never speak a cue twice. A "now" after a spoken approach is therefore silent; a depart cue has no approach, so it speaks. */
  function handleCue(cue: Cue): void {
    if (spokenCues.has(cue.id)) return;
    const silent = cue.quiet === true || !deps.settings().navVoice;
    if (silent) {
      if (!shownCues.has(cue.id)) { shownCues.add(cue.id); log("cue_shown", cue.id); }
      return;
    }
    spokenCues.add(cue.id);
    log("cue_spoken", cue.id);
    speakNav(cue.audio, cue.say);
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
    void mixer.chime().then(() => {
      if (my !== token || disposed) return;
      asidePending = false;
      heard.add(aside.id);
      asideNow = aside;
      log("aside_played", aside.id);
      startAsideBed(nav);
      emit();
      const h = mixer.playVoice(aside.audio, { estimatedSeconds: words(aside.text) / WORDS_PER_SECOND });
      asideHandle = h;
      const finish = (): void => {
        if (my !== token || asideHandle !== h) return;
        asideHandle = null;
        asideNow = null;
        lastAsideEnd = deps.clock();
        endAsideBed();
        emit();
      };
      h.done.then(finish, (reason: unknown) => { if (reason !== "stopped") finish(); });
    });
  }

  /* ---------------------------------------------------------------- the director */

  const api: Director = {
    handle(events: NavEvent[], nav: NavState): void {
      if (disposed) return;
      if (nav.status === "riding" && ridingSince === null) ridingSince = deps.clock();
      for (const e of events) {
        switch (e.type) {
          case "cue":
            handleCue(e.cue);
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
            if (deps.settings().navVoice && pack.system.rerouting) speakNav(pack.system.rerouting, "Rerouting.");
            break;
          case "detour_turn": {
            log("detour_turn", e.turn, e.name);
            const clip = pack.system.turns?.[e.turn];
            if (clip && deps.settings().navVoice) speakNav(clip, e.turn.replace("_", " "));
            break;
          }
          case "arrive": {
            if (asideNow || asidePending) {
              token++;
              asideNow = null; asideHandle = null; asidePending = false;
              mixer.stopVoice();
              endAsideBed();
              lastAsideEnd = deps.clock();
              emit();
            }
            log("arrive", String(e.stop));
            const clip = pack.system.arrive[e.stop];
            if (clip && deps.settings().navVoice) speakNav(clip, `Arriving at ${pack.stops[e.stop]?.name ?? "the stop"}.`);
            if (deps.settings().autoPlayStories) api.playStop(e.stop);
            break;
          }
          case "leave":
            ridingSince = deps.clock();
            break;
          case "aside": {
            const reason = asideSkipReason(e.aside, nav);
            if (reason) log("aside_skipped", e.aside.id, reason);
            else playAside(e.aside, nav);
            break;
          }
          case "finished":
            log("finished");
            break;
        }
      }
    },

    playStory(stop: number, storyId: string): void {
      const story = pack.stops[stop]?.stories.find((s) => s.id === storyId);
      if (!story) return;
      queue = unheardCore(stop, storyId);
      startStory(stop, story);
    },

    playStop(stop: number): void {
      const list = unheardCore(stop);
      const first = list.shift();
      if (!first) return;
      queue = list;
      startStory(first.stop, first.story);
    },

    togglePause(): void {
      if (!current || current.manual || current.ended) return;
      current.paused = !current.paused;
      if (current.paused) mixer.pauseVoice(); else mixer.resumeVoice();
      emit();
    },

    nextParagraph(): void {
      if (!current || !current.manual || current.ended) return;
      if (current.para + 1 >= current.story.paras.length) { endStory(); return; }
      current.para += 1;
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
      mixer.stopBed();
      bedKey = null;
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
      gapTimer = undefined;
      clearMediaSession();
    },
  };
  return api;
}
