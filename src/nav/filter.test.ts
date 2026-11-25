import { describe, expect, it } from "vitest";
import type { XY } from "../geo";
import type { Fix } from "../types";
import { createPositionFilter } from "./filter";
import { seeded } from "./jitter";

const T0 = 1_700_000_000_000;
const fixAt = (_p: XY, k: number, o: Partial<Fix> = {}): Fix => ({ lng: 0, lat: 0, accuracy: 5, heading: 90, speed: 5, time: T0 + k * 1000, receivedAt: T0 + k * 1000, ...o });
const err = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("position filter", () => {
  it("rides a straight line with 5 m of noise to within 4 m RMS", () => {
    const f = createPositionFilter();
    const rand = seeded(3);
    const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    let sq = 0, n = 0;
    for (let k = 0; k < 300; k++) {
      const truth: XY = [5 * k, 0];
      const out = f.push([truth[0] + gauss() * 5, truth[1] + gauss() * 5], fixAt(truth, k));
      if (k > 10) { sq += err(out.p, truth) ** 2; n++; }
    }
    expect(Math.sqrt(sq / n)).toBeLessThan(4);
  });

  it("refuses one 60 m jump that claims 5 m accuracy, and barely moves", () => {
    const f = createPositionFilter();
    for (let k = 0; k < 30; k++) f.push([5 * k, 0], fixAt([5 * k, 0], k));
    const before = f.estimate!.p;
    const out = f.push([5 * 30, 60], fixAt([0, 0], 30));
    expect(out.used).toBe(false);
    expect(out.why).toBe("jump");
    // dead reckoning carries it on along the road: 5 m east, nothing north
    expect(Math.abs(out.p[1] - before[1])).toBeLessThan(3);
    expect(err(out.p, [150, 0])).toBeLessThan(3);
  });

  it("drops duplicates, fixes older than the last, and fixes that arrive late", () => {
    const f = createPositionFilter();
    for (let k = 0; k < 10; k++) f.push([5 * k, 0], fixAt([0, 0], k));
    expect(f.push([45, 0], fixAt([0, 0], 9)).why).toBe("stale");
    expect(f.push([30, 0], fixAt([0, 0], 6)).why).toBe("stale");
    expect(f.push([20, 0], fixAt([0, 0], 4, { receivedAt: T0 + 20_000 })).why).toBe("late");
    expect(f.push([50, 0], fixAt([0, 0], 10)).used).toBe(true);
  });

  it("does not take a constant clock difference for lateness", () => {
    const f = createPositionFilter();
    // the phone's clock runs 40 s ahead of GPS time: every fix "arrives" 40 s after it was measured
    for (let k = 0; k < 20; k++) expect(f.push([5 * k, 0], fixAt([0, 0], k, { receivedAt: T0 + k * 1000 + 40_000 })).used).toBe(true);
  });

  it("follows a right angle turn at 6 m/s with good fixes within 6 m", () => {
    const f = createPositionFilter();
    let worst = 0;
    for (let k = 0; k < 60; k++) {
      const truth: XY = k <= 30 ? [6 * k, 0] : [180, -6 * (k - 30)];
      const out = f.push(truth, fixAt(truth, k, { heading: k < 30 ? 90 : 180, speed: 6 }));
      if (k > 5) worst = Math.max(worst, err(out.p, truth));
    }
    expect(worst).toBeLessThan(6);
  });

  it("takes the first fix after a 20 s gap when the rider could have got there", () => {
    const f = createPositionFilter();
    for (let k = 0; k < 20; k++) f.push([5 * k, 0], fixAt([0, 0], k));
    const out = f.push([95 + 100, 30], fixAt([0, 0], 39, { heading: 70 }));
    expect(out.used).toBe(true);
  });

  it("re-acquires when the fixes agree the rider is 300 m away and keep saying so", () => {
    const f = createPositionFilter();
    for (let k = 0; k < 20; k++) f.push([5 * k, 0], fixAt([0, 0], k, { heading: null, speed: null }));
    let taken = -1;
    for (let k = 20; k < 40; k++) {
      const out = f.push([400 + 2 * (k - 20), 200], fixAt([0, 0], k, { heading: null, speed: null }));
      if (out.used && taken < 0) taken = k;
    }
    expect(taken).toBeGreaterThan(20);
    expect(taken).toBeLessThanOrEqual(33);
    expect(err(f.estimate!.p, [438, 200])).toBeLessThan(10);
  });

  it("an accuracy worse than the engine's limit is refused as poor", () => {
    const f = createPositionFilter(80);
    expect(f.push([0, 0], fixAt([0, 0], 0, { accuracy: 200 })).why).toBe("poor");
    expect(f.estimate).toBeNull();
  });
});
