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
      "arrive:4", "signal:arrive", "story_start:peter-the-great-0",
      "effect:peter-the-great-0:3:hammer", "effect:peter-the-great-0:7:adze", "story_end:peter-the-great-0",
      "story_start:peter-the-great-1", "effect:peter-the-great-1:4:tankards", "story_end:peter-the-great-1", "signal:close",
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
    expect(whats(r)).toEqual(["arrive:4", "signal:arrive"]);
    expect(r.playNav).toHaveBeenCalledWith(pack.system.arrive[DEPTFORD], expect.anything());
    expect(r.mixer.voiceBusy).toBe(false);
  });

  it("starts the bed from the story and stop, and honours the settings", () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "russia" });
    const q = rig({ ambience: false });
    q.d.playStop(DEPTFORD);
    expect(q.mixer.bed).toEqual({ ambience: null, music: "russia" });
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
    // with phrase marks the cut sentence is replayed from its start, so a little more than the step back of 1.5 s
    expect((end - start) / 1000).toBeGreaterThan(dur + cueSeconds + 0.4);
    expect((end - start) / 1000).toBeLessThan(dur + cueSeconds + 8);
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
    await ms(3300);
    expect(last(r)).toEqual({ kind: "aside", aside: a0 });
    expect(whats(r)).toEqual(["signal:aside", `aside_played:${a0.id}`]);
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
    await ms(3300);
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
    await ms(3200);
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
    await ms(3300);
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
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "russia" });
    r.d.skip();
    expect(whats(r)).toContain("story_stopped:peter-the-great-0:skip");
    const n = last(r);
    expect(n?.kind === "story" && n.story.id).toBe("peter-the-great-1");
    expect(r.mixer.bed).toEqual({ ambience: "tavern", music: "noir" });
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
    // the bed lingers after the last story, then fades
    expect(r.mixer.bed).not.toBeNull();
    await ms(21_000);
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
    expect(r.mixer.bed).not.toBeNull();
    await ms(21_000);
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
    expect(whats(r)).toEqual(["finished", "signal:finish"]);
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
    await ms(3300);
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
    // the aside's bed gives way to the stop's own soundscape (no music: auto-play is off)
    expect(r.mixer.bed).toEqual({ ambience: pack.stops[2]!.ambience, music: null });
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
    await ms(14_000);
    expect(paraNow(r)).toBe(2); // and carries on from there (the seek lands on a phrase break, a little earlier)
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
    await ms(3500);
    expect(r.now.at(-1)?.kind).toBe("aside");
    r.d.rewind!(10);
    expect(seek).toHaveBeenCalledWith(-10);
  });
});

/* ------------------------------------------------------------------ the bed around stories (iteration 5) */

