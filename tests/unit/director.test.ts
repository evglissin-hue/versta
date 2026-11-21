import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import packJson from "../../public/packs/thames-loop/pack.json";
import { createMixer, type MixerWithBed } from "../../src/audio/mixer";
import { createDirector } from "../../src/story/director";
import { DEFAULT_SETTINGS, type Cue, type Director, type DirectorLogEntry, type Mixer, type NavEvent, type NavState, type NowPlaying, type Pack, type Settings } from "../../src/types";

const pack = packJson as unknown as Pack;
const DEPTFORD = 4;

const NAV: NavState = {
  status: "riding", fix: null, snapped: null, seg: 3, alongSeg: 100, toStop: 1000, distanceDone: 0, distanceLeft: 0,
  routeBearing: null, offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [],
};
const nav = (o: Partial<NavState> = {}): NavState => ({ ...NAV, ...o });

interface Rig {
  d: Director; mixer: MixerWithBed; log: DirectorLogEntry[]; now: NowPlaying[]; settings: Settings;
  playNav: MockInstance<Mixer["playNav"]>;
}

function rig(patch: Partial<Settings> = {}, withPack: Pack = pack): Rig {
  const settings = { ...DEFAULT_SETTINGS, ...patch };
  const mixer = createMixer({ baseUrl: "", virtual: true });
  const playNav = vi.spyOn(mixer, "playNav");
  const log: DirectorLogEntry[] = [];
  const now: NowPlaying[] = [];
  const d = createDirector({
    pack: withPack, mixer, settings: () => settings, clock: () => Date.now(), timeScale: 1,
    onNowPlaying: (n) => now.push(n), onLog: (e) => log.push(e),
  });
  return { d, mixer, log, now, settings, playNav };
}

const ms = (n: number) => vi.advanceTimersByTimeAsync(n);
const whats = (r: Rig) => r.log.map((e) => `${e.what}${e.id ? ":" + e.id : ""}${e.reason ? ":" + e.reason : ""}`);
const last = (r: Rig) => r.now.at(-1);
const arrive = (stop: number): NavEvent[] => [{ type: "arrive", stop }];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("arrival", () => {
  it("plays both core stories at Deptford in order, with paragraph updates, then clears", async () => {
    const r = rig();
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(400_000);
    const stories = r.now.filter((n) => n?.kind === "story");
    const ids = [...new Set(stories.map((n) => (n?.kind === "story" ? n.story.id : "")))];
    expect(ids).toEqual(["peter-the-great-0", "peter-the-great-1"]);
    for (const id of ids) {
      const paras = stories.filter((n) => n?.kind === "story" && n.story.id === id).map((n) => (n?.kind === "story" ? n.para : -1));
      const story = pack.stops[DEPTFORD]!.stories.find((s) => s.id === id)!;
      expect(paras[0]).toBe(0);
      expect(paras.at(-1)).toBe(story.paras.length - 1);
      expect([...paras].sort((a, b) => a - b)).toEqual(paras);
    }
    expect(last(r)).toBeNull();
    expect(whats(r)).toEqual([
      "arrive:4", "story_start:peter-the-great-0", "story_end:peter-the-great-0",
      "story_start:peter-the-great-1", "story_end:peter-the-great-1",
    ]);
    expect(r.mixer.bed).toBeNull();
    expect(r.mixer.voiceBusy).toBe(false);
    expect([...r.d.heard]).toEqual(["peter-the-great-0", "peter-the-great-1"]);
  });

  it("plays nothing with auto-play off, but still speaks the arrival", async () => {
    const r = rig({ autoPlayStories: false });
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(20_000);
    expect(r.now.filter((n) => n !== null)).toEqual([]);
    expect(whats(r)).toEqual(["arrive:4"]);
    expect(r.playNav).toHaveBeenCalledWith(pack.system.arrive[DEPTFORD], expect.anything());
    expect(r.mixer.voiceBusy).toBe(false);
  });

  it("starts the bed from the story and stop, and honours the settings", () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "bright" });
    const q = rig({ ambience: false });
    q.d.playStop(DEPTFORD);
    expect(q.mixer.bed).toEqual({ ambience: null, music: "bright" });
    const z = rig({ ambience: false, music: false });
    z.d.playStop(DEPTFORD);
    expect(z.mixer.bed).toBeNull();
  });
});

