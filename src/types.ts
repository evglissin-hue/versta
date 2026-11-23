/**
 * Shared contracts for Versta. Every module codes against these types.
 * Changing anything here is a master-level decision: executors must not edit this file.
 */

/** [longitude, latitude] in WGS84 degrees, the order MapLibre and GeoJSON use. */
export type LngLat = [number, number];

/* ------------------------------------------------------------------ route pack */

export type TurnKind =
  | "depart" | "straight" | "left" | "right"
  | "slight_left" | "slight_right" | "sharp_left" | "sharp_right";

export interface StoryAudio {
  src: string;
  marks: number[];
  dur: number;
  /**
   * Seconds at which a new phrase starts (the speech onset after a pause), ascending, inside the clip. Found by
   * tools/sound/find_breaks.py. The mixer yields to a turn cue at a break and resumes from one. Absent: no marks.
   */
  breaks?: number[];
}

/** A one-shot sound effect timed to the text: it sounds in the pause before paragraph `para`. */
export interface StorySfx {
  para: number;
  /** Effect name from src/audio/catalogue.json (file public/sounds/fx/<name>.mp3). */
  name: string;
  /** Gain relative to the effect's designed level (1). */
  level?: number;
}
export interface Picture { src: string; caption: string }

export interface Story {
  id: string;
  title: string;
  kind: "core" | "optional";
  mood: "minor" | "bright";
  tags: string[];
  paras: string[];
  /** Soundscape name; falls back to the stop's. */
  ambience?: string;
  /** Music theme from src/audio/catalogue.json. Absent: `minor` gives "solemn", `bright` gives "bright". */
  music?: string;
  /** Effects timed to the text, at most three, at least 10 s apart. */
  sfx?: StorySfx[];
  /** Recorded narration. marks[i] is the second at which paras[i] starts. */
  audio?: StoryAudio;
  pic?: Picture;
}

export interface Stop {
  id: string;
  name: string;
  at: LngLat;
  note: string;
  ambience: string;
  /** Metres from the stop at which the rider counts as arrived. */
  arriveRadius: number;
  pint?: boolean;
  stories: Story[];
}

/** One manoeuvre. Cues belong to a segment; `i` indexes into that segment's polyline. */
export interface Cue {
  id: string;
  seg: number;
  i: number;
  at: LngLat;
  turn: TurnKind;
  name: string;
  kind: "road" | "cycle_path" | "footpath" | "steps" | "path";
  /** Metres ridden on this stretch after the manoeuvre. */
  len: number;
  /** Sentence spoken for the manoeuvre. */
  say: string;
  audio: string;
  /** Shown on screen but not spoken. */
  quiet?: boolean;
}

/** A short passing-by story, anchored to a point on a segment. */
export interface Aside {
  id: string;
  seg: number;
  at: LngLat;
  title: string;
  tags: string[];
  text: string;
  audio: string;
  /** Phrase starts in the clip, as for StoryAudio.breaks. */
  breaks?: number[];
}

export interface Pack {
  format: 1;
  id: string;
  name: string;
  mode: "bicycling" | "walking";
  km: number;
  blurb: string;
  hero: Picture;
  legs: { name: string; from: number; to: number }[];
  stops: Stop[];
  /** segments[i] is the polyline ridden to reach stops[i]. segments[0] is empty. */
  segments: LngLat[][];
  cues: Cue[];
  asides: Aside[];
  system: {
    arrive: string[]; offRoute: string; backOnRoute: string;
    /** Spoken when a way back to the route has been found. */
    rerouting?: string;
    /** Generic turn clips for detours, where street names are not recorded: "Turn left", "Bear right" and so on. */
    turns?: Partial<Record<TurnKind, string>>;
    /** Spoken before a turn cue: "In one hundred metres," keyed by the distance in metres ("50", "100", "150", "200", "300"). */
    distances?: Record<string, string>;
    /** Spoken when the rider is following the route backwards. */
    wrongWay?: string;
  };
  /** Pack-relative path of the corridor road graph used to find a way back when off route. */
  graph?: string;
  credits: string[];
}

