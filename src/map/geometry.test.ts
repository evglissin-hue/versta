import { describe, expect, it } from "vitest";
import { angleDiff, cameraZoom, clampFollowZoom, haversine, lineLength, lookAheadPadding, metresPerPixel, splitAt } from "./geometry";
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
  it("zooms in for a near turn and out when fast", () => {
    expect(cameraZoom(16, { toCue: 100, turnAhead: true, speed: 4 })).toBeCloseTo(16.4, 6);
    expect(cameraZoom(16, { toCue: 200, turnAhead: true, speed: 4 })).toBe(16);
    expect(cameraZoom(16, { toCue: null, turnAhead: false, speed: 8 })).toBeCloseTo(15.6, 6);
    expect(cameraZoom(16, { toCue: 50, turnAhead: false, speed: null })).toBe(16);
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