describe("a cue in the middle of a story", () => {
  it("pauses the story, speaks, and the story still finishes with its full length", async () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    await ms(10_000);
    const cue = pack.cues.find((c) => c.turn === "left" && !c.quiet)!;
    r.d.handle([{ type: "cue", cue, phase: "approach" }], nav());
    expect(r.mixer.navBusy).toBe(true);
    expect(r.mixer.voiceBusy).toBe(true);
    const parasBefore = r.now.length;
    await ms(1500);
    expect(r.now.length).toBe(parasBefore);
    await ms(400_000);
    const start = r.log.find((e) => e.what === "story_start")!.at;
    const end = r.log.find((e) => e.what === "story_end")!.at;
    const dur = pack.stops[DEPTFORD]!.stories[0]!.audio!.dur;
    const cueSeconds = cue.say.split(/\s+/).length / 2.6;
    expect((end - start) / 1000).toBeCloseTo(dur + cueSeconds + 0.25, 1);
  });
});

describe("passing-by stories", () => {
  const a0 = pack.asides[0]!, a1 = pack.asides[1]!;
  const aside = (a = a0): NavEvent[] => [{ type: "aside", aside: a }];
  /** Start riding, then wait out the first minute so only the rule under test can stop an aside. */
  async function riding(r: Rig) {
    r.d.handle([], nav());
    await ms(61_000);
  }
  const skipped = (r: Rig) => r.log.filter((e) => e.what === "aside_skipped").map((e) => e.reason);

  it("plays an aside: chime, then the clip, then clears", async () => {
    const r = rig();
    await riding(r);
    r.d.handle(aside(), nav());
    await ms(1300);
    expect(last(r)).toEqual({ kind: "aside", aside: a0 });
    expect(whats(r)).toEqual([`aside_played:${a0.id}`]);
    await ms(120_000);
    expect(last(r)).toBeNull();
    expect(r.d.heard.has(a0.id)).toBe(true);
  });

  it("skips: off", async () => {
    const r = rig({ asides: "off" });
    await riding(r);
    r.d.handle(aside(), nav());
    expect(skipped(r)).toEqual(["off"]);
  });

  it("skips: heard", async () => {
    const r = rig();
    await riding(r);
    r.d.handle(aside(), nav());
    await ms(120_000);
    r.d.handle(aside(), nav());
    expect(skipped(r)).toEqual(["heard"]);
  });

  it("skips: busy, while a story plays", async () => {
    const r = rig();
    await riding(r);
    r.d.playStop(DEPTFORD);
    r.d.handle(aside(), nav());
    expect(skipped(r)).toEqual(["busy"]);
  });

  it("skips: not_riding, at a stop and off route", async () => {
    const r = rig();
    await riding(r);
    r.d.handle(aside(), nav({ status: "at_stop" }));
    r.d.handle(aside(a1), nav({ offRoute: true }));
    expect(skipped(r)).toEqual(["not_riding", "not_riding"]);
  });

  it("skips: near_stop within 150 m", async () => {
    const r = rig();
    await riding(r);
    r.d.handle(aside(), nav({ toStop: 150 }));
    expect(skipped(r)).toEqual(["near_stop"]);
  });

  it("skips: near_turn within 80 m, plays when no turn is ahead", async () => {
    const r = rig();
    await riding(r);
    r.d.handle(aside(), nav({ toCue: 80 }));
    expect(skipped(r)).toEqual(["near_turn"]);
    r.d.handle(aside(), nav({ toCue: 81 }));
    await ms(1300);
    expect(last(r)?.kind).toBe("aside");
  });

  it("skips: too_soon in the first minute of riding", async () => {
    const r = rig();
    r.d.handle([], nav());
    await ms(30_000);
    r.d.handle(aside(), nav());
    expect(skipped(r)).toEqual(["too_soon"]);
  });

  it("skips: too_soon in the first minute after leaving a stop", async () => {
    const r = rig();
    await riding(r);
    r.d.handle([{ type: "leave", stop: 3 }], nav());
    await ms(30_000);
    r.d.handle(aside(), nav());
    expect(skipped(r)).toEqual(["too_soon"]);
  });

  async function twoAsides(mode: "sparse" | "rich") {
    const r = rig({ asides: mode });
    await riding(r);
    r.d.handle(aside(a0), nav());
    await ms(1200);
    while (r.mixer.voiceBusy) await ms(1000);
    const endedAt = Date.now();
    await ms(100_000 - (Date.now() - endedAt));
    r.d.handle(aside(a1), nav());
    return r;
  }

  it("two asides 100 s apart: the second is too_soon in sparse", async () => {
    const r = await twoAsides("sparse");
    expect(skipped(r)).toEqual(["too_soon"]);
  });

  it("two asides 100 s apart: the second plays in rich", async () => {
    const r = await twoAsides("rich");
    expect(skipped(r)).toEqual([]);
    await ms(1300);
    expect(last(r)).toEqual({ kind: "aside", aside: a1 });
  });

  it("an arrival cuts an aside short", async () => {
    const r = rig({ autoPlayStories: false });
    await riding(r);
    r.d.handle(aside(), nav());
    await ms(5000);
    r.d.handle(arrive(1), nav({ status: "at_stop" }));
    await ms(0);
    expect(last(r)).toBeNull();
    expect(r.mixer.voiceBusy).toBe(false);
  });
});

