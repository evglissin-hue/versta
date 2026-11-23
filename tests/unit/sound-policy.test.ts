/**
 * Task 32: a sound ends when the rider stops or leaves what started it, and a story moves by paragraphs. Everything
 * is checked on the virtual mixer's sound timeline with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packJson from "../../public/packs/thames-loop/pack.json";
import { createMixer, liveMixers, type MixerWithBed } from "../../src/audio/mixer";
import { createDirector } from "../../src/story/director";
import { DEFAULT_SETTINGS, type Director, type DirectorLogEntry, type NavEvent, type NavState, type NowPlaying, type Pack, type Settings } from "../../src/types";
import { intervals } from "./timeline";

const pack = packJson as unknown as Pack;
const DEPTFORD = 4;
const STORY0 = "peter-the-great-0";
const story0 = pack.stops[DEPTFORD]!.stories.find((s) => s.id === STORY0)!;
const marks = story0.audio!.marks;

const NAV: NavState = {
  status: "riding", fix: null, snapped: null, seg: 3, alongSeg: 100, toStop: 1000, distanceDone: 0, distanceLeft: 0,
  routeBearing: null, offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [],
};
const nav = (o: Partial<NavState> = {}): NavState => ({ ...NAV, ...o });
const arrive = (stop: number): NavEvent[] => [{ type: "arrive", stop }];

interface Rig { d: Director; mixer: MixerWithBed; log: DirectorLogEntry[]; now: NowPlaying[]; settings: Settings }

function rig(patch: Partial<Settings> = {}): Rig {
  const settings = { ...DEFAULT_SETTINGS, ...patch };
  const mixer = createMixer({ baseUrl: "", virtual: true });
  const log: DirectorLogEntry[] = [];
  const now: NowPlaying[] = [];
  const d = createDirector({
    pack, mixer, settings: () => settings, clock: () => Date.now(), timeScale: 1,
    onNowPlaying: (n) => now.push(n), onLog: (e) => log.push(e),
  });
  return { d, mixer, log, now, settings };
}

const ms = (n: number) => vi.advanceTimersByTimeAsync(n);
const tl = (r: Rig, ch: string, ev?: "on" | "off") => r.mixer.timeline.filter((e) => e.ch === ch && (ev === undefined || e.ev === ev));
const para = (r: Rig): number => {
  const n = r.now.at(-1);
  return n?.kind === "story" ? n.para : -1;
};
/** Sounds with an `on` and no `off` yet, other than turn speech. */
const stillOn = (r: Rig): string[] => intervals(r.mixer.timeline).open.filter((i) => i.ch !== "nav").map((i) => `${i.ch}:${i.src}`);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("stopAll is silent and complete", () => {
  /** Stop at `at`, run 2 s, and check the timeline: nothing open, no signal after the stop. */
  async function stopAt(r: Rig, run: () => void | Promise<void>): Promise<void> {
    await run();
    const t = Date.now();
    r.d.stopAll();
    // 2 s for the bed, voice and effects; a chime already ringing (3 s) finishes by itself
    await ms(3500);
    expect(stillOn(r)).toEqual([]);
    expect(r.mixer.timeline.filter((e) => e.ch === "signal" && e.ev === "on" && e.at > t)).toEqual([]);
    expect(r.mixer.bed).toBeNull();
    expect(r.mixer.voiceBusy).toBe(false);
    expect(r.now.at(-1)).toBeNull();
    await ms(60_000);
    expect(stillOn(r)).toEqual([]);
  }

  it("in the arrival lead", async () => {
    const r = rig();
    await stopAt(r, async () => { r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" })); await ms(1000); });
    expect(tl(r, "voice", "on")).toEqual([]);
  });

  it("while a story plays, an effect sounding", async () => {
    const r = rig();
    await stopAt(r, async () => {
      r.d.playStory(DEPTFORD, STORY0);
      await ms(50_500);
      expect(tl(r, "effect", "on").map((e) => e.src)).toContain("hammer");
      expect(tl(r, "effect", "off")).toEqual([]);
    });
  });

  it("while a story is paused", async () => {
    const r = rig();
    await stopAt(r, async () => {
      r.d.playStory(DEPTFORD, STORY0);
      await ms(10_000);
      r.d.togglePause();
      await ms(5000);
    });
  });

  it("while the story is held for a turn cue", async () => {
    const r = rig();
    await stopAt(r, async () => {
      r.d.playStory(DEPTFORD, STORY0);
      await ms(10_000);
      void r.mixer.playNav("cue.mp3", { estimatedSeconds: 4, urgent: true }).done.catch(() => {});
      await ms(1000);
    });
  });

  it("while an aside chimes", async () => {
    const r = rig({ autoPlayStories: false });
    r.d.handle([], nav());
    await ms(61_000);
    r.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 2 }));
    await ms(300);
    expect(tl(r, "signal", "on").map((e) => e.src)).toContain("aside");
    await stopAt(r, async () => {});
    expect(tl(r, "voice", "on")).toEqual([]);
  });

  it("while an aside plays", async () => {
    const r = rig({ autoPlayStories: false });
    r.d.handle([], nav());
    await ms(61_000);
    r.d.handle([{ type: "aside", aside: pack.asides[0]! }], nav({ seg: 2 }));
    await ms(6000);
    expect(tl(r, "voice", "on").length).toBe(1);
    await stopAt(r, async () => {});
  });
});

