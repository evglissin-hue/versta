/**
 * Pocket alerts: with the phone in a pocket, a local notification when the rider passes a place that has a story.
 * It uses the background GPS watcher (its own options), `createArrivalWatcher` for the arrivals and the places
 * notifications of src/native/notify.ts. Android app only. Browser-only assumptions stay out of this file; the
 * Nearby screen is loaded on demand, so a ride does not pull the map in by importing this.
 */
import { signal } from "@preact/signals";
import { geoDistance } from "../geo";
import { createNativeGpsSource, PLACE_WATCHER_OPTIONS } from "../native/gps";
import { ensurePermission, onNoticeTap, placeNotice } from "../native/notify";
import { isNative } from "../native/platform";
import type { FixSource, LngLat, Place, PlacesFile } from "../types";
import { loadPlaces } from "./library";
import { createArrivalWatcher } from "./nearby";

/** Notification ids for places are this plus the place's index in places.json (the ride notice is 1001). */
export const PLACE_NOTICE_BASE = 2000;
/** The watch turns itself off this long after it was switched on. */
export const WATCH_MS = 8 * 60 * 60 * 1000;
/** The fewest milliseconds between two place notifications. */
export const NOTICE_GAP_MS = 5 * 60 * 1000;
/** No notifications from QUIET_FROM (inclusive) to QUIET_TO (exclusive), local hours. */
export const QUIET_FROM = 22;
export const QUIET_TO = 7;
export const REFUSED_NOTE = "Notifications are off for Versta. Turn them on in Android settings to use this.";

const KEY_UNTIL = "versta.placeWatch";
const KEY_SEEN = "versta.placeSeen";
const KEY_LAST = "versta.placeLast";
/** A held-back arrival is still told when the rider is within this many radii of the place. */
const STILL_NEAR = 2;

export interface WatchStore { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }

export interface WatchDeps {
  native?: () => boolean;
  now?: () => number;
  source?: () => FixSource;
  places?: () => Promise<PlacesFile>;
  ensurePermission?: () => Promise<boolean>;
  notify?: (id: number, title: string, body: string, extra?: unknown) => Promise<void>;
  store?: WatchStore;
  /** What a tap on a place notification does with the place id. */
  openPlace?: (placeId: string) => void;
  onTap?: (handler: (extra: unknown) => void) => () => void;
}

export type StartResult = "on" | "refused" | "unsupported";

function localStore(): WatchStore {
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage full: the watch just forgets after a relaunch */ } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* nothing to do */ } },
  };
}