/**
 * Road graph of the corridor around a route. Built by tools/, loaded after the ride starts.
 * edges: [from node, to node, metres, cost, name index, kind index, oneway (1 means from -> to only)].
 * cost is metres times a comfort factor (cycle routes and quiet streets cheaper, main roads dearer, walking sections dearest).
 */
export interface RouteGraph {
  nodes: LngLat[];
  edges: [number, number, number, number, number, number, number][];
  names: string[];
  kinds: Cue["kind"][];
}

/** A way back to the route while off it. */
export interface Detour {
  /** From the rider to the point where it rejoins the route. */
  line: LngLat[];
  /** Metres left on the detour. */
  toRejoin: number;
  /** The next turn on the detour, if any before the rejoin. */
  next: { turn: TurnKind; name: string; at: LngLat; dist: number } | null;
}

export interface PackIndexEntry {
  id: string; name: string; mode: Pack["mode"]; km: number; stops: number; hero: string; blurb: string;
  /** Content version: a hash of every file in the pack folder (tools/pack_manifest.py). Changes when any file does. */
  version?: string;
  /** Total size of the pack's files, bytes. */
  bytes?: number;
  /** When `version` last changed, UTC ISO date-time. Of two copies of a route, the later one wins. */
  updated?: string;
  /** Pack format. An app reads formats up to PACK_FORMAT (src/state.ts) and leaves newer ones for a newer app. */
  format?: number;
}

/** public/packs/<id>/manifest.json: every file of a pack, for downloading it and checking it. */
export interface PackManifest {
  id: string;
  version: string;
  format: number;
  /** Paths relative to the pack folder, the manifest itself left out. */
  files: { path: string; bytes: number; sha256: string }[];
}

/* ------------------------------------------------------------------ routes on the phone (Android app) */

/** A download in hand: bytes done of bytes in all. `failed` keeps the counts of the attempt that stopped. */
export interface Transfer { state: "downloading" | "failed"; done: number; total: number }

/** A newer copy of a route the phone already has. */
export interface RouteUpdate {
  /** What the update costs to download (only the files that changed). */
  bytes: number;
  /** In progress or stopped; null while not started. */
  transfer: Transfer | null;
  /**
   * Why a downloaded update is not switched in yet, or why it does not download: the route is being ridden, a saved
   * ride of it would not fit the new stops, the phone is not on Wi-Fi (it waits for a tap), or it needs a newer app.
   */
  held: "riding" | "saved-ride" | "not-wifi" | "needs-app" | null;
  /** Downloaded and waiting to be switched in. */
  ready: boolean;
}

/** What the Android app has of a route. The web app does not use this (it reads the site as before). */
export type RouteStatus =
  | { kind: "on-phone"; source: "built-in" | "downloaded"; version: string; bytes: number; update: RouteUpdate | null }
  /** On the site, not on this phone. `transfer` is null until a download starts. `removed`: the rider removed it. */
  | { kind: "on-site"; bytes: number; transfer: Transfer | null; removed: boolean }
  /** Only on the site, in a format this app cannot read. */
  | { kind: "needs-app" };

/* ------------------------------------------------------------------ places (public/places.json) */

export interface PlaceStory {
  /** The story id inside its pack. */
  id: string;
  title: string;
  kind: Story["kind"] | "aside";
  /** Audio path relative to the pack folder, and its length in seconds. */
  audio: string;
  dur: number;
  pic?: string;
}

export interface Place {
  /** `<pack>:<stop id>` or `<pack>:<aside id>`. */
  id: string;
  name: string;
  at: LngLat;
  /** Metres: inside this, the rider is at the place. */
  radius: number;
  pack: string;
  kind: "stop" | "aside";
  stories: PlaceStory[];
}

export interface PlacesFile {
  /** A hash of the file's content, as for packs. */
  version: string;
  places: Place[];
}

/** Where to start, offered when a ride begins far from stop 1 (src/ride.ts `startOffer`). Metres are straight-line. */
export interface StartChoice { nearest: number; toNearest: number; toFirst: number }

/* ------------------------------------------------------------------ ride recordings */

