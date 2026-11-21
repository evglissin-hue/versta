import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixer } from "../../src/audio/mixer";
import { joinMusicLoop } from "../../src/audio/loops";
import type { SoundEvent } from "../../src/types";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const ms = (n: number) => vi.advanceTimersByTimeAsync(n);

function track(h: { done: Promise<void> }) {
  const r = { state: "pending" as "pending" | "done" | string };
  h.done.then(() => { r.state = "done"; }, (e: unknown) => { r.state = String(e); });
  return r;
}

describe("mixer (virtual)", () => {
  it("plays nav clips in order and keeps at most three waiting", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const order: number[] = [];
    const hs = [1, 2, 3, 4, 5].map((n) => {
      const h = m.playNav(`c${n}.mp3`, { estimatedSeconds: 1 });
      h.done.then(() => order.push(n), () => {});
      return track(h);
    });
    // clip 1 is speaking, 2..4 are waiting; the fifth pushes the oldest waiting one (2) out
    await ms(0);
    expect(hs[1]!.state).toBe("stopped");
    expect(m.navBusy).toBe(true);
    await ms(5000);
    expect(order).toEqual([1, 3, 4, 5]);
    expect(m.navBusy).toBe(false);
  });

  it("a replaced voice clip rejects with stopped", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const a = m.playVoice("a.mp3", { estimatedSeconds: 10 });
    const ra = track(a);
    const b = m.playVoice("b.mp3", { estimatedSeconds: 10 });
    const rb = track(b);
    await ms(0);
    expect(ra.state).toBe("stopped");
    expect(rb.state).toBe("pending");
    b.stop();
    await ms(0);
    expect(rb.state).toBe("stopped");
    expect(m.voiceBusy).toBe(false);
  });

  it("stopVoice rejects the current clip with stopped", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const r = track(m.playVoice("a.mp3", { estimatedSeconds: 10 }));
    m.stopVoice();
    await ms(0);
    expect(r.state).toBe("stopped");
  });

  it("clips last estimatedSeconds / timeScale of real time and report a scaled playhead", async () => {
    const m = createMixer({ baseUrl: "", virtual: true, timeScale: 10 });
    const times: number[] = [];
    const r = track(m.playVoice("a.mp3", { estimatedSeconds: 20, onTime: (t) => times.push(t) }));
    await ms(1999);
    expect(r.state).toBe("pending");
    await ms(1);
    expect(r.state).toBe("done");
    // 250 ms of real time is 2.5 s of clip time
    expect(times[0]).toBeCloseTo(2.5, 1);
    expect(times.at(-1)).toBe(20);
  });

  it("defaults a clip to three seconds", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const r = track(m.playNav("a.mp3"));
    await ms(2999);
    expect(r.state).toBe("pending");
    await ms(1);
    expect(r.state).toBe("done");
  });

  it("pauses the voice while nav speaks and resumes it 250 ms after the queue empties", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const t0 = Date.now();
    let endedAt = 0;
    m.playVoice("v.mp3", { estimatedSeconds: 10 }).done.then(() => { endedAt = Date.now() - t0; });
    await ms(4000);
    m.playNav("n1.mp3", { estimatedSeconds: 2 });
    m.playNav("n2.mp3", { estimatedSeconds: 1 });
    expect(m.navBusy).toBe(true);
    expect(m.voiceBusy).toBe(true);
    await ms(20000);
    // the cue cuts at 4 s with a 0.15 s fade; nav speaks 3 s; 0.25 s later the voice comes back 1.5 s before the cut
    // (the clip has no phrase marks) and plays the remaining 7.5 s
    expect(endedAt).toBe(4000 + 150 + 3000 + 250 + 7500);
  });

  it("a voice clip started while nav is speaking waits until nav has finished", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const t0 = Date.now();
    m.playNav("n.mp3", { estimatedSeconds: 2 });
    let endedAt = 0;
    m.playVoice("v.mp3", { estimatedSeconds: 5 }).done.then(() => { endedAt = Date.now() - t0; });
    await ms(20000);
    expect(endedAt).toBe(2000 + 250 + 5000);
  });

  it("a rider pause survives a nav cue", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const r = track(m.playVoice("v.mp3", { estimatedSeconds: 5 }));
    await ms(1000);
    m.pauseVoice();
    m.playNav("n.mp3", { estimatedSeconds: 1 });
    await ms(10000);
    expect(r.state).toBe("pending");
    expect(m.voiceBusy).toBe(true);
    m.resumeVoice();
    await ms(4000);
    expect(r.state).toBe("done");
  });

  it("a nav handle can be stopped while waiting or speaking", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const a = m.playNav("a.mp3", { estimatedSeconds: 5 });
    const b = m.playNav("b.mp3", { estimatedSeconds: 5 });
    const ra = track(a), rb = track(b);
    b.stop();
    a.stop();
    await ms(0);
    expect(ra.state).toBe("stopped");
    expect(rb.state).toBe("stopped");
    expect(m.navBusy).toBe(false);
  });

  it("records the bed for the director and treats null as off", () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    m.startBed("river", "solemn");
    expect(m.bed).toEqual({ ambience: "river", music: "solemn" });
    m.startBed(null, "bright");
    expect(m.bed).toEqual({ ambience: null, music: "bright" });
    m.stopBed(1);
    expect(m.bed).toBeNull();
  });

  it("a signal lasts its catalogue length, scaled", async () => {
    const m = createMixer({ baseUrl: "", virtual: true, timeScale: 2 });
    let done = false;
    void m.signal("aside").then(() => { done = true; });
    await ms(1499);
    expect(done).toBe(false);
    await ms(1);
    expect(done).toBe(true);
  });

  it("unlock resolves without audio hardware", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    await expect(m.unlock()).resolves.toBeUndefined();
  });
});

