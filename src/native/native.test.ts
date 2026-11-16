import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeGpsSource, errorToGps, locationToFix, WATCHER_OPTIONS, type BackgroundGeolocationApi, type KeepAwakeApi, type PluginLocation } from "./gps";
import { gpsKind } from "../nav/sources";
import { isNative } from "./platform";

const loc: PluginLocation = { latitude: 51.5, longitude: -0.12, accuracy: 7, bearing: 90, speed: 4.2, time: 1_700_000_000_000 };

afterEach(() => { delete (globalThis as { Capacitor?: unknown }).Capacitor; });

describe("locationToFix", () => {
  it("maps every field, heading from bearing", () => {
    expect(locationToFix(loc)).toEqual({ lng: -0.12, lat: 51.5, accuracy: 7, heading: 90, speed: 4.2, time: 1_700_000_000_000 });
  });
  it("keeps unknown heading and speed as null and fills a missing time", () => {
    const fix = locationToFix({ ...loc, bearing: null, speed: null, time: null }, () => 42);
    expect(fix.heading).toBeNull();
    expect(fix.speed).toBeNull();
    expect(fix.time).toBe(42);
  });
  it("treats NaN as unknown", () => {
    expect(locationToFix({ ...loc, bearing: NaN, speed: NaN }).heading).toBeNull();
  });
});

describe("errorToGps", () => {
  it("maps permission refusal to denied and the rest to unavailable", () => {
    expect(errorToGps({ code: "NOT_AUTHORIZED" })).toBe("denied");
    expect(errorToGps({ code: "OTHER" })).toBe("unavailable");
    expect(errorToGps(undefined)).toBe("unavailable");
  });
});

describe("source choice by platform", () => {
  it("uses the browser source when there is no Capacitor shell", () => {
    expect(isNative()).toBe(false);
    expect(gpsKind()).toBe("browser");
  });
  it("uses the native source inside the app", () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(gpsKind()).toBe("native");
  });
  it("stays on the browser source when Capacitor reports a web platform", () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
    expect(gpsKind()).toBe("browser");
  });
});

function fakePlugin() {
  let cb: ((l?: PluginLocation, e?: { code?: string }) => void) | null = null;
  const api = {
    addWatcher: vi.fn(async (_o: unknown, c: typeof cb) => { cb = c; return "w1"; }),
    removeWatcher: vi.fn(async () => {}),
  };
  const keepAwake = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  return { api: api as unknown as BackgroundGeolocationApi & typeof api, keepAwake: keepAwake as unknown as KeepAwakeApi & typeof keepAwake, emit: (l?: PluginLocation, e?: { code?: string }) => cb?.(l, e) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createNativeGpsSource", () => {
  it("adds a watcher with the agreed options and forwards fixes and errors", async () => {
    const { api, keepAwake, emit } = fakePlugin();
    const src = createNativeGpsSource(async () => ({ geo: api, keepAwake }));
    const onFix = vi.fn(); const onError = vi.fn();
    src.start(onFix, onError);
    await flush();
    expect(api.addWatcher.mock.calls[0]![0]).toEqual(WATCHER_OPTIONS);
    expect(WATCHER_OPTIONS).toMatchObject({ backgroundTitle: "Versta", backgroundMessage: "Following your ride.", requestPermissions: true, stale: false, distanceFilter: 3 });
    emit(loc);
    expect(onFix).toHaveBeenCalledWith(locationToFix(loc));
    emit(undefined, { code: "NOT_AUTHORIZED" });
    expect(onError).toHaveBeenCalledWith("denied");
  });
  it("removes the watcher on stop and ignores later fixes", async () => {
    const { api, keepAwake, emit } = fakePlugin();
    const src = createNativeGpsSource(async () => ({ geo: api, keepAwake }));
    const onFix = vi.fn();
    src.start(onFix, vi.fn());
    await flush();
    src.stop();
    expect(api.removeWatcher).toHaveBeenCalledWith({ id: "w1" });
    expect(keepAwake.acquire).toHaveBeenCalledOnce();
    expect(keepAwake.release).toHaveBeenCalled();
    emit(loc);
    expect(onFix).not.toHaveBeenCalled();
  });
  it("removes a watcher that was added after stop was called", async () => {
    const { api, keepAwake } = fakePlugin();
    let release: (a: { geo: BackgroundGeolocationApi; keepAwake: KeepAwakeApi }) => void = () => {};
    const src = createNativeGpsSource(() => new Promise((r) => { release = r; }));
    src.start(vi.fn(), vi.fn());
    src.stop();
    release({ geo: api, keepAwake });
    await flush();
    expect(api.addWatcher).not.toHaveBeenCalled();
  });
  it("reports unavailable when the plugin cannot load", async () => {
    const src = createNativeGpsSource(async () => { throw new Error("no plugin"); });
    const onError = vi.fn();
    src.start(vi.fn(), onError);
    await flush();
    expect(onError).toHaveBeenCalledWith("unavailable");
  });
});
