import { describe, expect, it } from "vitest";
import { haversine, lineLength, metresPerPixel, splitAt } from "./geometry";
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