describe("skip and stopAll", () => {
  it("skip moves to the next queued story and logs the reason", async () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    await ms(10_000);
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "bright" });
    r.d.skip();
    expect(whats(r)).toContain("story_stopped:peter-the-great-0:skip");
    const n = last(r);
    expect(n?.kind === "story" && n.story.id).toBe("peter-the-great-1");
    expect(r.mixer.bed).toEqual({ ambience: "tavern", music: "solemn" });
    await ms(0);
    expect(last(r)?.kind).toBe("story");
  });

  it("skip on the last story ends the story view", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, "peter-the-great-1");
    await ms(5000);
    r.d.skip();
    r.d.skip();
    expect(last(r)).toBeNull();
    expect(r.mixer.voiceBusy).toBe(false);
    expect(r.mixer.bed).toBeNull();
  });

  it("stopAll leaves nothing playing, nothing queued and the bed stopped", async () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    await ms(10_000);
    r.d.stopAll();
    expect(last(r)).toBeNull();
    expect(r.mixer.voiceBusy).toBe(false);
    expect(r.mixer.bed).toBeNull();
    const count = r.now.length;
    await ms(400_000);
    expect(r.now.length).toBe(count);
  });

  it("playStory plays the chosen story first, then the other unheard core stories", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, "peter-the-great-1");
    await ms(400_000);
    const ids = [...new Set(r.now.filter((n) => n?.kind === "story").map((n) => (n?.kind === "story" ? n.story.id : "")))];
    expect(ids).toEqual(["peter-the-great-1", "peter-the-great-0"]);
  });

  it("togglePause pauses and resumes the story", async () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    await ms(5000);
    r.d.togglePause();
    expect(last(r)).toMatchObject({ kind: "story", paused: true });
    await ms(300_000);
    expect(last(r)).toMatchObject({ kind: "story", paused: true });
    r.d.togglePause();
    expect(last(r)).toMatchObject({ kind: "story", paused: false });
    await ms(300_000);
    expect(r.d.heard.size).toBe(2);
  });
});