describe("recorded loops", () => {
  it("crossfadeLoop shortens by the fade and joins the end into the start without a jump", async () => {
    const { crossfadeLoop } = await import("../../src/audio/loops");
    const sr = 1000, n = 10 * sr;
    // a steady tone whose period does not divide the length: a plain loop would click
    const tone = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 7.3 * i) / sr));
    const [out] = crossfadeLoop([tone], sr, 1);
    expect(out!.length).toBe(n - sr);
    // the step from the last sample to the first is no bigger than the step between neighbours elsewhere
    const jump = Math.abs(out![0]! - out![out!.length - 1]!);
    const typical = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(out![3000 + i + 1]! - out![3000 + i]!)));
    expect(jump).toBeLessThan(typical * 2);
    // outside the faded part it is the original
    expect(out![5000]).toBe(tone[5000]);
    // equal power: a constant signal stays constant across the fade
    const [flat] = crossfadeLoop([new Float32Array(n).fill(0.5)], sr, 1);
    expect(Math.max(...flat!.subarray(0, sr))).toBeLessThan(0.5 * Math.SQRT2 + 1e-6);
  });

  it("every soundscape recipe names loops that are in the loop list", async () => {
    const { RECIPES, allLoops, loopsFor } = await import("../../src/audio/soundscapes");
    const all = new Set(allLoops());
    for (const name of Object.keys(RECIPES)) for (const l of loopsFor(name)) expect(all.has(l)).toBe(true);
    expect(loopsFor("no-such-soundscape")).toEqual(loopsFor("river"));
  });
});