/** One real ride as the phone saw it: enough to replay it through the engine and the director. */
export interface RideRecording {
  /** The ride's start, ms since 1970, also its id. */
  startedAt: number;
  packId: string;
  /** The pack version ridden, when known. */
  version: string | null;
  /** The stop the ride started at (0 unless the rider chose another). */
  startAt: number;
  /** App build, for telling recordings apart. */
  app: string;
  fixes: Fix[];
  /** The nav events, each with the time of the fix that caused it. */
  events: { at: number; event: NavEvent }[];
  log: DirectorLogEntry[];
  /** Rider taps that change the ride: skip, pause, end, choose a stop. */
  taps: { at: number; what: string; arg?: string | number }[];
  endedAt: number | null;
}

/* ------------------------------------------------------------------ positioning */

export interface Fix {
  lng: number;
  lat: number;
  /** Horizontal accuracy in metres (68 percent radius). */
  accuracy: number;
  /** Degrees clockwise from north, or null when unknown. */
  heading: number | null;
  /** Metres per second, or null when unknown. */
  speed: number | null;
  /** Milliseconds. Real sources use Date.now(); the simulator uses its own clock. */
  time: number;
}

export type GpsError = "denied" | "unavailable" | "timeout" | "unsupported";

/** Anything that produces position fixes: the device GPS or the simulator. */
export interface FixSource {
  start(onFix: (fix: Fix) => void, onError: (error: GpsError) => void): void;
  stop(): void;
  /** Simulator only: freeze movement while the rider would be standing at a stop. */
  hold?(on: boolean): void;
  /** Simulator only: its own clock in milliseconds, which runs faster than real time. */
  now?(): number;
}

/* ------------------------------------------------------------------ navigation */

export type NavStatus =
  | "idle"        // no ride in progress
  | "locating"    // ride started, waiting for the first usable fix
  | "to_start"    // usable fixes, but the rider is not on the route yet: guide them to the nearest point
  | "riding"      // following a segment
  | "at_stop"     // inside a stop's arrival radius
  | "finished";   // arrived at the last stop

export interface NavState {
  status: NavStatus;
  fix: Fix | null;
  /** Position snapped onto the route, or null before the first snap. */
  snapped: LngLat | null;
  /** Index of the stop being ridden towards. 0 means the start. */
  seg: number;
  /** Metres ridden along the current segment. */
  alongSeg: number;
  /** Metres left to the stop being ridden towards. */
  toStop: number;
  /** Metres ridden since the start of the route, and metres left to the end. */
  distanceDone: number;
  distanceLeft: number;
  /** Bearing of the route at the snapped point, degrees clockwise from north. */
  routeBearing: number | null;
  offRoute: boolean;
  /** Metres between the fix and the route. */
  offBy: number;
  /** The next manoeuvre ahead on this segment and the metres to it. */
  nextCue: Cue | null;
  toCue: number | null;
  /** The stretch being ridden now (the last manoeuvre passed). */
  currentCue: Cue | null;
  /** Indexes of stops already arrived at. */
  arrived: number[];
  /** Off route with a way back found: the line to follow. Null or absent otherwise. */
  detour?: Detour | null;
  /** While `to_start`: the nearest point of the route, for a rider who wants to join part way. */
  nearest?: { at: LngLat; seg: number; dist: number } | null;
  /** The manoeuvre after `nextCue`, when it follows within 120 m of it, and the metres between the two. */
  thenCue?: Cue | null;
  toThen?: number | null;
  /** Smoothed speed over the last 20 s or so, metres per second. Null before there is enough data. */
  speedAvg?: number | null;
  /** The rider is on the line but heading against it. */
  wrongWay?: boolean;
}

export type NavEvent =
  | { type: "cue"; cue: Cue; phase: "approach" | "now" }
  | { type: "arrive"; stop: number }
  | { type: "leave"; stop: number }
  | { type: "aside"; aside: Aside }
  | { type: "off_route" }
  | { type: "back_on_route" }
  /** A way back was looked for after going off route. */
  | { type: "detour"; found: boolean }
  /** A turn on the detour is coming up. */
  | { type: "detour_turn"; turn: TurnKind; name: string }
  /** The rider has been following the route backwards for a while. Fires once per spell. */
  | { type: "wrong_way" }
  | { type: "finished" };

