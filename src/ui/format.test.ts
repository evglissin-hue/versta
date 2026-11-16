import { describe, expect, it } from "vitest";
import { avgKmh, fmtDist, fmtLeft, fmtListening, minutesOf, storyLeft, turnAngle } from "./format";

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

import { fmtDistTime, fmtDuration, fmtEta, thenText, turnLabel } from "./format";

describe("format, round two", () => {
  it("reads durations", () => {
    expect(fmtDuration(48 * 60000)).toBe("48 min");
    expect(fmtDuration((2 * 60 + 14) * 60000)).toBe("2 h 14 min");
    expect(fmtDuration(3 * 3600000)).toBe("3 h");
  });
  it("labels turns", () => {
    expect(turnLabel("left", 120)).toBe("Turn left in");
    expect(turnLabel("left", 12)).toBe("Turn left");
    expect(turnLabel("straight", 120)).toBe("Continue onto");
  });
});

describe("format, iteration 3", () => {
  it("gives the time to a stop from the smoothed speed", () => {
    expect(fmtEta(1240, 4.1)).toBe("about 5 min");
    expect(fmtEta(300, 5)).toBe("about 1 min");
    expect(fmtEta(18000, 5)).toBe("about 1 h");
    expect(fmtEta(21000, 5)).toBe("about 1 h 10 min");
  });
  it("falls back to 4 m/s when the speed is absent or under 1 m/s", () => {
    expect(fmtEta(1200, null)).toBe("about 5 min");
    expect(fmtEta(1200, undefined)).toBe("about 5 min");
    expect(fmtEta(1200, 0.4)).toBe("about 5 min");
    expect(fmtEta(1200, 1)).toBe("about 20 min");
  });
  it("puts distance and time on one line", () => {
    expect(fmtDistTime(1240, 4.1)).toBe("1.2 km, about 5 min");
    expect(fmtDistTime(840, null)).toBe("840 m, about 4 min");
  });
  it("words the manoeuvre after next", () => {
    expect(thenText("right", "Cable Street")).toBe("then right onto Cable Street");
    expect(thenText("slight_left", "The Highway")).toBe("then bear left onto The Highway");
    expect(thenText("sharp_right", "")).toBe("then sharp right");
    expect(thenText("straight", "Wapping Wall")).toBe("then continue onto Wapping Wall");
  });
  it("says the time left in a story", () => {
    expect(fmtLeft(20)).toBe("under a minute left");
    expect(fmtLeft(185)).toBe("3 min left");
    expect(storyLeft({ audio: { dur: 100, marks: [0, 40, 70] } }, 1)).toBe(60);
    expect(storyLeft({}, 0)).toBeNull();
  });
  it("describes the listening time and the average speed", () => {
    expect(fmtListening(32)).toBe("about 30 min of listening");
    expect(fmtListening(8)).toBe("about 8 min of listening");
    expect(avgKmh(20, 3600000)).toBe(20);
    expect(avgKmh(1, 30000)).toBeNull();
  });
});