describe("skip", () => {
  it("with nothing queued closes in silence", async () => {
    const r = rig();
    r.d.markHeard?.([STORY0]);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(8000);
    expect(tl(r, "ambience", "on").length).toBe(1);
    const t = Date.now();
    r.d.skip();
    await ms(2000);
    expect(tl(r, "signal", "on").filter((e) => e.at > t)).toEqual([]);
    expect(tl(r, "ambience", "off").length).toBe(1);
    expect(tl(r, "music", "off").length).toBe(1);
    expect(r.log.map((e) => e.what)).not.toContain("story_end");
    await ms(60_000);
    expect(tl(r, "signal", "on").map((e) => e.src)).toEqual(["arrive"]);
    expect(stillOn(r)).toEqual([]);
  });

  it("in the gap after a story ended by itself is silent too", async () => {
    const r = rig();
    r.d.markHeard?.([STORY0]);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    const endsAt = (): boolean => r.log.some((e) => e.what === "story_end");
    for (let i = 0; i < 400 && !endsAt(); i++) await ms(500);
    expect(endsAt()).toBe(true);
    await ms(500);
    const t = Date.now();
    r.d.skip();
    expect(r.now.at(-1)).toBeNull();
    await ms(2000);
    expect(tl(r, "signal", "on").filter((e) => e.at > t)).toEqual([]);
    expect(r.log.filter((e) => e.what === "story_stopped")).toEqual([]);
    expect(tl(r, "ambience", "off").length).toBe(1);
    await ms(30_000);
    expect(tl(r, "signal", "on").map((e) => e.src)).toEqual(["arrive"]);
  });

  it("with a story queued starts it", async () => {
    const r = rig();
    r.d.playStop(DEPTFORD);
    await ms(5000);
    r.d.skip();
    const n = r.now.at(-1);
    expect(n?.kind === "story" && n.story.id).toBe("peter-the-great-1");
    await ms(3000);
    expect(tl(r, "voice", "on").length).toBe(2);
  });
});

describe("what the soundscape does when nobody asks", () => {
  it("a story that ends by itself: the close signal, the bed off within 12.5 s of the end gap", async () => {
    const r = rig();
    r.d.markHeard?.([STORY0]);
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    for (let i = 0; i < 400 && !r.log.some((e) => e.what === "story_end"); i++) await ms(500);
    const end = r.log.find((e) => e.what === "story_end")!.at;
    await ms(2500 + 12_500 + 200);
    expect(tl(r, "signal", "on").map((e) => e.src)).toEqual(["arrive", "close"]);
    for (const ch of ["ambience", "music"]) expect(tl(r, ch, "off")[0]!.at - end).toBeLessThanOrEqual(2500 + 12_500);
  });

  it("an arrival with auto-play off: the bed is off within 20 s", async () => {
    const r = rig({ autoPlayStories: false });
    const t0 = Date.now();
    r.d.handle(arrive(DEPTFORD), nav({ status: "at_stop" }));
    await ms(20_000);
    expect(r.mixer.bed).toBeNull();
    expect(tl(r, "ambience", "off")[0]!.at - t0).toBeLessThanOrEqual(20_000);
  });
});

