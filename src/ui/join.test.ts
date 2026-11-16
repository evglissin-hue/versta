import { describe, expect, it } from "vitest";
import { IDLE_NAV } from "../state";
import type { NavState, Pack } from "../types";
import { joinChoice, joinTarget } from "./uistate";

const pack = { stops: [{ at: [0, 51.5] }] } as unknown as Pack;
const toStart = (over: Partial<NavState>): NavState => ({ ...IDLE_NAV, status: "to_start", toStop: 2100, ...over });
// about 0.0045 degrees of longitude is 310 m at this latitude
const far: [number, number] = [0.0045, 51.5];
const near: [number, number] = [0.0005, 51.5];

describe("joinChoice", () => {
  it("offers nothing off the to_start state", () => {
    expect(joinChoice({ ...IDLE_NAV, status: "riding" }, pack)).toBeNull();
  });
  it("defaults to whichever is nearer", () => {
    joinTarget.value = null;
    expect(joinChoice(toStart({ nearest: { at: far, seg: 4, dist: 300 } }), pack)?.chosen).toBe("route");
    expect(joinChoice(toStart({ toStop: 200, nearest: { at: far, seg: 4, dist: 300 } }), pack)?.chosen).toBe("start");
  });
  it("hides joining when the nearest point is within 150 m of the start", () => {
    const j = joinChoice(toStart({ nearest: { at: near, seg: 1, dist: 90 } }), pack);
    expect(j?.routeDist).toBeNull();
    expect(j?.chosen).toBe("start");
  });
  it("keeps the rider's own choice", () => {
    joinTarget.value = "start";
    expect(joinChoice(toStart({ nearest: { at: far, seg: 4, dist: 300 } }), pack)?.chosen).toBe("start");
    joinTarget.value = null;
  });
});
