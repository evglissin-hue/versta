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

export interface StoryAudio { src: string; marks: number[]; dur: number }
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
}

export const DEFAULT_SETTINGS: Settings = {
  storyVoice: true, navVoice: true, ambience: true, music: true,
  asides: "sparse", autoPlayStories: true, keepAwake: true, courseUp: true,
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

/**
 * All sound goes through the mixer. Three voices never talk over each other:
 * a turn cue pauses a story or an aside, speaks, then the story resumes.
 */
export interface Mixer {
  /** Must be called from a tap so the browser allows audio for the rest of the ride. */
  unlock(): Promise<void>;
  /** Narration channel: stories and asides. `onTime` reports the playhead in seconds. */
  playVoice(src: string, opts?: { onTime?: (seconds: number) => void; estimatedSeconds?: number }): PlayHandle;
  pauseVoice(): void;
  resumeVoice(): void;
  stopVoice(): void;
  /** Navigation channel: turn cues and system clips. Pauses the voice channel while it speaks. */
  playNav(src: string, opts?: { estimatedSeconds?: number }): PlayHandle;
  /** Two strokes of a ship's bell, used before an aside. Resolves when it has rung. */
  chime(): Promise<void>;
  /** Generated soundscape and music under a story. Names come from Stop.ambience and Story.mood. */
  startBed(ambience: string | null, mood: Story["mood"] | null): void;
  stopBed(fadeSeconds?: number): void;
  /** True while the nav channel is speaking. */
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
}

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
    | "aside_played" | "aside_skipped" | "off_route" | "back_on_route" | "detour" | "detour_turn" | "finished";
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
  togglePause(): void;
  /** Read-by-tapping mode (story voice off or audio failed): go to the next paragraph. */
  nextParagraph(): void;
  /** Skip to the next queued story, or end the story view when none is left. */
  skip(): void;
  stopAll(): void;
  /** Story ids the rider has started. */
  readonly heard: ReadonlySet<string>;
  /** Mark stories and asides as already heard (resuming an earlier ride). */
  markHeard?(ids: string[]): void;
  dispose(): void;
}
