import { describe, expect, it } from "vitest";
import { createJitter, type RawFix } from "../../src/nav/jitter";

const T0 = 1_700_000_000_000;

function drive(seed: number, seconds = 3600): { out: RawFix[][]; truth: [number, number][] } {
  const j = createJitter(seed, "urban");
  const out: RawFix[][] = [];
  const truth: [number, number][] = [];
  for (let k = 0; k < seconds; k++) {
    const p: [number, number] = [5 * k, 0];
    truth.push(p);
    out.push(j.next({ p, time: T0 + k * 1000, speed: 5, heading: 90 }));
  }
  return { out, truth };
}

describe("the urban GPS model", () => {
  it("is the same for the same seed and different for another", () => {
    expect(JSON.stringify(drive(7, 300).out)).toBe(JSON.stringify(drive(7, 300).out));
    expect(JSON.stringify(drive(7, 300).out)).not.toBe(JSON.stringify(drive(8, 300).out));
  });

  it("delivers what it promises: multipath spells, accuracy that lies, duplicates, late fixes and gaps", () => {
    const { out, truth } = drive(11);
    const fresh = out.map((fs, k) => fs.find((f) => f.time === T0 + k * 1000) ?? null);
    const offs = fresh.map((f, k) => (f ? Math.hypot(f.p[0] - truth[k]![0], f.p[1] - truth[k]![1]) : null)).filter((d): d is number => d !== null);
    const big = offs.filter((d) => d > 20).length / offs.length;
    expect(big).toBeGreaterThan(0.05);
    expect(big).toBeLessThan(0.4);
    // spells where the figure says under 10 m and the fix is 20 m or more out
    const lies = fresh.filter((f, k) => f && f.accuracy < 10 && Math.hypot(f.p[0] - truth[k]![0], f.p[1] - truth[k]![1]) > 20).length;
    expect(lies).toBeGreaterThan(30);
    expect(out.filter((fs) => fs.length === 0).length).toBeGreaterThan(30);
    expect(out.filter((fs) => fs.length === 2 && fs[0]!.time === fs[1]!.time).length).toBeGreaterThan(20);
    expect(out.filter((fs) => fs.some((f) => f.receivedAt - f.time >= 5000)).length).toBeGreaterThan(5);
    // the bearing is null when standing, as the plugin reports it
    const j = createJitter(1, "urban");
    expect(j.next({ p: [0, 0], time: T0, speed: 0, heading: null })[0]?.heading ?? null).toBeNull();
  });
});