export interface NavOptions {
  /** Ignore fixes worse than this many metres. */
  maxAccuracy: number;
  /** Metres from the route beyond which the rider is off route (plus accuracy allowance). */
  offRouteDistance: number;
  /** Seconds the rider must stay beyond it before `off_route` fires. */
  offRouteDelay: number;
  /** Metres before a manoeuvre at which "now" fires. */
  cueNowDistance: number;
  /** Seconds of warning for the "approach" phase; the distance is speed times this, at least cueApproachMin metres. */
  cueApproachSeconds: number;
  cueApproachMin: number;
  /** Metres before an aside's anchor at which it is offered. */
  asideLead: number;
}

export interface NavEngine {
  /** Feed one fix; returns the events it caused, in order. */
  update(fix: Fix): NavEvent[];
  readonly state: NavState;
  /** Start riding towards stop `seg` regardless of position (rider skipped ahead or back). */
  jumpToSegment(seg: number): void;
  /**
   * Begin the ride at stop `stop` instead of stop 0: guidance to it as to stop 0, the stops before it behind and
   * skipped (not arrived), then on to the last stop. Called once, before the first fix. (Task 25.)
   */
  startAt?(stop: number): void;
  /** Give the engine the corridor graph so it can find a way back when off route. */
  setGraph?(graph: RouteGraph | null): void;
  reset(): void;
}

/* ------------------------------------------------------------------ settings */

export interface Settings {
  storyVoice: boolean;
  navVoice: boolean;
  ambience: boolean;
  music: boolean;
  /** How often passing-by stories play. */
  asides: "off" | "sparse" | "rich";
  /** Start a stop's core stories on arrival without a tap. */
  autoPlayStories: boolean;
  keepAwake: boolean;
  /** Rotate the map so the direction of travel points up. */
  courseUp: boolean;
  /** Bring the map back to the rider a few seconds after they stop touching it. */
  autoRecentre: boolean;
  /** How loud the soundscape and music sit under the narrator. */
  bedLevel: "soft" | "balanced" | "rich";
  /** Vibrate at turns and arrivals (where the device can). */
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  storyVoice: true, navVoice: true, ambience: true, music: true,
  asides: "sparse", autoPlayStories: true, keepAwake: true, courseUp: true,
  autoRecentre: true, bedLevel: "balanced", haptics: true,
};

/* ------------------------------------------------------------------ sound */

/** What the rider is hearing or reading right now. */
export type NowPlaying =
  | { kind: "story"; stop: number; story: Story; para: number; paused: boolean; manual: boolean }
  | { kind: "aside"; aside: Aside }
  | null;

export interface PlayHandle {
  /** Resolves when playback ends by itself, rejects with "stopped" when cut short. */
  done: Promise<void>;
  stop(): void;
}

/** The recorded signature sounds. Files: public/sounds/signals/<name>.mp3. */
export type SignalName = "aside" | "arrive" | "close" | "finish";

/**
 * One moment on the sound timeline the mixer records (virtual and real mode): when something starts being heard and
 * when it is silent again. The dead-end hunt reads it.
 */
export interface SoundEvent {
  /** Mixer clock, milliseconds (MixerOptions.clock, else Date.now()). */
  at: number;
  /** voice: stories and asides. nav: cues and system clips. signal: signature sounds (they use the nav queue). */
  ch: "voice" | "nav" | "signal" | "effect" | "ambience" | "music";
  /** on: starts being heard (the start of its fade in). off: silent again (the end of its fade out, or its end). */
  ev: "on" | "off";
  /** The clip path, signal name, effect name, soundscape name or music theme. */
  src: string;
  /** voice and nav: the playhead in seconds at this moment. */
  pos?: number;
  /** On an `off`: the clip reached its own end (not stopped, paused or made to yield). */
  ended?: true;
}

/**
 * All sound goes through the mixer. Speech never talks over speech: a turn cue makes a story or an aside yield (at
 * the next phrase break when there is time, else at once with a short fade), speaks, then the narration resumes from
 * the start of the phrase it cut. Every start, pause, resume, stop and seek of the voice is a short fade.
 */
