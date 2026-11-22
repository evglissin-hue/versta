import { describe, expect, it } from "vitest";
import type { Place } from "../types";
import { arrivals, createArrivalWatcher, nearbyPlaces, paraAt } from "./nearby";

const mk = (id: string, lng: number, lat: number, radius = 45): Place => ({ id, name: id, at: [lng, lat], radius, pack: "p", kind: "stop", stories: [] });
const A = mk("a", -0.0753, 51.5054);
const B = mk("b", -0.0724, 51.5019);
const C = mk("c", -0.2, 51.6);

describe("nearbyPlaces", () => {
  it("sorts nearest first and drops places out of range", () => {
    const r = nearbyPlaces([C, B, A], [-0.075, 51.5052]);
    expect(r.map((p) => p.place.id)).toEqual(["a", "b"]);
    expect(r[0]!.dist).toBeLessThan(r[1]!.dist);
  });
  it("honours the range", () => {
    expect(nearbyPlaces([A, B], [-0.0753, 51.5054], 100).map((p) => p.place.id)).toEqual(["a"]);
    expect(nearbyPlaces([A, C], [-0.0753, 51.5054], Infinity)).toHaveLength(2);
  });
});

describe("arrivals", () => {
  it("reports a place just entered, not one already inside", () => {
    expect(arrivals([-0.074, 51.5054], [-0.0753, 51.5054], [A]).map((p) => p.id)).toEqual(["a"]);
    expect(arrivals([-0.0753, 51.5054], [-0.0753, 51.50541], [A])).toEqual([]);
    expect(arrivals(null, [-0.0753, 51.5054], [A]).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("arrival watcher", () => {
  it("fires once per place until reset", () => {
    const w = createArrivalWatcher();
    expect(w.check([-0.074, 51.5054], [A])).toEqual([]);
    expect(w.check([-0.0753, 51.5054], [A]).map((p) => p.id)).toEqual(["a"]);
    expect(w.check([-0.074, 51.5054], [A])).toEqual([]);
    expect(w.check([-0.0753, 51.5054], [A])).toEqual([]);
    w.reset();
    expect(w.check([-0.0753, 51.5054], [A]).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("paraAt", () => {
  it("follows the marks", () => {
    expect(paraAt(0, [0, 10, 20], ["a", "b", "c"], 30)).toBe(0);
    expect(paraAt(12, [0, 10, 20], ["a", "b", "c"], 30)).toBe(1);
    expect(paraAt(99, [0, 10, 20], ["a", "b", "c"], 30)).toBe(2);
  });
  it("spreads by length without marks", () => {
    expect(paraAt(1, undefined, ["aaaa", "bbbb"], 10)).toBe(0);
    expect(paraAt(9, undefined, ["aaaa", "bbbb"], 10)).toBe(1);
  });
});
