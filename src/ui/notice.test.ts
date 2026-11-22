import { describe, expect, it } from "vitest";
import type { Cue, NavState, Pack } from "../types";
import { rideNoticeText } from "./notice";

const names = ["Start", "Tower", "Deptford", "Foot Tunnel"];
const pack = { stops: names.map((name) => ({ name })) } as unknown as Pack;
const cue = (turn: Cue["turn"], name: string) => ({ turn, name }) as Cue;
const nav = (o: Partial<NavState>): NavState => ({
  status: "riding", fix: null, snapped: null, seg: 2, alongSeg: 0, toStop: 1234, distanceDone: 0, distanceLeft: 0, routeBearing: null,
  offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [], ...o,
});

describe("rideNoticeText", () => {
  it("names the next turn and its distance", () => {
    expect(rideNoticeText(nav({ nextCue: cue("left", "Jamaica Road"), toCue: 203 }), pack))
      .toEqual({ title: "Turn left onto Jamaica Road", body: "200 m", dist: 203 });
  });
  it("words a straight on without onto twice", () => {
    expect(rideNoticeText(nav({ nextCue: cue("straight", "Jamaica Road"), toCue: 1500 }), pack)?.title).toBe("Continue onto Jamaica Road");
  });
  it("says now when the turn is here", () => {
    expect(rideNoticeText(nav({ nextCue: cue("right", "High St"), toCue: 8 }), pack)?.body).toBe("now");
  });
  it("falls back to the next stop when no turn is ahead", () => {
    expect(rideNoticeText(nav({}), pack)).toEqual({ title: "Next stop: 03 Deptford", body: "1.2 km", dist: 1234 });
  });
  it("shows the arrival and the stop after", () => {
    expect(rideNoticeText(nav({ status: "at_stop", seg: 1 }), pack)).toEqual({ title: "At 02 Tower", body: "03 Deptford", dist: null });
  });
  it("guides to the start", () => {
    expect(rideNoticeText(nav({ status: "to_start", seg: 3, toStop: 640 }), pack)).toEqual({ title: "Head for 04 Foot Tunnel", body: "640 m", dist: 640 });
  });
  it("says when off the route", () => {
    expect(rideNoticeText(nav({ offRoute: true, nextCue: cue("left", "X"), toCue: 90 }), pack))
      .toEqual({ title: "Off the route", body: "Head back to the line", dist: null });
  });
  it("is null when idle, locating, finished or without a pack", () => {
    for (const status of ["idle", "locating", "finished"] as const) expect(rideNoticeText(nav({ status }), pack)).toBeNull();
    expect(rideNoticeText(nav({}), null)).toBeNull();
  });
});