describe("mixer guidance additions (virtual)", () => {
  it("seekVoice moves the playhead and clamps at both ends", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const times: number[] = [];
    const h = m.playVoice("a.mp3", { estimatedSeconds: 10, onTime: (t) => times.push(t) });
    const r = track(h);
    await ms(3000);
    expect(times.at(-1)!).toBeGreaterThan(2.5);
    expect(times.at(-1)!).toBeLessThan(3.5);
    m.seekVoice!(-2);
    // the new playhead is reported at once
    expect(times.at(-1)!).toBeGreaterThan(0.5);
    expect(times.at(-1)!).toBeLessThan(1.5);
    m.seekVoice!(-15);
    expect(times.at(-1)).toBe(0);
    await ms(1150);
    expect(times.at(-1)!).toBeGreaterThan(0.5);
    expect(times.at(-1)!).toBeLessThan(1.5);
    // the clip still takes its full length from the new playhead
    await ms(8000);
    expect(r.state).toBe("pending");
    await ms(1100);
    expect(r.state).toBe("done");
    // forward past the end finishes the clip
    const h2 = m.playVoice("b.mp3", { estimatedSeconds: 10, onTime: (t) => times.push(t) });
    const r2 = track(h2);
    await ms(1000);
    m.seekVoice!(500);
    expect(times.at(-1)).toBe(10);
    await ms(200);
    expect(r2.state).toBe("done");
  });

  it("seekVoice works on a paused clip and does nothing with no voice", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    m.seekVoice!(-5);
    const times: number[] = [];
    m.playVoice("a.mp3", { estimatedSeconds: 10, onTime: (t) => times.push(t) });
    await ms(4000);
    m.pauseVoice();
    m.seekVoice!(-2);
    const at = times.at(-1)!;
    expect(at).toBeGreaterThan(1.5);
    expect(at).toBeLessThan(2.5);
    await ms(3000);
    expect(times.at(-1)).toBe(at); // still paused
    m.resumeVoice();
    await ms(1000);
    expect(times.at(-1)!).toBeGreaterThan(at + 0.5);
  });

  it("tick counts calls and does not pause or disturb the voice channel", async () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    const r = track(m.playVoice("a.mp3", { estimatedSeconds: 5 }));
    await ms(1000);
    m.tick!();
    m.tick!();
    expect(m.ticks).toBe(2);
    expect(m.navBusy).toBe(false);
    expect(m.voiceBusy).toBe(true);
    await ms(3900);
    expect(r.state).toBe("pending");
    await ms(300);
    expect(r.state).toBe("done");
  });

  it("setBedLevel is remembered and survives new beds", () => {
    const m = createMixer({ baseUrl: "", virtual: true });
    expect(m.bedLevel).toBe(1);
    m.setBedLevel!(0.5);
    m.startBed("river", "bright");
    m.stopBed();
    m.startBed("yard", null);
    expect(m.bedLevel).toBe(0.5);
    m.setBedLevel!(-3);
    expect(m.bedLevel).toBe(0);
  });
});

/* ------------------------------------------------------------------ iteration 5: fades, yielding, timeline */

const BREAKS = [3, 10, 20, 30, 40, 50];

function rig(timeScale = 1) {
  const t0 = Date.now();
  const m = createMixer({ baseUrl: "", virtual: true, timeScale });
  const evs = (ch: SoundEvent["ch"], ev?: "on" | "off") => m.timeline.filter((e) => e.ch === ch && (!ev || e.ev === ev));
  const sec = (e: SoundEvent | undefined) => (e ? (e.at - t0) / 1000 : NaN);
  return { m, evs, sec, t0 };
}