describe("pause", () => {
  it("silences the bed within 1.2 s and the effects within 0.5 s; resume brings the voice and the bed back", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(50_300);
    expect(stillOn(r)).toContain("effect:hammer");
    const t = Date.now();
    r.d.togglePause();
    await ms(500);
    expect(tl(r, "effect", "off").length).toBe(1);
    expect(tl(r, "effect", "off")[0]!.at - t).toBeLessThanOrEqual(500);
    await ms(700);
    for (const ch of ["ambience", "music"]) expect(tl(r, ch, "off")[0]!.at - t).toBeLessThanOrEqual(1200);
    expect(stillOn(r)).toEqual([]);
    expect(r.mixer.bed).toBeNull();
    await ms(60_000);
    expect(stillOn(r)).toEqual([]);
    const voiceOns = tl(r, "voice", "on").length;
    r.d.togglePause();
    await ms(500);
    expect(tl(r, "voice", "on").length).toBe(voiceOns + 1);
    expect(r.mixer.bed).toEqual({ ambience: "yard", music: "russia" });
    expect(tl(r, "ambience", "on").length).toBe(2);
  });

  it("a rider who has left the stop gets no bed back on resume", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(5000);
    r.d.togglePause();
    await ms(2000);
    r.d.handle([{ type: "leave", stop: DEPTFORD }], nav());
    r.d.togglePause();
    await ms(1000);
    expect(r.mixer.bed).toBeNull();
    expect(tl(r, "voice", "on").length).toBe(2);
  });
});