describe("read by tapping", () => {
  it("walks the paragraphs with nextParagraph, then the story ends", async () => {
    const r = rig({ storyVoice: false });
    r.d.playStory(DEPTFORD, "peter-the-great-1");
    const story = pack.stops[DEPTFORD]!.stories[1]!;
    expect(last(r)).toMatchObject({ kind: "story", para: 0, manual: true });
    expect(r.mixer.voiceBusy).toBe(false);
    for (let i = 1; i < story.paras.length; i++) {
      r.d.nextParagraph();
      expect(last(r)).toMatchObject({ para: i });
    }
    r.d.nextParagraph();
    expect(whats(r)).toContain("story_end:peter-the-great-1");
    await ms(2400);
    expect(last(r)).toMatchObject({ kind: "story", story: { id: "peter-the-great-1" } });
    await ms(200);
    expect(last(r)).toMatchObject({ kind: "story", story: { id: "peter-the-great-0" }, para: 0, manual: true });
  });

  it("clears after the last story and fades the bed", async () => {
    const r = rig({ storyVoice: false });
    r.d.playStop(DEPTFORD);
    for (let i = 0; i < 20; i++) r.d.nextParagraph();
    await ms(2600);
    expect(last(r)).toMatchObject({ story: { id: "peter-the-great-1" } });
    for (let i = 0; i < 20; i++) r.d.nextParagraph();
    expect(last(r)).toMatchObject({ story: { id: "peter-the-great-1" } });
    await ms(2600);
    expect(last(r)).toBeNull();
    expect(r.mixer.bed).toBeNull();
  });

  it("falls back to tapping when the clip fails", async () => {
    const r = rig();
    vi.spyOn(r.mixer, "playVoice").mockImplementation(() => ({ done: Promise.reject("error"), stop: () => {} }));
    r.d.playStory(DEPTFORD, "peter-the-great-1");
    await ms(0);
    expect(last(r)).toMatchObject({ kind: "story", para: 0, manual: true });
  });
});

describe("turn cues", () => {
  const cue = pack.cues.find((c) => c.turn === "left" && !c.quiet)!;
  const quiet = pack.cues.find((c) => c.quiet) as Cue;

  it("never speaks the same cue twice", async () => {
    const r = rig();
    r.d.handle([{ type: "cue", cue, phase: "approach" }], nav());
    r.d.handle([{ type: "cue", cue, phase: "approach" }], nav());
    r.d.handle([{ type: "cue", cue, phase: "now" }], nav());
    await ms(10_000);
    expect(r.playNav).toHaveBeenCalledTimes(1);
    expect(whats(r)).toEqual([`cue_spoken:${cue.id}`]);
  });

  it("speaks at now when the approach was never spoken", () => {
    const r = rig();
    r.d.handle([{ type: "cue", cue, phase: "now" }], nav());
    expect(r.playNav).toHaveBeenCalledTimes(1);
  });

  it("speaks a depart cue", () => {
    const depart = pack.cues.find((c) => c.turn === "depart")!;
    const r = rig();
    r.d.handle([{ type: "cue", cue: depart, phase: "now" }], nav());
    expect(r.playNav).toHaveBeenCalledWith(depart.audio, expect.anything());
  });

  it("logs a quiet cue as shown and does not speak it", () => {
    const r = rig();
    r.d.handle([{ type: "cue", cue: quiet, phase: "approach" }], nav());
    r.d.handle([{ type: "cue", cue: quiet, phase: "now" }], nav());
    expect(r.playNav).not.toHaveBeenCalled();
    expect(whats(r)).toEqual([`cue_shown:${quiet.id}`]);
  });

  it("logs cues as shown when the nav voice is off", () => {
    const r = rig({ navVoice: false });
    r.d.handle([{ type: "cue", cue, phase: "approach" }], nav());
    expect(r.playNav).not.toHaveBeenCalled();
    expect(whats(r)).toEqual([`cue_shown:${cue.id}`]);
  });

  it("speaks off route and back on route, and logs them", () => {
    const r = rig();
    r.d.handle([{ type: "off_route" }], nav({ offRoute: true }));
    r.d.handle([{ type: "back_on_route" }], nav());
    expect(r.playNav.mock.calls.map((c) => c[0])).toEqual([pack.system.offRoute, pack.system.backOnRoute]);
    expect(whats(r)).toEqual(["off_route", "back_on_route"]);
  });

  it("logs finished", () => {
    const r = rig();
    r.d.handle([{ type: "finished" }], nav({ status: "finished" }));
    expect(whats(r)).toEqual(["finished"]);
  });
});

