import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Fix, FixSource, GpsError, Place, PlacesFile } from "../types";
import { NOTICE_GAP_MS, PLACE_NOTICE_BASE, REFUSED_NOTE, WATCH_MS, createPlaceWatch, isQuietHour, type WatchStore } from "./watch";

const place = (id: string, lng: number, name = id): Place => ({
  id, name, at: [lng, 51.5], radius: 50, pack: "p", kind: "stop",
  stories: [{ id: "s", title: `Story of ${name}`, kind: "core", audio: "a.mp3", dur: 60 }],
});
const FILE: PlacesFile = { version: "v", places: [place("p:a", 0.0, "Alpha"), place("p:b", 0.02, "Bravo"), place("p:c", 0.04, "Charlie")] };
const FAR: [number, number] = [0.1, 51.5];
const A: [number, number] = [0.0, 51.5];
const B: [number, number] = [0.02, 51.5];

function setup(opts: { native?: boolean; permit?: boolean; start?: Date } = {}) {
  let t = (opts.start ?? new Date(2026, 5, 1, 12, 0, 0)).getTime();
  const mem = new Map<string, string>();
  const store: WatchStore = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
  let onFix: (f: Fix) => void = () => {};
  let onErr: (e: GpsError) => void = () => {};
  const startFn = vi.fn((f: (x: Fix) => void, e: (x: GpsError) => void) => { onFix = f; onErr = e; });
  const source: FixSource = { start: startFn, stop: vi.fn() };
  const notify = vi.fn(async (_id: number, _title: string, _body: string, _extra?: unknown) => {});
  const openPlace = vi.fn();
  let tap: (extra: unknown) => void = () => {};
  const make = () => createPlaceWatch({
    native: () => opts.native ?? true, now: () => t, source: () => source, places: async () => FILE,
    ensurePermission: async () => opts.permit ?? true, notify, store, openPlace, onTap: (h) => { tap = h; return () => {}; },
  });
  const fix = async (pos: [number, number]) => {
    onFix({ lng: pos[0], lat: pos[1], accuracy: 5, heading: null, speed: null, time: t });
    await vi.advanceTimersByTimeAsync(0);
  };
  /** The first fix loads the places, the second sets the arrival watcher's previous position. */
  const warm = async () => { await fix(FAR); await fix(FAR); };
  return { tap: (e: unknown) => tap(e), make, fix, warm, notify, source, startFn, store, openPlace, err: (e: GpsError) => onErr(e), advance: (ms: number) => { t += ms; }, mem };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("place watch", () => {
  it("notifies once on entering a radius, with the first story and the place id", async () => {
    const s = setup();
    const w = s.make();
    expect(await w.start()).toBe("on");
    await s.warm();
    await s.fix(A);
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenCalledWith(PLACE_NOTICE_BASE, "Alpha", "Story of Alpha. Tap to hear it.", { place: "p:a" });
    await s.fix([0.0001, 51.5]);
    expect(s.notify).toHaveBeenCalledTimes(1);
  });

  it("uses 2000 plus the index in places.json", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    await s.warm();
    await s.fix(B);
    expect(s.notify.mock.calls[0]![0]).toBe(2001);
  });

  it("tells a place at most once a day, again the next day", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    await s.warm();
    await s.fix(A);
    s.advance(NOTICE_GAP_MS + 1000);
    w.stop(); await w.start();
    await s.warm(); await s.fix(A);
    expect(s.notify).toHaveBeenCalledTimes(1);
    s.advance(24 * 60 * 60 * 1000);
    w.stop(); await w.start();
    await s.warm(); await s.fix(A);
    expect(s.notify).toHaveBeenCalledTimes(2);
  });

  it("holds a second place for five minutes, then tells it while the rider is still there", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    await s.warm();
    await s.fix(A);
    await s.fix(B);
    s.advance(60_000);
    await s.fix(B);
    expect(s.notify).toHaveBeenCalledTimes(1);
    s.advance(NOTICE_GAP_MS);
    await s.fix(B);
    expect(s.notify).toHaveBeenCalledTimes(2);
    expect(s.notify.mock.calls[1]![1]).toBe("Bravo");
  });

  it("drops a held place when the rider has moved on", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    await s.warm();
    await s.fix(A);
    await s.fix(B);
    await s.fix(FAR);
    s.advance(NOTICE_GAP_MS + 1000);
    await s.fix(FAR);
    expect(s.notify).toHaveBeenCalledTimes(1);
  });

  it("is quiet from 22:00 to 07:00", async () => {
    expect(isQuietHour(new Date(2026, 5, 1, 22, 0).getTime())).toBe(true);
    expect(isQuietHour(new Date(2026, 5, 1, 6, 59).getTime())).toBe(true);
    expect(isQuietHour(new Date(2026, 5, 1, 7, 0).getTime())).toBe(false);
    expect(isQuietHour(new Date(2026, 5, 1, 21, 59).getTime())).toBe(false);
    const s = setup({ start: new Date(2026, 5, 1, 23, 0) });
    const w = s.make();
    await w.start();
    await s.warm();
    await s.fix(A);
    expect(s.notify).not.toHaveBeenCalled();
  });

  it("turns itself off after 8 hours", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    expect(w.on.value).toBe(true);
    s.advance(WATCH_MS);
    await vi.advanceTimersByTimeAsync(WATCH_MS);
    expect(w.on.value).toBe(false);
    expect(s.source.stop).toHaveBeenCalled();
    expect(s.mem.has("versta.placeWatch")).toBe(false);
  });

  it("turns off on a fix after the expiry even if the timer was missed", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    s.advance(WATCH_MS + 1);
    await s.fix(FAR);
    expect(w.on.value).toBe(false);
  });

  it("restarts after a relaunch while on, not after it expired", async () => {
    const s = setup();
    await s.make().start();
    const second = s.make();
    expect(second.on.value).toBe(true);
    const before = s.startFn.mock.calls.length;
    second.init();
    expect(s.startFn.mock.calls.length).toBe(before + 1);
    s.advance(WATCH_MS + 1);
    const third = s.make();
    expect(third.on.value).toBe(false);
    third.init();
    expect(s.startFn.mock.calls.length).toBe(before + 1);
  });

  it("stop (a ride starting) ends the watch and is not restarted by init", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    w.stop();
    expect(w.on.value).toBe(false);
    expect(s.source.stop).toHaveBeenCalled();
    const calls = s.startFn.mock.calls.length;
    s.make().init();
    expect(s.startFn.mock.calls.length).toBe(calls);
  });

  it("stays off when notifications are refused", async () => {
    const s = setup({ permit: false });
    const w = s.make();
    expect(await w.start()).toBe("refused");
    expect(w.on.value).toBe(false);
    expect(s.startFn).not.toHaveBeenCalled();
    expect(REFUSED_NOTE).toBe("Notifications are off for Versta. Turn them on in Android settings to use this.");
  });

  it("a tap on a place notification opens that place, other taps do nothing", () => {
    const s = setup();
    s.make().init();
    s.tap({ place: "p:b" });
    s.tap(undefined);
    s.tap({ other: 1 });
    expect(s.openPlace).toHaveBeenCalledTimes(1);
    expect(s.openPlace).toHaveBeenCalledWith("p:b");
  });

  it("does nothing on the web", async () => {
    const s = setup({ native: false });
    const w = s.make();
    expect(await w.start()).toBe("unsupported");
    expect(w.on.value).toBe(false);
    expect(s.startFn).not.toHaveBeenCalled();
  });

  it("switches off when location is denied", async () => {
    const s = setup();
    const w = s.make();
    await w.start();
    s.err("denied");
    expect(w.on.value).toBe(false);
  });
});