describe("stepPara", () => {
  const lastPos = (r: Rig): number => tl(r, "voice", "on").at(-1)!.pos!;

  it("+1 and -1 land the voice at the paragraph's mark and set para", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(5000);
    r.d.stepPara?.(1);
    expect(para(r)).toBe(1);
    await ms(500);
    expect(lastPos(r)).toBeCloseTo(marks[1]! - 0.1, 1);
    r.d.stepPara?.(1);
    await ms(500);
    expect(para(r)).toBe(2);
    expect(lastPos(r)).toBeCloseTo(marks[2]! - 0.1, 1);
    r.d.stepPara?.(-1);
    await ms(500);
    expect(para(r)).toBe(1);
    expect(lastPos(r)).toBeCloseTo(marks[1]! - 0.1, 1);
    expect(stillOn(r).filter((s) => s.startsWith("voice"))).toEqual([`voice:${story0.audio!.src}`]);
  });

  it("-1 on the first paragraph restarts it", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(6000);
    r.d.stepPara?.(-1);
    await ms(500);
    expect(para(r)).toBe(0);
    expect(lastPos(r)).toBeCloseTo(Math.max(0, marks[0]! - 0.1), 1);
  });

  it("+1 on the last paragraph does what skip does", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(1000);
    for (let i = 0; i < story0.paras.length - 1; i++) r.d.stepPara?.(1);
    expect(para(r)).toBe(story0.paras.length - 1);
    r.d.stepPara?.(1);
    expect(r.log.map((e) => `${e.what}:${e.reason ?? ""}`)).toContain("story_stopped:skip");
    const n = r.now.at(-1);
    expect(n?.kind === "story" && n.story.id).toBe("peter-the-great-1");
    // and with nothing queued the same step closes in silence
    r.d.stepPara?.(-1);
    r.d.skip();
    expect(r.now.at(-1)).toBeNull();
    await ms(30_000);
    expect(tl(r, "signal", "on").map((e) => e.src)).not.toContain("close");
  });

  it("does nothing with no story on screen", () => {
    const r = rig();
    r.d.stepPara?.(1);
    r.d.stepPara?.(-1);
    expect(r.now).toEqual([]);
  });

  it("read by tapping moves para and fires effects", async () => {
    const r = rig({ storyVoice: false });
    r.d.playStory(DEPTFORD, STORY0);
    expect(para(r)).toBe(0);
    for (let i = 0; i < 3; i++) r.d.stepPara?.(1);
    expect(para(r)).toBe(3);
    expect(tl(r, "effect", "on").map((e) => e.src)).toEqual(["hammer"]);
    r.d.stepPara?.(-1);
    expect(para(r)).toBe(2);
    expect(tl(r, "voice")).toEqual([]);
  });

  it("a paused story stays paused at the new place and resumes from there", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(5000);
    r.d.togglePause();
    await ms(1000);
    const ons = tl(r, "voice", "on").length;
    r.d.stepPara?.(1);
    r.d.stepPara?.(1);
    expect(para(r)).toBe(2);
    await ms(5000);
    expect(tl(r, "voice", "on").length).toBe(ons);
    expect(stillOn(r)).toEqual([]);
    const n = r.now.at(-1);
    expect(n?.kind === "story" && n.paused).toBe(true);
    r.d.togglePause();
    await ms(500);
    expect(tl(r, "voice", "on").length).toBe(ons + 1);
    expect(lastPos(r)).toBeCloseTo(marks[2]! - 0.1, 1);
  });

  it("landing on a paragraph with an effect fires it when playing, not when paused", async () => {
    const play = rig();
    play.d.playStory(DEPTFORD, STORY0);
    await ms(1000);
    play.d.stepPara?.(1);
    play.d.stepPara?.(1);
    expect(tl(play, "effect", "on")).toEqual([]);
    play.d.stepPara?.(1);
    expect(para(play)).toBe(3);
    expect(tl(play, "effect", "on").map((e) => e.src)).toEqual(["hammer"]);
    play.d.stopAll();

    const held = rig();
    held.d.playStory(DEPTFORD, STORY0);
    await ms(1000);
    held.d.togglePause();
    for (let i = 0; i < 3; i++) held.d.stepPara?.(1);
    expect(para(held)).toBe(3);
    expect(tl(held, "effect", "on")).toEqual([]);
    held.d.togglePause();
    await ms(5000);
    expect(tl(held, "effect", "on")).toEqual([]);
  });

  it("an effect jumped over never sounds; going back arms it again", async () => {
    const r = rig();
    r.d.playStory(DEPTFORD, STORY0);
    await ms(1000);
    r.d.togglePause();
    for (let i = 0; i < 4; i++) r.d.stepPara?.(1); // 0 to 4, over the hammer of paragraph 3
    expect(para(r)).toBe(4);
    r.d.togglePause();
    await ms(3000);
    expect(tl(r, "effect", "on")).toEqual([]);
    // back to 2 (paused, so 3 is passed without landing): the hammer is armed again and sounds when the voice gets there
    r.d.togglePause();
    r.d.stepPara?.(-1);
    r.d.stepPara?.(-1);
    r.d.togglePause();
    expect(para(r)).toBe(2);
    expect(tl(r, "effect", "on")).toEqual([]);
    await ms((marks[3]! - 1.2 - (marks[2]! - 0.1)) * 1000 + 1500);
    expect(tl(r, "effect", "on").map((e) => e.src)).toEqual(["hammer"]);
  });
});