describe("yielding to the nav channel", () => {
  it("1. a cue 2 s before a break waits for it: voice off at b - 0.05, cue after, voice back at b - 0.25", async () => {
    const { m, evs, sec } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: BREAKS });
    await ms(8000); // clip time 8, next break 10
    m.playNav("cue.mp3", { estimatedSeconds: 2 });
    await ms(10_000);
    const off = evs("voice", "off")[0]!;
    expect(Math.abs(off.pos! - 9.95)).toBeLessThanOrEqual(0.05);
    expect(sec(off)).toBeCloseTo(9.95, 1);
    const navOn = evs("nav", "on")[0]!, navOff = evs("nav", "off")[0]!;
    expect(navOn.at).toBeGreaterThanOrEqual(off.at);
    const back = evs("voice", "on")[1]!;
    expect(back.at - navOff.at).toBeLessThanOrEqual(500);
    expect(Math.abs(back.pos! - 9.75)).toBeLessThanOrEqual(0.05);
  });

  it("2. a cue with the next break 5 s ahead fades at once and replays from the last break within 6 s", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: BREAKS });
    await ms(12_000); // clip time 12, last break 10, next 20
    const call = Date.now();
    m.playNav("cue.mp3", { estimatedSeconds: 2 });
    await ms(8000);
    expect(evs("voice", "off")[0]!.at - call).toBeLessThanOrEqual(200);
    expect(Math.abs(evs("voice", "on")[1]!.pos! - 9.75)).toBeLessThanOrEqual(0.05);
  });

  it("2b. with no break within 6 s back, it resumes 1.5 s before the cut", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: [3, 30] });
    await ms(15_000);
    m.playNav("cue.mp3", { estimatedSeconds: 2 });
    await ms(8000);
    expect(Math.abs(evs("voice", "on")[1]!.pos! - 13.5)).toBeLessThanOrEqual(0.05);
  });

  it("3. an urgent cue never waits, even with a break 1 s ahead; with no breaks it resumes 1.5 s back", async () => {
    const a = rig();
    a.m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: [4, 10, 20] });
    await ms(9000); // next break 10 is 1 s ahead, last break 4 is 5 s back
    const call = Date.now();
    a.m.playNav("cue.mp3", { estimatedSeconds: 2, urgent: true });
    await ms(6000);
    expect(a.evs("voice", "off")[0]!.at - call).toBeLessThanOrEqual(200);
    expect(Math.abs(a.evs("voice", "on")[1]!.pos! - 3.75)).toBeLessThanOrEqual(0.05);

    const b = rig();
    b.m.playVoice("v.mp3", { estimatedSeconds: 60 });
    await ms(20_000);
    b.m.playNav("cue.mp3", { estimatedSeconds: 2, urgent: true });
    await ms(6000);
    expect(Math.abs(b.evs("voice", "on")[1]!.pos! - 18.5)).toBeLessThanOrEqual(0.05);
  });

  it("4. an urgent cue arriving during a wait cuts the wait short", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: BREAKS });
    await ms(7500); // next break 10, 2.5 s away
    m.playNav("late.mp3", { estimatedSeconds: 1 });
    await ms(500);
    expect(evs("voice", "off")).toHaveLength(0); // still waiting
    const call = Date.now();
    m.playNav("now.mp3", { estimatedSeconds: 1, urgent: true });
    await ms(300);
    const off = evs("voice", "off")[0]!;
    expect(off.at - call).toBeLessThanOrEqual(200);
    expect(off.pos!).toBeLessThan(9);
  });

  it("5. a distance call and its cue sound as one utterance", async () => {
    const { m, evs } = rig();
    m.playNav("in-100.mp3", { estimatedSeconds: 1.5 });
    m.playNav("left.mp3", { estimatedSeconds: 1 });
    await ms(5000);
    const on = evs("nav", "on"), off = evs("nav", "off");
    expect(on[1]!.at - off[0]!.at).toBeLessThanOrEqual(150);
  });

  it("6. a signal sounds before the clip queued after it, holds the voice, and resolves at its end", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60 });
    await ms(2000);
    let resolvedAt = 0;
    const t0 = Date.now();
    void m.signal("arrive").then(() => { resolvedAt = Date.now() - t0; });
    m.playNav("arrive.mp3", { estimatedSeconds: 2 });
    await ms(10_000);
    const sigOn = evs("signal", "on")[0]!, sigOff = evs("signal", "off")[0]!, navOn = evs("nav", "on")[0]!;
    expect(sigOn.src).toBe("arrive");
    expect(navOn.at).toBeGreaterThanOrEqual(sigOff.at);
    expect(sigOn.at).toBeGreaterThanOrEqual(evs("voice", "off")[0]!.at);
    expect(resolvedAt).toBe(sigOff.at - t0);
    expect(sigOff.at - sigOn.at).toBe(2000);
    expect(evs("voice", "on")[1]!.at).toBeGreaterThanOrEqual(evs("nav", "off")[0]!.at);
  });
});

