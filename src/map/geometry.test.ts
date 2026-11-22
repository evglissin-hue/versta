import { describe, expect, it } from "vitest";
import { angleDiff, cameraZoom, clampFollowZoom, turnFrame, haversine, lineLength, lookAheadPadding, metresPerPixel, splitAt } from "./geometry";
import type { LngLat } from "../types";

const line: LngLat[] = [[0, 51], [0, 51.001], [0.001, 51.001]];

describe("map geometry", () => {
  it("measures a line", () => {
    expect(lineLength(line)).toBeCloseTo(haversine(line[0]!, line[1]!) + haversine(line[1]!, line[2]!), 6);
  });
  it("splits a line at a distance and keeps both halves joined", () => {
    const total = lineLength(line);
    const [a, b] = splitAt(line, total / 2);
    expect(lineLength(a) + lineLength(b)).toBeCloseTo(total, 3);
    expect(a[a.length - 1]).toEqual(b[0]);
  });
  it("handles the ends", () => {
    expect(splitAt(line, 0)[0]).toEqual([]);
    expect(splitAt(line, 1e9)[1]).toEqual([]);
  });
  it("gives metres per pixel that halve with each zoom", () => {
    expect(metresPerPixel(51.5, 15) / metresPerPixel(51.5, 16)).toBeCloseTo(2, 6);
  });
});

describe("follow camera maths", () => {
  it("turns the short way round", () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(-180);
    expect(angleDiff(90, 90)).toBe(0);
  });
  it("keeps the rider's zoom between 14.5 and 18", () => {
    expect(clampFollowZoom(12)).toBe(14.5);
    expect(clampFollowZoom(17.2)).toBe(17.2);
    expect(clampFollowZoom(21)).toBe(18);
  });
  it("zooms out a little when fast and leaves a near turn to turnFrame", () => {
    expect(cameraZoom(16, { speed: 8 })).toBeCloseTo(15.6, 6);
    expect(cameraZoom(16, { speed: null })).toBe(16);
    expect(cameraZoom(16, { speed: 4 })).toBe(16);
  });
  describe("turnFrame", () => {
    const cue = (turn: string, at: [number, number] = [0, 0.001]) => ({ id: "c1", seg: 0, i: 1, at, turn, name: "", kind: "road", len: 100, say: "", audio: "" }) as never;
    const nav = (o: Record<string, unknown>) => ({ nextCue: null, toCue: null, currentCue: null, snapped: [0, 0] as [number, number], fix: null, speedAvg: null, ...o }) as never;
    it("starts 12 s out, at least 60 m and at most 200 m", () => {
      const at = (speed: number | null, to: number) => turnFrame(nav({ nextCue: cue("left"), toCue: to, speedAvg: speed }), 16);
      expect(at(1, 60)).not.toBeNull();
      expect(at(1, 61)).toBeNull();
      expect(at(4, 60)).not.toBeNull();
      expect(at(5, 60)).not.toBeNull();
      expect(at(5, 61)).toBeNull();
      expect(at(null, 60)).not.toBeNull();
      expect(at(null, 61)).toBeNull();
      expect(at(8, 96)).not.toBeNull();
      expect(at(8, 97)).toBeNull();
      expect(at(30, 200)).not.toBeNull();
      expect(at(30, 201)).toBeNull();
    });
    it("ignores straight and depart", () => {
      expect(turnFrame(nav({ nextCue: cue("straight"), toCue: 20 }), 16)).toBeNull();
      expect(turnFrame(nav({ nextCue: cue("depart"), toCue: 20 }), 16)).toBeNull();
      expect(turnFrame(nav({ nextCue: null, toCue: 20 }), 16)).toBeNull();
    });
    it("zooms to 17.5, never out from a closer base, never past 18", () => {
      const n = nav({ nextCue: cue("right"), toCue: 30 });
      expect(turnFrame(n, 16)?.zoom).toBe(17.5);
      expect(turnFrame(n, 17.8)?.zoom).toBe(17.8);
      expect(turnFrame(n, 19)?.zoom).toBe(18);
    });
    it("focuses on the midpoint of the rider and the turn", () => {
      const f = turnFrame(nav({ nextCue: cue("left", [0, 0.002]), toCue: 30 }), 16);
      expect(f?.focus?.[1]).toBeCloseTo(0.001, 9);
    });
    it("holds until 30 m past the turn, then lets go", () => {
      const passed = cue("right", [0, 0]);
      const past = (m: number) => turnFrame(nav({ currentCue: passed, snapped: [0, m / 111195] }), 16);
      expect(past(10)).not.toBeNull();
      expect(past(29)).not.toBeNull();
      expect(past(32)).toBeNull();
      expect(turnFrame(nav({ currentCue: cue("straight", [0, 0]) }), 16)).toBeNull();
    });
  });
  it("puts the rider two thirds down the visible band", () => {
    // band 100..700 is 600 tall; two thirds down is 500; the padded centre must sit there
    const pad = lookAheadPadding(800, 100, 100, 2 / 3);
    const centre = pad.top + (800 - pad.top - pad.bottom) / 2;
    expect(centre).toBeCloseTo(500, 0);
    expect(lookAheadPadding(800, 100, 100, 0.5).top).toBe(100);
    expect(lookAheadPadding(800, 300, 450, 2 / 3)).toEqual({ top: 300, bottom: 450 });
  });
});