describe("the bed around stories", () => {
  const first = pack.stops[DEPTFORD]!.stories[0]!;
  const timeline = (r: Rig, ch: string, ev?: "on" | "off") => r.mixer.timeline.filter((e) => e.ch === ch && (ev === undefined || e.ev === ev));
  const logAt = (r: Rig, what: string): number[] => r.log.filter((e) => e.what === what).map((e) => e.at);
  /** Run until the log holds `n` story_end entries. */
  async function untilEnds(r: Rig, n: number): Promise<void> {
    for (let i = 0; i < 1000 && logAt(r, "story_end").length < n; i++) await ms(1000);
  }
  /** Deptford with both stories on the same soundscape and different themes. */
  const sameScape: Pack = (() => {
    const copy = structuredClone(pack);
    const [a, b] = copy.stops[DEPTFORD]!.stories;
    a!.music = "river";
    b!.music = "noir";
    delete b!.ambience;
    return copy;
  })();

  it("arrival with auto-play: signal, arrival clip, then the story, with the bed up at least 2.5 s before the voice", async () => {
    const r = rig();
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(30_000);
    const tl = r.mixer.timeline;
    const sig = tl.findIndex((e) => e.ch === "signal" && e.src === "arrive" && e.ev === "on");
    const clip = tl.findIndex((e) => e.ch === "nav" && e.src === pack.system.arrive[DEPTFORD] && e.ev === "on");
    const voice = tl.findIndex((e) => e.ch === "voice" && e.src === first.audio!.src && e.ev === "on");
    expect(sig).toBeGreaterThanOrEqual(0);
    expect(sig).toBeLessThan(clip);
    expect(clip).toBeLessThan(voice);
    const amb = tl.find((e) => e.ch === "ambience" && e.ev === "on")!;
    const mus = tl.find((e) => e.ch === "music" && e.ev === "on")!;
    expect(amb.src).toBe("yard");
    expect(mus.src).toBe("russia");
    expect(tl[voice]!.at - amb.at).toBeGreaterThanOrEqual(2500);
    expect(tl[voice]!.at - mus.at).toBeGreaterThanOrEqual(2500);
    expect(whats(r).slice(0, 3)).toEqual(["arrive:4", "signal:arrive", "story_start:peter-the-great-0"]);
  });

  it("arrival with the Soundscape switch off: no signal and no soundscape, but music and the story", async () => {
    const r = rig({ ambience: false });
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(30_000);
    expect(timeline(r, "signal")).toEqual([]);
    expect(timeline(r, "ambience")).toEqual([]);
    expect(timeline(r, "music", "on").map((e) => e.src)).toEqual(["russia"]);
    expect(timeline(r, "voice", "on").length).toBeGreaterThan(0);
  });

  it("two stories at one stop on one soundscape: it does not restart, the music crossfades", async () => {
    const r = rig({}, sameScape);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await untilEnds(r, 2);
    expect(timeline(r, "ambience", "on").map((e) => e.src)).toEqual(["yard"]);
    expect(timeline(r, "ambience", "off")).toEqual([]);
    expect(timeline(r, "music", "on").map((e) => e.src)).toEqual(["river", "noir"]);
    // the first theme goes off only after the second came on (a crossfade, not a gap)
    const noirOn = timeline(r, "music", "on")[1]!.at;
    const riverOff = timeline(r, "music", "off").find((e) => e.src === "river")!.at;
    expect(riverOff).toBeGreaterThan(noirOn);
  });

  it("after the last story: close, then the bed is off 25 to 27 s after the story ends", async () => {
    const r = rig();
    r.d.markHeard?.(["peter-the-great-0"]);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await untilEnds(r, 1);
    const end = logAt(r, "story_end")[0]!;
    await ms(40_000);
    expect(timeline(r, "signal", "on").map((e) => e.src)).toEqual(["arrive", "close"]);
    for (const ch of ["ambience", "music"]) {
      const off = timeline(r, ch, "off")[0]!;
      expect(off.at - end).toBeGreaterThanOrEqual(25_000);
      expect(off.at - end).toBeLessThanOrEqual(27_000);
    }
  });

  it("a leave 5 s after the last story fades the bed within 4.5 s", async () => {
    const r = rig();
    r.d.markHeard?.(["peter-the-great-0"]);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await untilEnds(r, 1);
    await ms(5000);
    const leaveAt = Date.now();
    r.d.handle([{ type: "leave", stop: DEPTFORD }], nav());
    await ms(10_000);
    const off = timeline(r, "ambience", "off")[0]!;
    expect(off.at - leaveAt).toBeLessThanOrEqual(4500);
    expect(r.mixer.bed).toBeNull();
  });

  it("a leave while the story plays fades the bed, the story goes on, and the next story gets no bed", async () => {
    const r = rig();
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(20_000);
    expect(r.mixer.bed).not.toBeNull();
    const leaveAt = Date.now();
    r.d.handle([{ type: "leave", stop: DEPTFORD }], nav());
    expect(r.mixer.bed).toBeNull();
    await ms(5000);
    expect(timeline(r, "ambience", "off")[0]!.at - leaveAt).toBeLessThanOrEqual(4500);
    expect(last(r)).toMatchObject({ kind: "story", story: { id: "peter-the-great-0" } });
    await ms(400_000);
    expect(whats(r)).toContain("story_start:peter-the-great-1");
    expect(timeline(r, "ambience", "on").length).toBe(1);
    expect(timeline(r, "signal", "on").map((e) => e.src)).toEqual(["arrive"]);
  });

  it("a story tapped away from a stop gets its bed again", () => {
    const r = rig();
    r.d.handle([{ type: "leave", stop: DEPTFORD }], nav());
    r.d.playStory(DEPTFORD, "peter-the-great-0");
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "russia" });
  });

  it("auto-play off: the soundscape alone for 30 s then a 6 s fade", async () => {
    const r = rig({ autoPlayStories: false });
    const t0 = Date.now();
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: null });
    await ms(60_000);
    expect(timeline(r, "music")).toEqual([]);
    const off = timeline(r, "ambience", "off")[0]!;
    expect(off.at - t0).toBeGreaterThanOrEqual(35_500);
    expect(off.at - t0).toBeLessThanOrEqual(36_500);
    expect(r.mixer.bed).toBeNull();
  });

  it("auto-play off: a tap within the 30 s keeps the soundscape and adds the music", async () => {
    const q = rig({ autoPlayStories: false });
    q.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(10_000);
    q.d.playStory(DEPTFORD, "peter-the-great-0");
    expect(q.mixer.bed).toEqual({ ambience: "yard", music: "russia" });
    await ms(60_000);
    expect(timeline(q, "ambience", "on").map((e) => e.src)).toEqual(["yard"]);
    expect(timeline(q, "ambience", "off")).toEqual([]);
    expect(timeline(q, "music", "on").map((e) => e.src)).toEqual(["russia"]);
  });

  it("an aside: the bell first, then the clip; an arrival fades it out within 0.45 s", async () => {
    const r = rig({ autoPlayStories: false });
    r.d.handle([], nav());
    await ms(61_000);
    const a = pack.asides[0]!;
    r.d.handle([{ type: "aside", aside: a }], nav({ seg: 2 }));
    await ms(10_000);
    const tl = r.mixer.timeline;
    const bell = tl.findIndex((e) => e.ch === "signal" && e.src === "aside" && e.ev === "on");
    const clip = tl.findIndex((e) => e.ch === "voice" && e.src === a.audio && e.ev === "on");
    expect(bell).toBeGreaterThanOrEqual(0);
    expect(bell).toBeLessThan(clip);
    expect(whats(r)).toContain("signal:aside");
    const arrivedAt = Date.now();
    r.d.handle(arrive(2), nav({ status: "at_stop", seg: 3 }));
    await ms(1500);
    const off = r.mixer.timeline.find((e) => e.ch === "voice" && e.src === a.audio && e.ev === "off")!;
    expect(off.at - arrivedAt).toBeLessThanOrEqual(450);
  });

  it("the aside bell rings even with the Soundscape switch off, and the aside is preloaded before it", async () => {
    const r = rig({ ambience: false });
    r.d.handle([], nav());
    await ms(61_000);
    r.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 2 }));
    expect(r.mixer.preloaded).toContain(pack.asides[0]!.audio);
    await ms(5000);
    expect(timeline(r, "signal", "on").map((e) => e.src)).toEqual(["aside"]);
    expect(r.mixer.bed).toBeNull();
  });

  it("finished at the last stop: arrival, its stories, then the finish flourish in place of the close", async () => {
    const r = rig();
    const last = pack.stops.length - 1;
    r.d.handle([{ type: "arrive", stop: last }, { type: "finished" }], nav({ status: "finished", seg: last }));
    await ms(600_000);
    const sig = timeline(r, "signal", "on").map((e) => e.src);
    expect(sig).toEqual(["arrive", "finish"]);
    const tl = r.mixer.timeline;
    const fin = tl.findIndex((e) => e.ch === "signal" && e.src === "finish" && e.ev === "on");
    const lastVoice = tl.map((e, i) => (e.ch === "voice" && e.ev === "off" ? i : -1)).filter((i) => i >= 0).pop()!;
    expect(fin).toBeGreaterThan(lastVoice);
  });

  it("finished: the finish signal after the nav queue, none with the Soundscape switch off", async () => {
    const r = rig();
    r.d.handle([{ type: "off_route" }, { type: "finished" }], nav({ status: "finished" }));
    await ms(10_000);
    const tl = r.mixer.timeline;
    const nav1 = tl.findIndex((e) => e.ch === "nav" && e.src === pack.system.offRoute && e.ev === "off");
    const fin = tl.findIndex((e) => e.ch === "signal" && e.src === "finish" && e.ev === "on");
    expect(nav1).toBeGreaterThanOrEqual(0);
    expect(fin).toBeGreaterThan(nav1);
    const q = rig({ ambience: false });
    q.d.handle([{ type: "off_route" }, { type: "finished" }], nav({ status: "finished" }));
    await ms(10_000);
    expect(timeline(q, "signal")).toEqual([]);
    expect(whats(q)).toEqual(["off_route", "finished"]);
  });
});