describe("the rider's pause, seek and stop", () => {
  it("7. a pause over 20 s resumes from the phrase start, a short one where it paused", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: BREAKS });
    await ms(14_000);
    m.pauseVoice();
    await ms(30_000);
    m.resumeVoice();
    await ms(300);
    expect(Math.abs(evs("voice", "on")[1]!.pos! - 9.75)).toBeLessThanOrEqual(0.05); // last break at or before 14 is 10
    m.pauseVoice(); // at about 10.05
    await ms(5000);
    m.resumeVoice();
    await ms(300);
    expect(Math.abs(evs("voice", "on")[2]!.pos! - 10.05)).toBeLessThanOrEqual(0.05);
  });

  it("8. seekVoice(-15) lands on a break minus 0.25 with breaks, on position - 15 without", async () => {
    const a = rig();
    a.m.playVoice("v.mp3", { estimatedSeconds: 60, breaks: BREAKS });
    await ms(34_000);
    a.m.seekVoice!(-15); // 19: the last break at or before it is 10
    await ms(400);
    expect(Math.abs(a.evs("voice", "on")[1]!.pos! - 9.75)).toBeLessThanOrEqual(0.05);

    const b = rig();
    const times: number[] = [];
    b.m.playVoice("v.mp3", { estimatedSeconds: 60, onTime: (t) => times.push(t) });
    await ms(34_000);
    b.m.seekVoice!(-15);
    expect(times.at(-1)!).toBeCloseTo(19, 0);
    await ms(400);
    expect(Math.abs(b.evs("voice", "on")[1]!.pos! - 19)).toBeLessThanOrEqual(0.05);
  });

  it("9. stopVoice then playVoice: the old done rejects at once, the new voice is not heard before the old is silent", async () => {
    const { m, evs } = rig();
    const r = track(m.playVoice("a.mp3", { estimatedSeconds: 30 }));
    await ms(2000);
    m.stopVoice();
    m.playVoice("b.mp3", { estimatedSeconds: 30 });
    await ms(0);
    expect(r.state).toBe("stopped");
    await ms(1000);
    const onA = evs("voice", "on").find((e) => e.src === "a.mp3")!;
    const offA = evs("voice", "off").find((e) => e.src === "a.mp3")!;
    const onB = evs("voice", "on").find((e) => e.src === "b.mp3")!;
    expect(onB.at).toBeGreaterThanOrEqual(offA.at);
    expect(offA.at - onA.at).toBe(2150);
  });
});

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("10. fuzz: speech never overlaps", () => {
  it("200 seeds of random voice, cue, signal, pause, resume, seek and stop over three minutes", async () => {
    const SPEECH = new Set(["voice", "nav", "signal"]);
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      const m = createMixer({ baseUrl: "", virtual: true });
      const navHandles: { stop(): void }[] = [];
      const start = Date.now();
      while (Date.now() - start < 180_000) {
        const x = rand();
        if (x < 0.22) {
          const est = 4 + rand() * 50;
          const breaks = rand() < 0.6 ? Array.from({ length: 1 + Math.floor(rand() * 12) }, () => rand() * est).sort((p, q) => p - q) : undefined;
          m.playVoice(`v${seed}.mp3`, { estimatedSeconds: est, breaks, onTime: rand() < 0.5 ? () => {} : undefined });
        } else if (x < 0.5) {
          navHandles.push(m.playNav(`n.mp3`, { estimatedSeconds: 0.5 + rand() * 3, urgent: rand() < 0.4 }));
        } else if (x < 0.58) {
          void m.signal((["aside", "arrive", "close", "finish"] as const)[Math.floor(rand() * 4)]!);
        } else if (x < 0.7) m.pauseVoice();
        else if (x < 0.82) m.resumeVoice();
        else if (x < 0.9) m.seekVoice!((rand() < 0.7 ? -1 : 1) * (1 + rand() * 20));
        else if (x < 0.95) m.stopVoice(rand() < 0.5 ? 0.4 : undefined);
        else navHandles[Math.floor(rand() * navHandles.length)]?.stop();
        await ms(50 + rand() * 2500);
      }
      // let everything settle: the rider resumes, the queue drains, the voice carries on
      m.resumeVoice();
      await ms(20_000);
      expect(m.navBusy, `seed ${seed}`).toBe(false);
      if (m.voiceBusy) {
        const last = m.timeline.filter((e) => e.ch === "voice").at(-1);
        expect(last?.ev, `seed ${seed}: voice left held`).toBe("on");
      }
      m.stopVoice();
      await ms(2000);
      const on = new Set<string>();
      for (const e of m.timeline) {
        if (!SPEECH.has(e.ch)) continue;
        if (e.ev === "on") {
          expect([...on], `seed ${seed}: ${e.ch} on at ${e.at - start} while ${[...on].join(",")}`).toEqual([]);
          on.add(e.ch);
        } else {
          expect(on.has(e.ch), `seed ${seed}: ${e.ch} off without on`).toBe(true);
          on.delete(e.ch);
        }
      }
      expect([...on], `seed ${seed}: an on without its off`).toEqual([]);
    }
  });
});