describe("way back after going off route", () => {
  const withClips: Pack = {
    ...pack,
    system: { ...pack.system, rerouting: "audio/system/rerouting.mp3", turns: { left: "audio/system/turn-left.mp3", slight_right: "audio/system/bear-right.mp3" } },
  };
  const detour = (found: boolean): NavEvent[] => [{ type: "detour", found }];
  const turn = (t: "left" | "slight_right" | "sharp_left"): NavEvent[] => [{ type: "detour_turn", turn: t, name: "Mill Lane" }];

  it("speaks the rerouting clip once per detour event, and logs it", () => {
    const r = rig({}, withClips);
    r.d.handle(detour(true), nav({ offRoute: true }));
    expect(r.playNav).toHaveBeenCalledTimes(1);
    expect(r.playNav).toHaveBeenCalledWith("audio/system/rerouting.mp3", expect.anything());
    expect(whats(r)).toEqual(["detour"]);
  });

  it("says nothing for a failed search, with nav voice off, or when the pack has no clip", () => {
    const r = rig({}, withClips);
    r.d.handle(detour(false), nav({ offRoute: true }));
    expect(r.playNav).not.toHaveBeenCalled();
    const quiet = rig({ navVoice: false }, withClips);
    quiet.d.handle(detour(true), nav({ offRoute: true }));
    quiet.d.handle(turn("left"), nav({ offRoute: true }));
    expect(quiet.playNav).not.toHaveBeenCalled();
    const bare = rig({}, { ...pack, system: { arrive: pack.system.arrive, offRoute: pack.system.offRoute, backOnRoute: pack.system.backOnRoute } });
    bare.d.handle(detour(true), nav({ offRoute: true }));
    bare.d.handle(turn("left"), nav({ offRoute: true }));
    expect(bare.playNav).not.toHaveBeenCalled();
  });

  it("speaks each turn clip once, in order, and skips a turn the pack has no clip for", () => {
    const r = rig({}, withClips);
    r.d.handle([...detour(true), ...turn("left"), ...turn("sharp_left"), ...turn("slight_right")], nav({ offRoute: true }));
    expect(r.playNav.mock.calls.map((c) => c[0])).toEqual([
      "audio/system/rerouting.mp3", "audio/system/turn-left.mp3", "audio/system/bear-right.mp3",
    ]);
    expect(whats(r)).toEqual(["detour", "detour_turn:left:Mill Lane", "detour_turn:sharp_left:Mill Lane", "detour_turn:slight_right:Mill Lane"]);
  });

  it("markHeard stops a heard core story from auto-playing", async () => {
    const r = rig();
    r.d.markHeard?.(["peter-the-great-0"]);
    expect(r.d.heard.has("peter-the-great-0")).toBe(true);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(400_000);
    const ids = whats(r).filter((w) => w.startsWith("story_start"));
    expect(ids).toEqual(["story_start:peter-the-great-1"]);
  });

  it("an aside gets a soft bed from the stop last left, and the bed stops with the aside", async () => {
    const r = rig();
    r.d.handle([], nav());
    await ms(61_000);
    expect(r.mixer.bed).toBeNull();
    r.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 4 }));
    await ms(1300);
    expect(last(r)?.kind).toBe("aside");
    expect(r.mixer.bed).toEqual({ ambience: pack.stops[3]!.ambience, music: null });
    await ms(120_000);
    expect(last(r)).toBeNull();
    expect(r.mixer.bed).toBeNull();
  });

  it("an aside bed stops when an arrival cuts the aside, and is not started with ambience off", async () => {
    const r = rig({ autoPlayStories: false });
    r.d.handle([], nav());
    await ms(61_000);
    r.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 2 }));
    await ms(5000);
    expect(r.mixer.bed).not.toBeNull();
    r.d.handle(arrive(2), nav({ status: "at_stop", seg: 3 }));
    expect(r.mixer.bed).toBeNull();
    const q = rig({ ambience: false });
    q.d.handle([], nav());
    await ms(61_000);
    q.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 2 }));
    await ms(5000);
    expect(last(q)?.kind).toBe("aside");
    expect(q.mixer.bed).toBeNull();
  });
});