describe("seekVoiceTo", () => {
  const on = (m: MixerWithBed) => m.timeline.filter((e) => e.ch === "voice" && e.ev === "on");

  it("while playing: fades out and comes back at the exact target", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const times: number[] = [];
    m.playVoice("a.mp3", { estimatedSeconds: 60, onTime: (t) => times.push(t) });
    await ms(5000);
    m.seekVoiceTo?.(33.3);
    expect(times.at(-1)).toBe(33.3);
    await ms(600);
    expect(on(m).length).toBe(2);
    expect(on(m)[1]!.pos).toBeCloseTo(33.3, 1);
  });

  it("clamps to 0 and to the clip's length", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const times: number[] = [];
    m.playVoice("a.mp3", { estimatedSeconds: 40, onTime: (t) => times.push(t) });
    await ms(5000);
    m.seekVoiceTo?.(-10);
    expect(times.at(-1)).toBe(0);
    await ms(600);
    m.seekVoiceTo?.(500);
    expect(times.at(-1)).toBe(40);
  });

  it("while held for a turn cue: resumes at the target after the cue", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    m.playVoice("a.mp3", { estimatedSeconds: 60 });
    await ms(5000);
    void m.playNav("cue.mp3", { estimatedSeconds: 4, urgent: true }).done.catch(() => {});
    await ms(1000);
    m.seekVoiceTo?.(41);
    await ms(500);
    expect(on(m).length).toBe(1);
    await ms(4000);
    expect(on(m).length).toBe(2);
    expect(on(m)[1]!.pos).toBeCloseTo(41, 1);
  });

  it("while the rider has paused: it stays paused and resumes at the target", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    m.playVoice("a.mp3", { estimatedSeconds: 60 });
    await ms(5000);
    m.pauseVoice();
    await ms(1000);
    m.seekVoiceTo?.(25);
    await ms(3000);
    expect(on(m).length).toBe(1);
    m.resumeVoice();
    await ms(600);
    expect(on(m).length).toBe(2);
    expect(on(m)[1]!.pos).toBeCloseTo(25, 1);
  });

  it("before the clip has started: it starts at the target", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    void m.playNav("cue.mp3", { estimatedSeconds: 3 }).done.catch(() => {});
    const times: number[] = [];
    m.playVoice("a.mp3", { estimatedSeconds: 60, onTime: (t) => times.push(t) });
    expect(on(m)).toEqual([]);
    m.seekVoiceTo?.(12);
    expect(times.at(-1)).toBe(12);
    await ms(4000);
    expect(on(m).length).toBe(1);
    expect(on(m)[0]!.pos).toBeCloseTo(12, 1);
  });
});

describe("stopEffects", () => {
  it("fades every effect out and logs it off at the end of the fade; later effects play", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    m.playEffect("hammer");
    m.playEffect("adze");
    await ms(500);
    m.stopEffects?.(0.3);
    await ms(250);
    expect(m.timeline.filter((e) => e.ch === "effect" && e.ev === "off")).toEqual([]);
    await ms(100);
    expect(m.timeline.filter((e) => e.ch === "effect" && e.ev === "off").length).toBe(2);
    await ms(10_000);
    expect(m.timeline.filter((e) => e.ch === "effect" && e.ev === "off").length).toBe(2);
    m.playEffect("hammer");
    await ms(5000);
    expect(m.timeline.filter((e) => e.ch === "effect" && e.ev === "off").length).toBe(3);
  });
});

describe("dispose and the live list", () => {
  it("lists a mixer with its owner and what it sounds, and drops it on dispose", async () => {
    const before = liveMixers().length;
    const m = createMixer({ baseUrl: "", virtual: true, owner: "ride" });
    const other = createMixer({ baseUrl: "", virtual: true });
    expect(liveMixers().length).toBe(before + 2);
    expect(liveMixers().at(-1)!.owner).toBe("unknown");
    m.startBed("yard", "russia");
    m.playVoice("a.mp3", { estimatedSeconds: 30 });
    m.playEffect("hammer");
    await ms(1000);
    const mine = liveMixers().find((x) => x.owner === "ride")!;
    expect(mine.sounding.sort()).toEqual(["ambience:yard", "effect:hammer", "music:russia", "voice:a.mp3"]);
    m.dispose?.();
    expect(liveMixers().length).toBe(before + 1);
    other.dispose?.();
    expect(liveMixers().length).toBe(before);
  });

  it("closes every open sound on the timeline", async () => {
    const m = createMixer({ baseUrl: "", virtual: true, owner: "practice" });
    m.startBed("yard", "russia");
    m.playVoice("a.mp3", { estimatedSeconds: 30 });
    void m.signal("arrive");
    m.playEffect("hammer");
    m.playNav("cue.mp3", { estimatedSeconds: 3 });
    await ms(500);
    expect(intervals(m.timeline).open.length).toBeGreaterThan(0);
    m.dispose?.();
    expect(intervals(m.timeline).open).toEqual([]);
    await ms(60_000);
    expect(intervals(m.timeline).open).toEqual([]);
  });
});
