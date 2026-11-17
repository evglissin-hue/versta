/** The way-back search on the real corridor graph of every pack in the index: it must find a route and be fast. */
import { describe, expect, it } from "vitest";
import { createNavEngine } from "../../src/nav/engine";
import { cumulative, makeProjection, pointAlong, project, unproject } from "../../src/geo";
import type { NavEvent, Pack, RouteGraph } from "../../src/types";
import { PACKS, loaded, segInfo, straySide } from "./packs";

/**
 * Segments a rider can stray from, with the side to stray to: ridden lines (not a fixed walk of two points) at least
 * 700 m long, where 130 m to one side of the point 200 m past a third of the way is at least 100 m from the route.
 */
function strayable(pack: Pack): { seg: number; rad: number }[] {
  const out: { seg: number; rad: number }[] = [];
  for (let i = 1; i < pack.segments.length; i++) {
    const { length, ridden } = segInfo(pack, i);
    if (!ridden || length < 700) continue;
    const rad = straySide(pack, i, length / 3 + 200, 130, 100);
    if (rad !== null) out.push({ seg: i, rad });
  }
  return out;
}

describe.each(PACKS.map((p) => [p.entry.id, p] as const))("rerouting on the real corridor graph of %s", (_id, entry) => {
  const pack = loaded(entry);
  if (!entry.graph) throw new Error(`${entry.entry.id} has no graph.json`);
  const graph: RouteGraph = entry.graph;
  const segs = strayable(pack);
  it("has segments to stray from", () => { expect(segs.length).toBeGreaterThanOrEqual(3); });
  for (const { seg, rad } of segs) {
    it(`a rider who strays 130 m off segment ${seg} gets a way back that ends on the route`, () => {
      const engine = createNavEngine(pack);
      engine.setGraph?.(graph);
      const proj = makeProjection(pack.stops[0]!.at);
      const pts = pack.segments[seg]!.map((p) => project(proj, p));
      const cum = cumulative(pts);
      const total = cum[cum.length - 1]!;
      let clock = 1_700_000_000_000;
      const events: NavEvent[] = [];
      const feed = (x: number, y: number): void => {
        const ll = unproject(proj, [x, y] as never);
        clock += 1000;
        events.push(...engine.update({ lng: ll[0], lat: ll[1], accuracy: 6, heading: null, speed: 4, time: clock }));
      };
      // join the segment a third of the way along and ride 200 m on it
      const startD = total / 3;
      for (let d = startD; d < startD + 200; d += 4) { const a = pointAlong(pts, d, cum); feed(a.point[0], a.point[1]); }
      expect(engine.state.status).toBe("riding");
      expect(engine.state.seg).toBe(seg);
      // then leave it sideways and stay 130 m off for 40 s
      const a = pointAlong(pts, startD + 200, cum);
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) {
        const off = Math.min(130, 10 * (i + 1));
        feed(a.point[0] + Math.sin(rad) * off, a.point[1] - Math.cos(rad) * off);
      }
      const ms = performance.now() - t0;
      expect(events.some((e) => e.type === "off_route")).toBe(true);
      const detours = events.filter((e) => e.type === "detour");
      expect(detours.length).toBeGreaterThanOrEqual(1);
      expect(detours.length).toBeLessThanOrEqual(4);
      if (detours.some((e) => e.type === "detour" && e.found)) {
        const line = engine.state.detour?.line ?? [];
        expect(line.length).toBeGreaterThanOrEqual(2);
        expect(engine.state.detour!.toRejoin).toBeLessThan(1500);
      }
      // forty fixes including the searches stay well inside real time
      expect(ms).toBeLessThan(1500);
    });
  }

  it("finds a way back on most segments", () => {
    let found = 0;
    for (const { seg, rad } of segs) {
      const engine = createNavEngine(pack);
      engine.setGraph?.(graph);
      const proj = makeProjection(pack.stops[0]!.at);
      const pts = pack.segments[seg]!.map((p) => project(proj, p));
      const cum = cumulative(pts);
      const startD = cum[cum.length - 1]! / 3;
      let clock = 1_700_000_000_000;
      const ev: NavEvent[] = [];
      const feed = (x: number, y: number): void => { const ll = unproject(proj, [x, y] as never); clock += 1000; ev.push(...engine.update({ lng: ll[0], lat: ll[1], accuracy: 6, heading: null, speed: 4, time: clock })); };
      for (let d = startD; d < startD + 200; d += 4) { const a = pointAlong(pts, d, cum); feed(a.point[0], a.point[1]); }
      const a = pointAlong(pts, startD + 200, cum);
      for (let i = 0; i < 40; i++) { const off = Math.min(130, 10 * (i + 1)); feed(a.point[0] + Math.sin(rad) * off, a.point[1] - Math.cos(rad) * off); }
      if (ev.some((e) => e.type === "detour" && e.found)) found++;
    }
    expect(found).toBeGreaterThanOrEqual(Math.ceil(segs.length * 0.66));
  });
});
