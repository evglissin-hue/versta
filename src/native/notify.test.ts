import { describe, expect, it, vi } from "vitest";
import type { Cue, NavState, Pack } from "../types";
import { createNotifier, NOTICE_GAP_MS, RIDE_CHANNEL, RIDE_NOTICE_ID, type NotifyApi } from "./notify";

const pack = { stops: ["Start", "Tower", "Deptford"].map((name) => ({ name })) } as unknown as Pack;
const nav = (toCue: number, name = "Jamaica Road", o: Partial<NavState> = {}): NavState => ({
  status: "riding", fix: null, snapped: null, seg: 2, alongSeg: 0, toStop: 5000, distanceDone: 0, distanceLeft: 0, routeBearing: null,
  offRoute: false, offBy: 0, nextCue: { turn: "left", name } as Cue, toCue, currentCue: null, arrived: [], ...o,
});

function setup(native = true, perm = "granted") {
  const api = {
    createChannel: vi.fn(async () => {}), schedule: vi.fn(async (_o: { notifications: Record<string, unknown>[] }) => ({})),
    cancel: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ display: perm })), requestPermissions: vi.fn(async () => ({ display: "granted" })),
    addListener: vi.fn(async (_e: string, _cb: unknown) => ({})),
  };
  let t = 10_000;
  let asked = false;
  const n = createNotifier({
    load: async () => api as unknown as NotifyApi, native: () => native, now: () => t,
    asked: { get: () => asked, set: () => { asked = true; } },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { api, n, flush, tick: (ms: number) => { t += ms; } };
}

describe("rideNotice", () => {
  it("shows one ongoing silent notification on the ride channel, created once", async () => {
    const { api, n, flush, tick } = setup();
    n.rideNotice.update(nav(300), pack);
    await flush();
    tick(5000);
    n.rideNotice.update(nav(200), pack);
    await flush();
    expect(api.createChannel).toHaveBeenCalledTimes(1);
    expect(api.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: RIDE_CHANNEL, name: "Ride", importance: 2, vibration: false }));
    expect(api.schedule).toHaveBeenCalledTimes(2);
    expect(api.schedule.mock.calls[0]![0].notifications[0]).toMatchObject({
      id: RIDE_NOTICE_ID, title: "Turn left onto Jamaica Road", body: "300 m", ongoing: true, silent: true, channelId: "ride",
    });
  });
  it("shows the same text once", async () => {
    const { api, n, flush, tick } = setup();
    expect(n.rideNotice.update(nav(300), pack)).toBe(true);
    tick(5000);
    expect(n.rideNotice.update(nav(300), pack)).toBe(false);
    expect(n.rideNotice.update(nav(290), pack)).toBe(false);
    await flush();
    expect(api.schedule).toHaveBeenCalledTimes(1);
  });
  it("shows a change of 50 m or more, but not twice inside a second", () => {
    const { n, tick } = setup();
    n.rideNotice.update(nav(300), pack);
    tick(NOTICE_GAP_MS - 1);
    expect(n.rideNotice.update(nav(240), pack)).toBe(false);
    tick(1);
    expect(n.rideNotice.update(nav(240), pack)).toBe(true);
    tick(5000);
    expect(n.rideNotice.update(nav(200), pack)).toBe(false);
    expect(n.rideNotice.update(nav(190), pack)).toBe(true);
  });
  it("shows a new turn at once", () => {
    const { n } = setup();
    n.rideNotice.update(nav(300), pack);
    expect(n.rideNotice.update(nav(300, "High Street"), pack)).toBe(true);
    expect(n.rideNotice.update(nav(0, "x", { offRoute: true }), pack)).toBe(true);
  });
  it("clears when the text ends and on clear()", async () => {
    const { api, n, flush } = setup();
    n.rideNotice.update(nav(300), pack);
    await flush();
    n.rideNotice.update(nav(300, "x", { status: "finished" }), pack);
    await flush();
    expect(api.cancel).toHaveBeenCalledWith({ notifications: [{ id: RIDE_NOTICE_ID }] });
    await n.rideNotice.clear();
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("ensurePermission", () => {
  it("asks once", async () => {
    const { api, n } = setup(true, "prompt");
    expect(await n.ensurePermission()).toBe(true);
    await n.ensurePermission();
    expect(api.requestPermissions).toHaveBeenCalledTimes(1);
  });
  it("never asks again after a refusal and shows nothing", async () => {
    const { api, n, flush } = setup(true, "denied");
    expect(await n.ensurePermission()).toBe(false);
    expect(api.requestPermissions).not.toHaveBeenCalled();
    n.rideNotice.update(nav(300), pack);
    await flush();
    expect(api.schedule).not.toHaveBeenCalled();
  });
});

describe("places", () => {
  it("posts on the places channel with default importance and reports taps", async () => {
    const { api, n, flush } = setup();
    await n.placeNotice(7, "Tower", "A story", { place: "tower" });
    expect(api.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: "places", name: "Places nearby", importance: 3 }));
    expect(api.schedule.mock.calls[0]![0].notifications[0]).toMatchObject({ id: 7, channelId: "places", extra: { place: "tower" } });
    const got: unknown[] = [];
    n.onNoticeTap((e) => got.push(e));
    await flush();
    const cb = api.addListener.mock.calls[0]![1] as (a: { notification: { extra?: unknown } }) => void;
    cb({ notification: { extra: { place: "tower" } } });
    cb({ notification: {} });
    expect(got).toEqual([{ place: "tower" }]);
  });
});

describe("on the web", () => {
  it("does nothing and never touches the plugin", async () => {
    const { api, n, flush } = setup(false);
    expect(n.rideNotice.update(nav(300), pack)).toBe(false);
    await n.rideNotice.show({ title: "a", body: "b" });
    await n.rideNotice.clear();
    expect(await n.ensurePermission()).toBe(false);
    await n.placeNotice(1, "a", "b");
    n.onNoticeTap(() => {})();
    await flush();
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
  });
});