describe("urgency of spoken guidance", () => {
  const left = pack.cues.find((c) => c.turn === "left" && !c.quiet)!;
  const depart = pack.cues.find((c) => c.turn === "depart")!;
  const withTurns: Pack = { ...pack, system: { ...pack.system, turns: { left: "audio/system/turn-left.mp3" } } };
  const urgentOf = (r: Rig): boolean[] => r.playNav.mock.calls.map((c) => (c[1] as { urgent?: boolean }).urgent === true);

  it("an approach at 200 m and 5 m/s is not urgent; at 40 m and 5 m/s it is", () => {
    const far = rig();
    far.d.handle([{ type: "cue", cue: left, phase: "approach" }], nav({ toCue: 200, speedAvg: 5 }));
    expect(far.playNav.mock.calls.length).toBeGreaterThan(0);
    expect(urgentOf(far).every((u) => !u)).toBe(true);
    const near = rig();
    near.d.handle([{ type: "cue", cue: left, phase: "approach" }], nav({ toCue: 40, speedAvg: 5 }));
    expect(urgentOf(near)).toEqual([true, true]); // the distance call and the cue
  });

  it("the distance call and its cue share the urgency; the speed falls back to the fix", () => {
    const r = rig();
    r.d.handle([{ type: "cue", cue: left, phase: "approach" }], nav({ toCue: 50, speedAvg: 5 }));
    expect(urgentOf(r)).toEqual([true, true]);
    const slowFix = rig();
    const fix = { lng: 0, lat: 0, accuracy: 5, heading: null, speed: 2, time: 0 };
    slowFix.d.handle([{ type: "cue", cue: left, phase: "approach" }], nav({ toCue: 120, fix }));
    expect(urgentOf(slowFix).every((u) => !u)).toBe(true); // 120 m at 2 m/s is 60 s
  });

  it("a cue at the turn itself and a detour turn are urgent; depart, arrival and off route are not", () => {
    const r = rig({}, withTurns);
    r.d.handle([{ type: "cue", cue: left, phase: "now" }], nav());
    r.d.handle([{ type: "detour_turn", turn: "left", name: "Mill Lane" }], nav({ offRoute: true }));
    expect(urgentOf(r)).toEqual([true, true]);
    const q = rig();
    q.d.handle([{ type: "cue", cue: depart, phase: "now" }], nav());
    q.d.handle([{ type: "off_route" }, { type: "back_on_route" }], nav());
    q.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    expect(urgentOf(q)).toEqual([false, false, false, false]);
  });
});

