/**
 * Position source for the Android app. It uses the background geolocation plugin, which runs a foreground service so
 * fixes keep coming with the screen off. The plugin is loaded with a dynamic import so the browser build never
 * contains it. Browser-only assumptions stay out of this file.
 */
import type { Fix, FixSource, GpsError } from "../types";

/** The part of the plugin's location object that we read. */
export interface PluginLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  bearing: number | null;
  speed: number | null;
  time: number | null;
}

export interface PluginError { code?: string; message?: string }

export interface WatcherOptions {
  backgroundMessage: string;
  backgroundTitle: string;
  requestPermissions: boolean;
  stale: boolean;
  distanceFilter: number;
}

/** The part of the plugin's API that we call. */
export interface BackgroundGeolocationApi {
  addWatcher(options: WatcherOptions, callback: (location?: PluginLocation, error?: PluginError) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

export const WATCHER_OPTIONS: WatcherOptions = {
  backgroundTitle: "Versta",
  backgroundMessage: "Following your ride.",
  requestPermissions: true,
  stale: false,
  distanceFilter: 3,
};

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Map a plugin location to a Fix. Heading comes from `bearing`. */
export function locationToFix(loc: PluginLocation, now: () => number = Date.now): Fix {
  return {
    lng: loc.longitude,
    lat: loc.latitude,
    accuracy: finite(loc.accuracy) ?? 0,
    heading: finite(loc.bearing),
    speed: finite(loc.speed),
    time: finite(loc.time) ?? now(),
  };
}

/** Permission refusal becomes `denied`; anything else the plugin reports is `unavailable`. */
export function errorToGps(err: PluginError | undefined): GpsError {
  return err?.code === "NOT_AUTHORIZED" ? "denied" : "unavailable";
}

/** The app's own plugin (android/.../KeepAwakePlugin.java): a CPU wake lock held while a ride is followed. */
export interface KeepAwakeApi {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export interface NativePlugins { geo: BackgroundGeolocationApi; keepAwake?: KeepAwakeApi }

async function loadPlugins(): Promise<NativePlugins> {
  const { registerPlugin } = await import("@capacitor/core");
  return {
    geo: registerPlugin<BackgroundGeolocationApi>("BackgroundGeolocation"),
    keepAwake: registerPlugin<KeepAwakeApi>("KeepAwake"),
  };
}

export function createNativeGpsSource(load: () => Promise<NativePlugins> = loadPlugins): FixSource {
  // Each start gets a number, so a stop (or a restart) that happens while the plugin is still loading is honoured.
  let run = 0;
  let plugins: NativePlugins | null = null;
  let watcherId: string | null = null;

  function release(): void {
    const id = watcherId;
    watcherId = null;
    if (id !== null && plugins) void plugins.geo.removeWatcher({ id }).catch(() => {});
    if (plugins?.keepAwake) void plugins.keepAwake.release().catch(() => {});
  }

  return {
    start(onFix, onError) {
      const mine = ++run;
      release();
      load().then(async (loaded) => {
        if (mine !== run) return;
        plugins = loaded;
        const api = loaded.geo;
        // A failed wake lock must not stop the ride: location still works, the page just may sleep sooner.
        if (loaded.keepAwake) void loaded.keepAwake.acquire().catch(() => {});
        const id = await api.addWatcher(WATCHER_OPTIONS, (location, error) => {
          if (mine !== run) return;
          if (error || !location) { onError(errorToGps(error)); return; }
          onFix(locationToFix(location));
        });
        if (mine !== run) { void api.removeWatcher({ id }).catch(() => {}); return; }
        watcherId = id;
      }).catch((err: PluginError) => {
        if (mine === run) onError(errorToGps(err));
      });
    },
    stop() {
      run += 1;
      release();
    },
  };
}
