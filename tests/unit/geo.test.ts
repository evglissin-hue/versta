import { describe, expect, it } from "vitest";
import { bearing, cumulative, dist, geoDistance, makeProjection, nearestOnPolyline, pointAlong, polylineLength, project, unproject, type XY } from "../../src/geo";

const L: XY[] = [[0, 0], [100, 0], [100, 100]];

describe("geo", () => {
  it("projects to metres and back", () => {
    const proj = makeProjection([-0.0754, 51.5055]);
    const north = project(proj, [-0.0754, 51.5055 + 0.001]);
    expect(north[0]).toBeCloseTo(0, 6);
    expect(north[1]).toBeGreaterThan(111.0);
    expect(north[1]).toBeLessThan(111.4);
    const east = project(proj, [-0.0754 + 0.001, 51.5055]);
    expect(east[0]).toBeGreaterThan(69);
    expect(east[0]).toBeLessThan(70.5);
    const back = unproject(proj, project(proj, [-0.07, 51.51]));
    expect(back[0]).toBeCloseTo(-0.07, 9);
    expect(back[1]).toBeCloseTo(51.51, 9);
  });

  it("measures distance and bearing", () => {
    expect(dist([0, 0], [3, 4])).toBe(5);
    expect(bearing([0, 0], [0, 10])).toBeCloseTo(0, 6);
    expect(bearing([0, 0], [10, 0])).toBeCloseTo(90, 6);
    expect(bearing([0, 0], [0, -10])).toBeCloseTo(180, 6);
    expect(bearing([0, 0], [-10, 0])).toBeCloseTo(270, 6);
    expect(geoDistance([0, 51], [0, 51.01])).toBeGreaterThan(1110);
    expect(geoDistance([0, 51], [0, 51.01])).toBeLessThan(1114);
  });

  it("finds polyline length and cumulative distances", () => {
    expect(polylineLength(L)).toBe(200);
    expect(cumulative(L)).toEqual([0, 100, 200]);
    expect(polylineLength([])).toBe(0);
  });

  it("finds the nearest point on a polyline", () => {
    const n = nearestOnPolyline(L, [50, 20]);
    expect(n.point).toEqual([50, 0]);
    expect(n.along).toBe(50);
    expect(n.dist).toBe(20);
    expect(n.leg).toBe(0);
    const m = nearestOnPolyline(L, [130, 60]);
    expect(m.point).toEqual([100, 60]);
    expect(m.along).toBe(160);
    expect(m.dist).toBe(30);
  });

  it("respects a search window on a line that doubles back", () => {
    const back: XY[] = [[0, 0], [100, 0], [100, 10], [0, 10]];
    const free = nearestOnPolyline(back, [50, 9]);
    expect(free.along).toBeGreaterThan(100);
    const windowed = nearestOnPolyline(back, [50, 9], cumulative(back), 0, 100);
    expect(windowed.along).toBeCloseTo(50, 6);
  });

  it("returns the point and bearing at a distance along a line", () => {
    const a = pointAlong(L, 50);
    expect(a.point).toEqual([50, 0]);
    expect(a.bearing).toBeCloseTo(90, 6);
    const b = pointAlong(L, 150);
    expect(b.point).toEqual([100, 50]);
    expect(b.bearing).toBeCloseTo(0, 6);
    expect(pointAlong(L, 999).point).toEqual([100, 100]);
    expect(pointAlong(L, -5).point).toEqual([0, 0]);
  });
});
