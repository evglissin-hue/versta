/**
 * The ride controller: wires position source -> navigation engine -> director -> state.
 * This is the only place those modules meet. UI code calls startRide / endRide and reads state.
 */
import { createNavEngine } from "./nav/engine";
import { createGpsSource, createSimSource } from "./nav/sources";
import { geoDistance } from "./geo";
import { createMixer } from "./audio/mixer";
import { createDirector } from "./story/director";
import { IDLE_NAV, directorLog, gpsError, nav, nowPlaying, openStop, pack, packBase, screen, settings, simulated } from "./state";
import type { Director, FixSource, Mixer, NavEngine, Pack, RouteGraph } from "./types";

export interface SimOptions { speed: number; scale: number; from: number; virtualAudio: boolean }

interface Ride { pack: Pack; source: FixSource; engine: NavEngine; mixer: Mixer; director: Director; wake: WakeLockSentinel | null; startedAt: number }
let ride: Ride | null = null;

/** A ride in progress, kept on the device so closing the app does not lose it. */
export interface SavedRide { packId: string; seg: number; arrived: number[]; heard: string[]; startedAt: number; savedAt: number }
const SAVE_KEY = "versta:ride";
const SAVE_MAX_AGE = 12 * 60 * 60 * 1000;

/** The unfinished ride saved on this device, if it is recent enough to continue. */
export function savedRide(): SavedRide | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as SavedRide | null;
    return s && Date.now() - s.savedAt < SAVE_MAX_AGE ? s : null;
  } catch { return null; }
}
export function forgetSavedRide(): void { try { localStorage.removeItem(SAVE_KEY); } catch {} }
function saveRide(): void {
  if (!ride || simulated.value) return;
  const st = ride.engine.state;
  if (st.status === "finished") { forgetSavedRide(); return; }
  if (st.arrived.length === 0) return;
  const saved: SavedRide = { packId: ride.pack.id, seg: st.seg, arrived: [...st.arrived], heard: [...ride.director.heard], startedAt: ride.startedAt, savedAt: Date.now() };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch {}
}
/** When the current ride started, in milliseconds, or null with no ride. */
export function rideStartedAt(): number | null { return ride?.startedAt ?? null; }

/** Simulator settings from the URL: ?sim=1&speed=5&scale=20&from=0&virtual=1 */
export function simFromUrl(): SimOptions | null {
  const q = new URLSearchParams(location.search);
  if (q.get("sim") !== "1") return null;
  return { speed: Number(q.get("speed") ?? 5), scale: Number(q.get("scale") ?? 1), from: Number(q.get("from") ?? 0), virtualAudio: q.get("virtual") === "1" };
}

export async function loadPack(id: string): Promise<Pack> {
  const res = await fetch(`${packBase(id)}pack.json`);
  if (!res.ok) throw new Error(`Could not load route ${id}`);
  const p = (await res.json()) as Pack;
  pack.value = p;
  return p;
}

async function acquireWake(): Promise<WakeLockSentinel | null> {
  try { return settings.value.keepAwake && "wakeLock" in navigator ? await navigator.wakeLock.request("screen") : null; } catch { return null; }
}
function onVisible(): void {
  if (ride && document.visibilityState === "visible" && !ride.wake) void acquireWake().then((w) => { if (ride) ride.wake = w; });
}

/** Start riding. Call it from a tap: it unlocks audio and asks for the location permission. */
export async function startRide(p: Pack, sim: SimOptions | null = simFromUrl(), resume: SavedRide | null = null): Promise<void> {
  endRide(false);
  const source = sim ? createSimSource(p, sim) : createGpsSource();
  const mixer = createMixer({ baseUrl: packBase(p.id), virtual: sim?.virtualAudio ?? false, timeScale: sim?.scale ?? 1 });
  await mixer.unlock();
  const engine = createNavEngine(p);
  const director = createDirector({
    pack: p, mixer, settings: () => settings.value, clock: () => (source.now ? source.now() : Date.now()), timeScale: sim?.scale ?? 1,
    onNowPlaying: (now) => {
      nowPlaying.value = now;
      // the simulated rider stands still while a story plays at the stop it belongs to, as a real one would
      const fix = engine.state.fix;
      const atItsStop = now?.kind === "story" && fix !== null && geoDistance([fix.lng, fix.lat], p.stops[now.stop]!.at) < 120;
      source.hold?.(atItsStop);
    },
    onLog: (entry) => {
      directorLog.value = [...directorLog.value.slice(-400), entry];
      if (entry.what === "arrive" || entry.what === "story_start" || entry.what === "aside_played" || entry.what === "finished") saveRide();
    },
  });
  ride = { pack: p, source, engine, mixer, director, wake: await acquireWake(), startedAt: resume?.startedAt ?? Date.now() };
  if (resume && resume.packId === p.id) {
    director.markHeard?.(resume.heard);
    engine.jumpToSegment(Math.min(resume.seg, p.stops.length - 1));
  }
  if (p.graph && engine.setGraph) {
    void fetch(`${packBase(p.id)}${p.graph}`).then((r) => (r.ok ? r.json() : null)).then((g: RouteGraph | null) => { if (g && ride?.engine === engine) engine.setGraph?.(g); }).catch(() => {});
  }
  simulated.value = !!sim; gpsError.value = null; directorLog.value = []; openStop.value = null;
  nav.value = { ...IDLE_NAV, status: "locating" };
  screen.value = "ride";
  document.addEventListener("visibilitychange", onVisible);
  source.start(
    (fix) => {
      if (!ride) return;
      if (gpsError.value) gpsError.value = null;
      const events = engine.update(fix);
      nav.value = { ...engine.state };
      director.handle(events, engine.state);
      for (const e of events) {
        if (e.type === "arrive") openStop.value = e.stop;
        // riding away puts the map and the turn banner back in view without a tap
        else if (e.type === "leave" && openStop.value === e.stop) openStop.value = null;
      }
    },
    (error) => { gpsError.value = error; },
  );
}

/** End the ride. A rider who ends it on purpose does not get "Continue ride" offered again. */
export function endRide(forget = true): void {
  if (!ride) return;
  if (forget) forgetSavedRide();
  document.removeEventListener("visibilitychange", onVisible);
  ride.source.stop(); ride.director.stopAll(); ride.director.dispose();
  void ride.wake?.release().catch(() => {});
  ride = null;
  nav.value = IDLE_NAV; nowPlaying.value = null; openStop.value = null; screen.value = "home";
}

export function currentDirector(): Director | null { return ride?.director ?? null; }
/** Rider chose to head for another stop (skipped one, or joined the route part way). */
export function jumpToStop(stop: number): void {
  if (!ride) return;
  ride.engine.jumpToSegment(stop);
  nav.value = { ...ride.engine.state };
}

// Handle for the end-to-end tests and for debugging on the phone.
declare global { interface Window { __versta?: { nav: typeof nav; log: typeof directorLog; nowPlaying: typeof nowPlaying; pack: typeof pack } } }
window.__versta = { nav, log: directorLog, nowPlaying, pack };
