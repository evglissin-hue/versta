import { describe, expect, it } from "vitest";
import { fmtDist, minutesOf, turnAngle } from "./format";

describe("format", () => {
  it("rounds distances to 10 m and switches to km", () => {
    expect(fmtDist(124)).toBe("120 m");
    expect(fmtDist(1240)).toBe("1.2 km");
  });
  it("says now under the threshold", () => {
    expect(fmtDist(12, 20)).toBe("now");
    expect(fmtDist(25, 20)).toBe("30 m");
  });
  it("points arrows", () => {
    expect(turnAngle("left")).toBe(-90);
    expect(turnAngle("slight_right")).toBe(45);
  });
  it("estimates minutes", () => {
    expect(minutesOf({ paras: ["a"], audio: { dur: 130 } })).toBe(2);
    expect(minutesOf({ paras: ["word ".repeat(280)] })).toBe(2);
  });
});