describe("spoken guidance", () => {
  const cue = pack.cues.find((c) => c.turn === "left")!;
  const cue2 = pack.cues.filter((c) => c.turn !== "depart")[5]!;
  const sys = pack.system;
  const approach = (c: Cue): NavEvent[] => [{ type: "cue", cue: c, phase: "approach" }];
  const turnNow = (c: Cue): NavEvent[] => [{ type: "cue", cue: c, phase: "now" }];
  const spoken = (r: Rig): string[] => r.playNav.mock.calls.map((c) => c[0]);

  it("a 110 m approach plays the 100 m clip then the cue, in that order", () => {
    const r = rig();
    r.d.handle(approach(cue), nav({ toCue: 110, nextCue: cue }));
    expect(spoken(r)).toEqual([sys.distances!["100"], cue.audio]);
    expect(whats(r)).toEqual([`cue_spoken:${cue.id}`]);
  });

  it("picks the largest distance not above the turn distance plus 15 m", () => {
    const pick = (toCue: number): string[] => {
      const r = rig();
      r.d.handle(approach(cue), nav({ toCue }));
      return spoken(r);
    };
    expect(pick(40)).toEqual([sys.distances!["50"], cue.audio]);
    expect(pick(136)).toEqual([sys.distances!["150"], cue.audio]);
    expect(pick(120)).toEqual([sys.distances!["100"], cue.audio]);
    expect(pick(330)).toEqual([sys.distances!["300"], cue.audio]);
  });

  it("a 30 m approach, or a pack with no distance clips, plays only the cue", () => {
    const r = rig();
    r.d.handle(approach(cue), nav({ toCue: 30 }));
    expect(spoken(r)).toEqual([cue.audio]);
    const bare = { ...pack, system: { ...pack.system, distances: undefined } } as Pack;
    const q = rig({}, bare);
    q.d.handle(approach(cue), nav({ toCue: 110 }));
    expect(spoken(q)).toEqual([cue.audio]);
  });

  it("the now phase ticks and stays silent after a spoken approach", () => {
    const r = rig();
    r.d.handle(approach(cue), nav({ toCue: 110 }));
    r.playNav.mockClear();
    r.d.handle(turnNow(cue), nav({ toCue: 10 }));
    expect(r.playNav).not.toHaveBeenCalled();
    expect(r.mixer.ticks).toBe(1);
    expect(whats(r)).toEqual([`cue_spoken:${cue.id}`]);
  });

  it("an unannounced cue is spoken at now, with no tick and no distance", () => {
    const r = rig();
    r.d.handle(turnNow(cue), nav({ toCue: 10 }));
    expect(spoken(r)).toEqual([cue.audio]);
    expect(r.mixer.ticks).toBe(0);
    r.d.handle(turnNow(cue), nav({ toCue: 5 }));
    expect(spoken(r)).toEqual([cue.audio]);
    expect(whats(r)).toEqual([`cue_spoken:${cue.id}`]);
  });

  it("a depart cue is spoken, and a quiet cue or navVoice off is shown without sound or tick", () => {
    const depart = pack.cues.find((c) => c.turn === "depart")!;
    const r = rig();
    r.d.handle(turnNow(depart), nav());
    expect(spoken(r)).toEqual([depart.audio]);
    const q = rig({ navVoice: false });
    q.d.handle(approach(cue), nav({ toCue: 110 }));
    q.d.handle(turnNow(cue), nav({ toCue: 5 }));
    expect(q.playNav).not.toHaveBeenCalled();
    expect(q.mixer.ticks).toBe(0);
    expect(whats(q)).toEqual([`cue_shown:${cue.id}`]);
  });

  it("every spoken cue logs cue_spoken exactly once across approach and now", () => {
    const r = rig();
    for (const c of [cue, cue2]) {
      r.d.handle(approach(c), nav({ toCue: 120 }));
      r.d.handle(turnNow(c), nav({ toCue: 8 }));
    }
    expect(whats(r)).toEqual([`cue_spoken:${cue.id}`, `cue_spoken:${cue2.id}`]);
  });

  it("rerouting is not repeated within 60 s, and is spoken again after", async () => {
    const r = rig();
    const found: NavEvent[] = [{ type: "detour", found: true }];
    r.d.handle(found, nav());
    await ms(20_000);
    r.d.handle(found, nav());
    await ms(30_000);
    r.d.handle(found, nav());
    expect(spoken(r)).toEqual([sys.rerouting]);
    await ms(15_000);
    r.d.handle(found, nav());
    expect(spoken(r)).toEqual([sys.rerouting, sys.rerouting]);
  });

  it("speaks the wrong way clip once per event and logs it; silent with navVoice off", () => {
    const r = rig();
    r.d.handle([{ type: "wrong_way" }], nav());
    expect(spoken(r)).toEqual([sys.wrongWay]);
    expect(whats(r)).toEqual(["wrong_way"]);
    const q = rig({ navVoice: false });
    q.d.handle([{ type: "wrong_way" }], nav());
    expect(q.playNav).not.toHaveBeenCalled();
    expect(whats(q)).toEqual(["wrong_way"]);
  });
});