describe("effects timed to the text", () => {
  const storyId = "peter-the-great-0";
  const withSfx: Pack = (() => {
    const copy = structuredClone(pack);
    const st = copy.stops[DEPTFORD]!.stories[0]!;
    st.sfx = [{ para: 1, name: "hammer" }, { para: 3, name: "tankards", level: 0.8 }];
    return copy;
  })();
  const marks = withSfx.stops[DEPTFORD]!.stories[0]!.audio!.marks;
  const places = [marks[1]! - 1.2, marks[3]! - 1.2];
  const fx = (r: Rig) => r.mixer.timeline.filter((e) => e.ch === "effect" && e.ev === "on");

  it("each effect fires once, within 0.3 s of its place in the clip", async () => {
    const r = rig({}, withSfx);
    r.d.playStory(DEPTFORD, storyId);
    await ms(100_000);
    const voiceOn = r.mixer.timeline.find((e) => e.ch === "voice" && e.ev === "on")!.at;
    const list = fx(r);
    expect(list.map((e) => e.src)).toEqual(["hammer", "tankards"]);
    list.forEach((e, i) => {
      const clipTime = (e.at - voiceOn) / 1000;
      expect(clipTime).toBeGreaterThanOrEqual(places[i]! - 0.01);
      expect(clipTime).toBeLessThanOrEqual(places[i]! + 0.3);
    });
    expect(r.log.filter((e) => e.what === "effect").map((e) => e.reason)).toEqual(["1:hammer", "3:tankards"]);
  });

  it("not with the Soundscape switch off", async () => {
    const r = rig({ ambience: false }, withSfx);
    r.d.playStory(DEPTFORD, storyId);
    await ms(130_000);
    expect(fx(r)).toEqual([]);
    expect(whats(r).some((w) => w.startsWith("effect"))).toBe(false);
  });

  it("a rewind past an effect arms it again", async () => {
    const r = rig({}, withSfx);
    r.d.playStory(DEPTFORD, storyId);
    await ms(15_000);
    expect(fx(r).map((e) => e.src)).toEqual(["hammer"]);
    r.d.rewind!(1000);
    await ms(15_000);
    expect(fx(r).map((e) => e.src)).toEqual(["hammer", "hammer"]);
  });

  it("a pause holds the effect: it does not fire while the playhead stands still", async () => {
    const r = rig({}, withSfx);
    r.d.playStory(DEPTFORD, storyId);
    await ms(8000);
    r.d.togglePause();
    await ms(60_000);
    expect(fx(r)).toEqual([]);
    r.d.togglePause();
    await ms(6000);
    expect(fx(r).map((e) => e.src)).toEqual(["hammer"]);
  });

  it("read by tapping: an effect fires when its paragraph appears", () => {
    const r = rig({ storyVoice: false }, withSfx);
    r.d.playStory(DEPTFORD, storyId);
    expect(fx(r)).toEqual([]);
    r.d.nextParagraph();
    expect(fx(r).map((e) => e.src)).toEqual(["hammer"]);
    r.d.nextParagraph();
    expect(fx(r).map((e) => e.src)).toEqual(["hammer"]);
    r.d.nextParagraph();
    expect(fx(r).map((e) => e.src)).toEqual(["hammer", "tankards"]);
  });
});