export interface Mixer {
  /** Must be called from a tap so the browser allows audio for the rest of the ride. */
  unlock(): Promise<void>;
  /**
   * Narration channel: stories and asides. `onTime` reports the playhead in seconds. `breaks` are the clip's phrase
   * starts (StoryAudio.breaks). Replacing a clip fades the old one out before the new one starts.
   */
  playVoice(src: string, opts?: { onTime?: (seconds: number) => void; estimatedSeconds?: number; breaks?: number[] }): PlayHandle;
  /** The rider's pause: fades out. */
  pauseVoice(): void;
  /** Fades back in. After a pause longer than 20 s it picks up from the start of the phrase. */
  resumeVoice(): void;
  /** Fades out over `fadeSeconds` (default 0.15) and drops the clip; its `done` rejects with "stopped" at once. */
  stopVoice(fadeSeconds?: number): void;
  /**
   * Navigation channel: turn cues and system clips, queued in order. While it speaks the voice channel yields.
   * Not urgent: the narration may run on to its next break if that is within 3 s. Urgent: it yields at once.
   */
  playNav(src: string, opts?: { estimatedSeconds?: number; urgent?: boolean }): PlayHandle;
  /** A signature sound, queued on the nav channel so it never sounds over speech. Resolves when it has sounded. */
  signal(name: SignalName): Promise<void>;
  /** A one-shot effect (src/audio/catalogue.json) on the bed bus, carved by the pocket like the rest of the bed. */
  playEffect(name: string, opts?: { level?: number }): void;
  /**
   * The bed under a story: a soundscape (recipe name) and a music theme (catalogue name), either may be null.
   * A layer that is already playing keeps playing; a changed layer crossfades over about 2.5 s; a new bed fades in
   * over about 3 s.
   */
  startBed(ambience: string | null, music: string | null): void;
  /** Fade the whole bed to silence over `fadeSeconds` (default 1). */
  stopBed(fadeSeconds?: number): void;
  /**
   * Get these ready ahead of need. Never throws, never plays. A clip path (pack-relative or absolute) is fetched into
   * the cache; "ambience:<name>" decodes that soundscape's recordings and "music:<theme>" decodes the theme.
   */
  preload(srcs: string[]): void;
  /** A short non-verbal tick on the nav channel: "the turn is here". */
  tick?(): void;
  /**
   * Move the voice playhead by this many seconds (negative to go back), with a short fade. Going back lands on the
   * last break at or before the target when the clip has breaks. Does nothing when no voice clip is loaded.
   */
  seekVoice?(deltaSeconds: number): void;
  /**
   * Move the voice playhead to exactly `seconds` into the clip (clamped to the clip), with the same short fade as
   * seekVoice and no snapping to breaks. A tap to the next or previous paragraph lands here (task 32). Does nothing
   * when no voice clip is loaded.
   */
  seekVoiceTo?(seconds: number): void;
  /**
   * Fade out every effect still sounding (story effects from playEffect) over `fadeSeconds` (default 0.3), then stop
   * them. Effects started afterwards play as usual. A story that is stopped, skipped or paused takes its effects with
   * it (task 32).
   */
  stopEffects?(fadeSeconds?: number): void;
  /** Scale the soundscape and music: 1 is the designed balance. */
  setBedLevel?(level: number): void;
  /**
   * Stop everything at once and release the audio context (the screens that make their own mixer drop it when they
   * close). Every sound still on the timeline gets its `off` at this moment, and the mixer leaves the live list.
   */
  dispose?(): void;
  /** True while the nav channel is speaking (a signal counts). */
  readonly navBusy: boolean;
  /** True while the voice channel is playing or paused mid-clip. */
  readonly voiceBusy: boolean;
}

export interface MixerOptions {
  /** Base URL that pack-relative audio paths are resolved against. */
  baseUrl: string;
  /** Test mode: no real audio. Clips "play" for their estimated length divided by timeScale. */
  virtual?: boolean;
  timeScale?: number;
  /** Clock for the sound timeline and for the 20 s pause rule, milliseconds. Defaults to Date.now. */
  clock?: Clock;
  /** Who made this mixer, for the live list (window.__verstaSound). Defaults to "unknown". */
  owner?: MixerOwner;
}

