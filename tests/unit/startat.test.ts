import { describe, expect, it, vi } from "vitest";
import packJson from "../fixtures/pack-v1.json";
import { cumulative, makeProjection, pointAlong, project, unproject, type XY } from "../../src/geo";
import { createNavEngine } from "../../src/nav/engine";
import type { Fix, NavEvent, Pack } from "../../src/types";

const pack = packJson as unknown as Pack;
const proj = makeProjection(pack.stops[0]!.at);
const T0 = 1_700_000_000_000;
const LAST = pack.stops.length - 1;

/** The ridden line from `along` metres into segment `seg` to the end of the route. */
function lineFrom(seg: number, along: number): XY[] {
  const out: XY[] = [];
  for (let i = seg; i < pack.segments.length; i++) {
    let pts = pack.segments[i]!.map((q) => project(proj, q));
    if (i === seg && along > 0) {
      const cum = cumulative(pts);
      const cut = pointAlong(pts, along, cum);
      pts = [cut.point, ...pts.slice(cut.leg + 1)];
    }
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

function fixesAlong(path: XY[], speed = 4): Fix[] {
  const cum = cumulative(path);
  const total = cum[cum.length - 1]!;
  const fixes: Fix[] = [];
  for (let k = 0, d = 0; ; k++, d = Math.min(total, d + speed)) {
    const pa = pointAlong(path, d, cum);
    const ll = unproject(proj, pa.point);
    fixes.push({ lng: ll[0], lat: ll[1], accuracy: 5, heading: pa.bearing, speed, time: T0 + k * 1000 });
    if (d >= total) break;
  }
  const lastFix = fixes[fixes.length - 1]!;
  for (let j = 1; j <= 5; j++) fixes.push({ ...lastFix, time: lastFix.time + j * 1000 });
  return fixes;
}

const segLen = (i: number): number => { const pts = pack.segments[i]!.map((q) => project(proj, q)); const c = cumulative(pts); return c[c.length - 1] ?? 0; };

describe("startAt", () => {
  it("starts at stop 7: arrives there first, skips what is before it, speaks every later turn", () => {
    const engine = createNavEngine(pack);
    engine.startAt!(7);
    expect(engine.state.status).toBe("to_start");
    expect(engine.state.seg).toBe(7);
    // the rider comes up to stop 7 along its own last 150 m, then rides on to the end
    const events: NavEvent[] = [];
    for (const f of fixesAlong(lineFrom(7, segLen(7) - 150))) events.push(...engine.update(f));
    const arrived = events.flatMap((e) => (e.type === "arrive" ? [e.stop] : []));
    expect(arrived).toEqual([7, 8, 9, 10, 11, 12]);
    expect(engine.state.arrived).toEqual([7, 8, 9, 10, 11, 12]);
    expect(engine.state.status).toBe("finished");
    const spoken = events.flatMap((e) => (e.type === "cue" && e.phase === "now" ? [e.cue.id] : []));
    expect(spoken).toEqual(pack.cues.filter((c) => c.seg >= 8).map((c) => c.id));
    const asides = events.flatMap((e) => (e.type === "aside" ? [e.aside] : []));
    expect(asides.length).toBeGreaterThan(0);
    expect(asides.every((a) => a.seg >= 8)).toBe(true);
    expect(engine.state.distanceLeft).toBe(0);
  });

  it("counts distance from the chosen stop", () => {
    const engine = createNavEngine(pack);
    engine.startAt!(7);
    const total = pack.segments.reduce((sum, _, i) => sum + segLen(i), 0);
    const from7 = Array.from({ length: LAST - 7 }, (_, i) => segLen(8 + i)).reduce((a, b) => a + b, 0);
    expect(engine.state.distanceDone).toBe(0);
    expect(engine.state.distanceLeft).toBeCloseTo(from7, 3);
    expect(engine.state.distanceLeft).toBeLessThan(total);
  });

  it("startAt(0) with the rider 30 m off the line far from stop 0: no join, guided to stop 0", () => {
    const engine = createNavEngine(pack);
    engine.startAt!(0);
    const pts = pack.segments[3]!.map((q) => project(proj, q));
    const cum = cumulative(pts);
    const on = pointAlong(pts, cum[cum.length - 1]! / 2, cum);
    const rad = (on.bearing + 90) * (Math.PI / 180);
    const ll = unproject(proj, [on.point[0] + Math.sin(rad) * 30, on.point[1] + Math.cos(rad) * 30]);
    for (let k = 0; k < 6; k++) {
      const ev = engine.update({ lng: ll[0], lat: ll[1], accuracy: 5, heading: null, speed: 0, time: T0 + k * 1000 });
      expect(ev).toEqual([]);
    }
    expect(engine.state.status).toBe("to_start");
    expect(engine.state.seg).toBe(0);
    expect(engine.state.nearest ?? null).toBeNull();
    expect(engine.state.toStop).toBeGreaterThan(150);
    expect(engine.state.arrived).toEqual([]);
  });

  it("without startAt the same rider still joins part way", () => {
    const engine = createNavEngine(pack);
    const pts = pack.segments[3]!.map((q) => project(proj, q));
    const cum = cumulative(pts);
    const on = pointAlong(pts, cum[cum.length - 1]! / 2, cum);
    const ll = unproject(proj, on.point);
    engine.update({ lng: ll[0], lat: ll[1], accuracy: 5, heading: on.bearing, speed: 4, time: T0 });
    expect(engine.state.status).toBe("riding");
  });
});

describe("startOffer", () => {
  it("offers nothing within 300 m of stop 1 and never offers the last stop", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { addEventListener: () => {} });
    vi.stubGlobal("location", { search: "", href: "http://localhost/" });
    vi.stubGlobal("navigator", {});
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    const { startOffer, START_CHOICE_METRES } = await import("../../src/ride");
    const at = (ll: [number, number]): Fix => ({ lng: ll[0], lat: ll[1], accuracy: 5, heading: null, speed: null, time: T0 });
    expect(startOffer(pack, at(pack.stops[0]!.at))).toBeNull();
    expect(startOffer(pack, at(unproject(proj, [200, 0])))).toBeNull();
    expect(START_CHOICE_METRES).toBe(300);
    // standing at a middle stop: offered, with that stop
    const mid = startOffer(pack, at(pack.stops[6]!.at));
    expect(mid?.nearest).toBe(6);
    expect(mid!.toFirst).toBeGreaterThan(START_CHOICE_METRES);
    // standing at the last stop: never the last stop offered
    const end = startOffer(pack, at(pack.stops[LAST]!.at));
    if (end) expect(end.nearest).not.toBe(LAST);
    vi.unstubAllGlobals();
  });
});