describe("prefetch", () => {
  const cue = pack.cues.find((c) => c.turn === "left" && !c.quiet)!;
  const other = pack.cues.find((c) => c.turn === "right" && !c.quiet && c.id !== cue.id)!;
  const first = pack.stops[DEPTFORD]!.stories[0]!;

  it("the first handle call preloads the system and distance clips, once", () => {
    const r = rig();
    r.d.handle([], nav());
    const sys = pack.system;
    for (const src of [sys.offRoute, sys.backOnRoute, ...Object.values(sys.distances ?? {})]) expect(r.mixer.preloaded).toContain(src);
    const n = r.mixer.preloaded.length;
    r.d.handle([], nav());
    expect(r.mixer.preloaded.length).toBe(n);
  });

  it("within 150 m of a stop: the arrival clip, the first story, its soundscape and theme, once", () => {
    const r = rig();
    r.d.handle([], nav({ seg: DEPTFORD, toStop: 200 }));
    expect(r.mixer.preloaded).not.toContain(first.audio!.src);
    r.d.handle([], nav({ seg: DEPTFORD, toStop: 150 }));
    for (const src of [pack.system.arrive[DEPTFORD]!, first.audio!.src, "ambience:yard", "music:russia"]) {
      expect(r.mixer.preloaded.filter((s) => s === src)).toHaveLength(1);
    }
    const n = r.mixer.preloaded.length;
    r.d.handle([], nav({ seg: DEPTFORD, toStop: 100 }));
    expect(r.mixer.preloaded.length).toBe(n);
  });

  it("the settings leave out the soundscape and theme", () => {
    const r = rig({ ambience: false, music: false });
    r.d.handle([], nav({ seg: DEPTFORD, toStop: 100 }));
    expect(r.mixer.preloaded).toContain(first.audio!.src);
    expect(r.mixer.preloaded.some((s) => s.startsWith("ambience:") || s.startsWith("music:"))).toBe(false);
  });

  it("the next cue's clip is preloaded when it becomes nextCue, not a quiet one", () => {
    const r = rig();
    r.d.handle([], nav({ nextCue: cue, toCue: 300 }));
    expect(r.mixer.preloaded).toContain(cue.audio);
    expect(r.mixer.preloaded).not.toContain(other.audio);
    r.d.handle([], nav({ nextCue: other, toCue: 300 }));
    expect(r.mixer.preloaded).toContain(other.audio);
    const quiet = pack.cues.find((c) => c.quiet)!;
    r.d.handle([], nav({ nextCue: quiet, toCue: 300 }));
    expect(r.mixer.preloaded).not.toContain(quiet.audio);
  });
});