describe("rewind", () => {
  const story = pack.stops[DEPTFORD]!.stories.find((s) => s.id === "peter-the-great-0")!;
  const paraNow = (r: Rig): number => {
    const n = r.now.at(-1);
    return n?.kind === "story" ? n.para : -1;
  };

  it("moves the playhead back and the paragraph follows", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, story.id);
    await ms(35_000);
    expect(paraNow(r)).toBe(2); // marks 30.14 and 51.06
    r.d.rewind!(15);
    expect(paraNow(r)).toBe(1);
    await ms(1000);
    expect(paraNow(r)).toBe(1); // the clip really is at about 21 s, so the paragraph stays
    await ms(10_000);
    expect(paraNow(r)).toBe(2); // and carries on from there
    r.d.rewind!(1000);
    expect(paraNow(r)).toBe(0);
    await ms(500);
    expect(paraNow(r)).toBe(0);
  });

  it("does nothing in read-by-tapping mode, with nothing playing, or after the story ended", async () => {
    const r = rig({ storyVoice: false });
    const seek = vi.spyOn(r.mixer, "seekVoice");
    r.d.playStory(DEPTFORD, story.id);
    r.d.nextParagraph();
    r.d.rewind!(15);
    expect(seek).not.toHaveBeenCalled();
    expect(paraNow(r)).toBe(1);
    const q = rig();
    const seekQ = vi.spyOn(q.mixer, "seekVoice");
    q.d.rewind!(15);
    expect(seekQ).not.toHaveBeenCalled();
  });

  it("seeks the passing-by story that is playing", async () => {
    const r = rig();
    const seek = vi.spyOn(r.mixer, "seekVoice");
    const aside = pack.asides[0]!;
    r.d.handle([], nav({ toStop: 2000, toCue: 500 }));
    await ms(61_000);
    r.d.handle([{ type: "aside", aside }], nav({ toStop: 2000, toCue: 500 }));
    await ms(2000);
    expect(r.now.at(-1)?.kind).toBe("aside");
    r.d.rewind!(10);
    expect(seek).toHaveBeenCalledWith(-10);
  });
});