export const isQuietHour = (ms: number): boolean => {
  const h = new Date(ms).getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
};

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Opens Nearby and plays the place's first story. The screen sets `nearbyControls` when it mounts, so wait for it. */
async function openAndPlay(placeId: string): Promise<void> {
  const [{ nearbyOpen }, ui] = await Promise.all([import("../ui/uistate"), import("../ui/Nearby")]);
  nearbyOpen.value = true;
  for (let i = 0; i < 150; i++) {
    if (ui.nearbyControls.play?.(placeId)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function createPlaceWatch(deps: WatchDeps = {}) {
  const native = deps.native ?? isNative;
  const now = deps.now ?? Date.now;
  const makeSource = deps.source ?? (() => createNativeGpsSource(undefined, PLACE_WATCHER_OPTIONS));
  const getPlaces = deps.places ?? loadPlaces;
  const askPermission = deps.ensurePermission ?? ensurePermission;
  const notify = deps.notify ?? placeNotice;
  const store = deps.store ?? localStore();
  const openPlace = deps.openPlace ?? ((id: string) => { void openAndPlay(id); });

  const until = (): number => { const n = Number(store.get(KEY_UNTIL)); return Number.isFinite(n) ? n : 0; };
  const on = signal(false);
  // Remembered across launches: the switch reads On straight away; init() restarts the watcher behind it.
  if (native() && until() > now()) on.value = true;
  let source: FixSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let file: PlacesFile | null = null;
  let loading = false;
  let arrivals = createArrivalWatcher();
  let held: Place[] = [];
  let run = 0;
  let tapOff: (() => void) | null = null;

  function seenMap(): Record<string, string> {
    try { const j: unknown = JSON.parse(store.get(KEY_SEEN) ?? "{}"); return j && typeof j === "object" ? (j as Record<string, string>) : {}; } catch { return {}; }
  }
  function lastAt(): number { const n = Number(store.get(KEY_LAST)); return Number.isFinite(n) ? n : 0; }

  function halt(): void {
    run++;
    if (timer) { clearTimeout(timer); timer = null; }
    source?.stop();
    source = null;
    held = [];
    arrivals = createArrivalWatcher();
    store.remove(KEY_UNTIL);
    on.value = false;
  }

  async function tell(place: Place): Promise<void> {
    const first = place.stories[0];
    const t = now();
    const index = file ? file.places.findIndex((p) => p.id === place.id) : -1;
    if (!first || index < 0) return;
    const seen = seenMap();
    seen[place.id] = dayKey(t);
    store.set(KEY_SEEN, JSON.stringify(seen));
    store.set(KEY_LAST, String(t));
    await notify(PLACE_NOTICE_BASE + index, place.name, `${first.title}. Tap to hear it.`, { place: place.id });
  }

  function onFix(fix: { lng: number; lat: number }, mine: number): void {
    if (mine !== run) return;
    const t = now();
    if (t >= until()) { halt(); return; }
    if (!file) {
      if (!loading) {
        loading = true;
        getPlaces().then((f) => { file = f; }, () => { /* tried again on a later fix */ }).finally(() => { loading = false; });
      }
      return;
    }
    const here: LngLat = [fix.lng, fix.lat];
    const withStories = file.places.filter((p) => p.stories.length > 0);
    const fresh = arrivals.check(here, withStories);
    const quiet = isQuietHour(t);
    // Arrivals during quiet hours are dropped. Arrivals held back by the 5 minute gap wait for it while the rider is still near.
    if (!quiet) held.push(...fresh.filter((p) => !held.some((h) => h.id === p.id)));
    else held = [];
    if (quiet) return;
    const today = dayKey(t);
    const seen = seenMap();
    held = held.filter((p) => seen[p.id] !== today && geoDistance(here, p.at) <= p.radius * STILL_NEAR);
    if (held.length === 0 || t - lastAt() < NOTICE_GAP_MS) return;
    held.sort((a, b) => geoDistance(here, a.at) - geoDistance(here, b.at));
    const next = held.shift()!;
    void tell(next);
  }

  function launch(): void {
    const mine = ++run;
    arrivals = createArrivalWatcher();
    held = [];
    source = makeSource();
    on.value = true;
    timer = setTimeout(() => { if (mine === run) halt(); }, Math.max(0, until() - now()));
    source.start(
      (fix) => onFix(fix, mine),
      (err) => { if (mine === run && err === "denied") halt(); },
    );
  }

  /** Switch on: asks for notification permission first. A refusal leaves it off. */
  async function start(): Promise<StartResult> {
    if (!native()) return "unsupported";
    if (source) return "on";
    if (!(await askPermission())) { halt(); return "refused"; }
    store.set(KEY_UNTIL, String(now() + WATCH_MS));
    launch();
    return "on";
  }

  function stop(): void { halt(); }

  /**
   * At app launch: listen for taps on place notifications, and restart the watch if it was on and has not expired.
   * Call once. A cold start from a tap is handled too (the plugin keeps the tap until a listener exists).
   */
  function init(): void {
    if (!native()) return;
    tapOff?.();
    tapOff = (deps.onTap ?? onNoticeTap)((extra) => {
      const id = extra && typeof extra === "object" ? (extra as { place?: unknown }).place : undefined;
      if (typeof id === "string") openPlace(id);
    });
    if (source) return;
    const u = until();
    if (u > now()) launch(); else if (u) store.remove(KEY_UNTIL);
  }

  return { on, start, stop, init };
}

const watch = createPlaceWatch();
/** True while the pocket watch runs. */
export const placeWatchOn = watch.on;
export const startPlaceWatch = watch.start;
export const stopPlaceWatch = watch.stop;
/** Call once when the app starts. */
export const initPlaceWatch = watch.init;