/** The screens that make their own mixer. Only one of them should be heard at a time. */
export type MixerOwner = "ride" | "practice" | "nearby" | "soundcheck";

/**
 * One mixer that exists right now, as `window.__verstaSound.live()` lists them (task 32): the dead-end hunt checks
 * that nothing is left sounding after the rider leaves what started it. `sounding` holds "<ch>:<src>" for every `on`
 * on the mixer's timeline that has no `off` yet (a sound fading out still counts).
 */
export interface LiveMixer { owner: MixerOwner | "unknown"; sounding: string[] }

/* ------------------------------------------------------------------ director */

/** Clock the director uses for its pacing rules, in milliseconds. Injectable so tests and the simulator can run fast. */
export type Clock = () => number;

export interface DirectorDeps {
  pack: Pack;
  mixer: Mixer;
  settings: () => Settings;
  clock: Clock;
  /** How many times faster than real time the ride runs (1 on a real ride). Divide real-timer waits by it. */
  timeScale: number;
  /** Called whenever what is playing changes, so the UI can follow. */
  onNowPlaying: (now: NowPlaying) => void;
  /** Called for every decision worth recording: played, skipped and why. Feeds the debug log and the tests. */
  onLog: (entry: DirectorLogEntry) => void;
}

export interface DirectorLogEntry {
  at: number;
  what:
    | "cue_spoken" | "cue_shown" | "arrive" | "story_start" | "story_end" | "story_stopped"
    | "aside_played" | "aside_skipped" | "off_route" | "back_on_route" | "detour" | "detour_turn" | "wrong_way" | "finished"
    /** A timed effect fired: id is the story id, reason is "<para>:<effect name>". */
    | "effect"
    /** A signature sound was asked for: id is the signal name. */
    | "signal";
  id?: string;
  reason?: string;
}

/**
 * The director decides what the rider hears: it turns navigation events into speech,
 * runs the story queue at each stop, and paces the passing-by stories.
 */
export interface Director {
  handle(events: NavEvent[], nav: NavState): void;
  /** Play one story now (a tap in the UI). Core stories still queued at that stop follow it. */
  playStory(stop: number, storyId: string): void;
  /** Play the unheard stories at a stop, core first. */
  playStop(stop: number): void;
  /**
   * The rider's pause. Pausing fades the voice, and the story's soundscape and music to silence within 1 s, and stops
   * its effects; resuming brings them back (task 32).
   */
  togglePause(): void;
  /** Read-by-tapping mode (story voice off or audio failed): go to the next paragraph. */
  nextParagraph(): void;
  /**
   * Move the story on screen to the next (+1) or previous (-1) paragraph: a tap on the story text (task 32). A
   * recorded story's voice jumps to the start of that paragraph (its mark); a story read by tapping shows it. +1 on
   * the last paragraph does what skip() does. -1 on the first paragraph goes back to its start. The effects of the
   * paragraph landed on sound at once, effects jumped over never sound, and going back arms them again. A paused
   * story stays paused at the new place. Does nothing while an aside plays, or when no story is on screen.
   */
  stepPara?(delta: 1 | -1): void;
  /**
   * Skip to the next queued story. When none is left the story view closes in silence: no close signal, the bed fades
   * within 1.5 s and does not linger (task 32). Only a story that ends by itself gets the close signal and the linger.
   */
  skip(): void;
  /**
   * The rider's Back or Stop: end the story, its queue, a story about to start on arrival and any passing-by story,
   * at once and in silence (no signal). The voice fades in 0.15 s, the bed within 1.5 s, effects within 0.3 s. Turn
   * cues already queued still speak.
   */
  stopAll(): void;
  /** Story ids the rider has started. */
  readonly heard: ReadonlySet<string>;
  /** Mark stories and asides as already heard (resuming an earlier ride). */
  markHeard?(ids: string[]): void;
  /** Go back in the story or aside that is playing ("what did he just say?"). */
  rewind?(seconds: number): void;
  dispose(): void;
}
