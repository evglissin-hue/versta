import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixer } from "../../src/audio/mixer";

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
    // 10 s of voice + 3 s of nav + 0.25 s resume delay
    expect(endedAt).toBe(13250);
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
    m.startBed("river", "minor");
    expect(m.bed).toEqual({ ambience: "river", mood: "minor" });
    m.startBed(null, "bright");
    expect(m.bed).toEqual({ ambience: null, mood: "bright" });
    m.stopBed(1);
    expect(m.bed).toBeNull();
  });

  it("the chime takes about 1.2 s, scaled", async () => {
    const m = createMixer({ baseUrl: "", virtual: true, timeScale: 2 });
    let done = false;
    void m.chime().then(() => { done = true; });
    await ms(599);
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
    expect(times.at(-1)!).toBeGreaterThan(0.5);
    expect(times.at(-1)!).toBeLessThan(1.5);
    m.seekVoice!(-15);
    expect(times.at(-1)).toBe(0);
    await ms(1000);
    expect(times.at(-1)!).toBeGreaterThan(0.5);
    expect(times.at(-1)!).toBeLessThan(1.5);
    // the clip still takes its full length from the new playhead
    await ms(8000);
    expect(r.state).toBe("pending");
    await ms(1500);
    expect(r.state).toBe("done");
    // forward past the end finishes the clip
    const h2 = m.playVoice("b.mp3", { estimatedSeconds: 10, onTime: (t) => times.push(t) });
    const r2 = track(h2);
    await ms(1000);
    m.seekVoice!(500);
    expect(times.at(-1)).toBe(10);
    await ms(10);
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