describe("11. the bed", () => {
  it("a new theme leaves the soundscape alone and crossfades the music; stopBed ends every layer on time", async () => {
    const { m, evs, sec } = rig();
    m.startBed("river", "solemn");
    await ms(5000);
    m.startBed("river", "noir");
    await ms(5000);
    expect(evs("ambience").map((e) => `${e.ev}:${e.src}`)).toEqual(["on:river"]);
    expect(evs("music").map((e) => `${e.ev}:${e.src}`)).toEqual(["on:solemn", "on:noir", "off:solemn"]);
    expect(sec(evs("music", "off")[0])).toBeCloseTo(7.5, 1);
    const call = Date.now();
    m.stopBed(6);
    await ms(7000);
    for (const e of [...evs("ambience", "off"), ...evs("music", "off").filter((x) => x.src === "noir")]) expect(e.at - call).toBe(6000);
    expect(evs("ambience", "off")).toHaveLength(1);
  });

  it("startBed(null, null) fades everything out over 2.5 s", async () => {
    const { m, evs } = rig();
    m.startBed("yard", "bright");
    await ms(4000);
    const call = Date.now();
    m.startBed(null, null);
    await ms(3000);
    const offs = [...evs("ambience", "off"), ...evs("music", "off")];
    expect(offs).toHaveLength(2);
    for (const e of offs) expect(e.at - call).toBe(2500);
    expect(m.bed).toBeNull();
  });
});

describe("12. preload, effects and dispose", () => {
  it("preload dedupes and records", () => {
    const { m } = rig();
    m.preload(["a.mp3", "ambience:river"]);
    m.preload(["a.mp3", "music:noir", "ambience:river"]);
    expect(m.preloaded).toEqual(["a.mp3", "ambience:river", "music:noir"]);
  });

  it("playEffect writes effect on and off with the catalogue length", async () => {
    const { m, evs } = rig();
    m.playEffect("ship-horn", { level: 0.5 });
    await ms(4900);
    expect(evs("effect").map((e) => e.ev)).toEqual(["on"]);
    await ms(200);
    expect(evs("effect").map((e) => `${e.ev}:${e.src}`)).toEqual(["on:ship-horn", "off:ship-horn"]);
    expect(evs("effect", "off")[0]!.at - evs("effect", "on")[0]!.at).toBe(5000);
  });

  it("an effect does not hold the voice", async () => {
    const { m, evs } = rig();
    m.playVoice("v.mp3", { estimatedSeconds: 10 });
    await ms(1000);
    m.playEffect("hammer");
    expect(m.navBusy).toBe(false);
    expect(evs("voice", "off")).toHaveLength(0);
  });

  it("dispose stops everything at once and is safe twice", async () => {
    const { m } = rig();
    const v = track(m.playVoice("v.mp3", { estimatedSeconds: 10 }));
    const n = track(m.playNav("n.mp3", { estimatedSeconds: 10 }));
    m.startBed("river", "noir");
    m.dispose!();
    m.dispose!();
    await ms(0);
    expect(v.state).toBe("stopped");
    expect(n.state).toBe("stopped");
    expect(m.voiceBusy).toBe(false);
    expect(m.navBusy).toBe(false);
    const before = m.timeline.length;
    await ms(30_000);
    expect(m.timeline.length).toBe(before);
    const late = track(m.playVoice("x.mp3"));
    await ms(0);
    expect(late.state).toBe("stopped");
  });

  it("the timeline keeps at most 5000 entries", async () => {
    const { m } = rig();
    for (let i = 0; i < 3000; i++) m.playEffect("hammer");
    expect(m.timeline.length).toBe(3000);
    await ms(10_000);
    expect(m.timeline.length).toBe(5000);
  });
});

describe("joinMusicLoop", () => {
  it("joins a repeated pattern plus its tail without a jump, and drops the tail", () => {
    const sr = 1000, loop = 8 * sr, tail = 1.5 * sr;
    // a pattern with a period that does not divide the loop would click: this one repeats exactly
    const pattern = (i: number): number => Math.sin((2 * Math.PI * 5 * i) / loop) + 0.5 * Math.sin((2 * Math.PI * 13 * i) / loop);
    const file = new Float32Array(loop + tail).map((_, i) => pattern(i));
    const [out] = joinMusicLoop([file], sr, 1.5);
    expect(out!.length).toBe(loop);
    const jump = Math.abs(out![0]! - out![loop - 1]!);
    const typical = Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(out![3000 + i + 1]! - out![3000 + i]!)));
    expect(jump).toBeLessThanOrEqual(typical * 1.5);
    // a pattern plus its tail is returned unchanged
    for (const i of [0, 700, 1499, 1500, 4000, loop - 1]) expect(out![i]).toBeCloseTo(pattern(i), 3);
  });

  it("is an equal gain crossfade: a constant file stays constant", () => {
    const [out] = joinMusicLoop([new Float32Array(10_000).fill(0.5)], 1000, 1.5);
    for (const v of out!) expect(v).toBeCloseTo(0.5, 5);
  });
});
