/**
 * The ride controller: wires position source -> navigation engine -> director -> state.
 * This is the only place those modules meet. UI code calls startRide / endRide and reads state.
 */
import { createNavEngine } from "./nav/engine";
import { createGpsSource, createSimSource } from "./nav/sources";
import { geoDistance } from "./geo";
import { createMixer } from "./audio/mixer";
import { effect } from "@preact/signals";
import { createDirector } from "./story/director";
import { beginRecording, type RideRecorder } from "./record/recorder";
import { isNative } from "./native/platform";
import { ensurePermission, rideNotice } from "./native/notify";
import { IDLE_NAV, directorLog, gpsError, nav, nowPlaying, openStop, pack, packBase, packIndex, screen, settings, simulated, startChoice } from "./state";
import type { Director, Fix, FixSource, LngLat, Mixer, NavEngine, Pack, RouteGraph, SoundEvent, StartChoice } from "./types";

export interface SimOptions { speed: number; scale: number; from: number; virtualAudio: boolean }

interface Ride { pack: Pack; source: FixSource; engine: NavEngine; mixer: Mixer; director: Director; wake: WakeLockSentinel | null; startedAt: number; stopEffects: () => void; rec: RideRecorder | null }
const BED_LEVELS = { soft: 0.6, balanced: 1, rich: 1.6 } as const;
/** How long the simulated rider stands after arriving before a story has started: the director's arrival lead plus a margin. */
const ARRIVAL_HOLD_MS = 4000;
function buzz(pattern: number | number[]): void {
  try { if (settings.value.haptics && !simulated.value && "vibrate" in navigator) navigator.vibrate(pattern); } catch {}
}
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
export function forgetSavedRide(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  // an update held back for the saved ride may switch in now
  routesRideEnded();
}
/** Tell the route store (Android app) that no ride holds its updates or transfers back now. */
function routesRideEnded(): void {
  if (isNative()) void import("./routes/store").then((m) => m.routeStore.rideEnded()).catch(() => {});
}
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
  const clock = (): number => (source.now ? source.now() : Date.now());
  const mixer = createMixer({ baseUrl: packBase(p.id), virtual: sim?.virtualAudio ?? false, timeScale: sim?.scale ?? 1, clock });
  await mixer.unlock();
  // the next turn on the lock screen (Android): asked once, the ride works without it
  if (!sim) void ensurePermission();
  const engine = createNavEngine(p);
  const director = createDirector({
    pack: p, mixer, settings: () => settings.value, clock, timeScale: sim?.scale ?? 1,
    onNowPlaying: (now) => {
      nowPlaying.value = now;
      // the simulated rider stands still while a story plays at the stop it belongs to, as a real one would
      const fix = engine.state.fix;
      const atItsStop = now?.kind === "story" && fix !== null && geoDistance([fix.lng, fix.lat], p.stops[now.stop]!.at) < 120;
      source.hold?.(atItsStop);
    },
    onLog: (entry) => {
      ride?.rec?.log(entry);
      directorLog.value = [...directorLog.value.slice(-400), entry];
      if (entry.what === "arrive" || entry.what === "story_start" || entry.what === "aside_played" || entry.what === "finished") saveRide();
    },
  });
  // the rider's soundscape level follows the setting, live
  const stopEffects = effect(() => { mixer.setBedLevel?.(BED_LEVELS[settings.value.bedLevel] ?? 1); });
  // every real ride is recorded on the device, so a problem met on the road can be replayed as a test
  const rec = sim ? null : beginRecording({ packId: p.id, version: packIndex.value.find((e) => e.id === p.id)?.version ?? null, startAt: 0, app: isNative() ? "android" : "web" });
  ride = { pack: p, source, engine, mixer, director, wake: await acquireWake(), startedAt: resume?.startedAt ?? Date.now(), stopEffects, rec };
  let lastFix: Fix | null = null;
  chooseHook = (stop: number) => {
    if (!choosing || ride?.engine !== engine) return;
    choosing = false;
    startChoice.value = null;
    engine.startAt?.(stop);
    if (ride.rec) { ride.rec.recording.startAt = stop; ride.rec.tap("choose_stop", stop); }
    if (lastFix) {
      const events = engine.update(lastFix);
      ride.rec?.events(lastFix.time, events);
      nav.value = { ...engine.state };
      director.handle(events, engine.state);
    }
  };
  if (resume && resume.packId === p.id) {
    director.markHeard?.(resume.heard);
    engine.jumpToSegment(Math.min(resume.seg, p.stops.length - 1));
  }
  if (p.graph && engine.setGraph) {
    void fetch(`${packBase(p.id)}${p.graph}`).then((r) => (r.ok ? r.json() : null)).then((g: RouteGraph | null) => { if (g && ride?.engine === engine) engine.setGraph?.(g); }).catch(() => {});
  }
  simulated.value = !!sim; gpsError.value = null; directorLog.value = []; openStop.value = null; startChoice.value = null;
  nav.value = { ...IDLE_NAV, status: "locating" };
  // A real ride from the beginning asks where to start when the rider is far from stop 1 and nearer another stop.
  // Until the rider chooses, the engine sees no fix: no guidance, no speech. (Simulated rides choose by URL.)
  let choosing = !sim && !(resume && resume.packId === p.id);
  screen.value = "ride";
  document.addEventListener("visibilitychange", onVisible);
  source.start(
    (fix) => {
      if (!ride) return;
      if (gpsError.value) gpsError.value = null;
      ride.rec?.fix(fix);
      if (choosing) {
        const offer = startOffer(p, fix);
        if (!offer) choosing = false;
        else {
          lastFix = fix;
          if (!startChoice.value) startChoice.value = offer;
          nav.value = { ...nav.value, fix };
          return;
        }
      }
      const events = engine.update(fix);
      ride.rec?.events(fix.time, events);
      nav.value = { ...engine.state };
      if (!sim) rideNotice.update(engine.state, p);
      director.handle(events, engine.state);
      for (const e of events) {
        if (e.type === "finished") ride.rec?.end();
        if (e.type === "arrive") {
          openStop.value = e.stop; buzz([60, 80, 60]);
          // the simulated rider stands through the short lead before a stop's first story, as a real one would
          if (sim && source.hold) {
            source.hold(true);
            // after an arrival the engine is already on the next leg: release only while it still is, and nothing plays
            const leg = engine.state.seg;
            setTimeout(() => { if (ride?.source === source && nowPlaying.value === null && engine.state.seg === leg) source.hold?.(false); }, ARRIVAL_HOLD_MS / (sim.scale > 0 ? sim.scale : 1));
          }
        }
        else if (e.type === "cue" && e.phase === "now" && e.cue.turn !== "depart" && e.cue.turn !== "straight") buzz(40);
        else if (e.type === "off_route" || e.type === "wrong_way") buzz([30, 60, 30, 60, 30]);
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
  ride.rec?.tap("end"); ride.rec?.end();
  void rideNotice.clear();
  ride.stopEffects(); ride.source.stop(); ride.director.stopAll(); ride.director.dispose(); ride.mixer.dispose?.();
  void ride.wake?.release().catch(() => {});
  ride = null; chooseHook = null; startChoice.value = null;
  routesRideEnded();
  nav.value = IDLE_NAV; nowPlaying.value = null; openStop.value = null; screen.value = "home";
}

export function currentDirector(): Director | null { return ride?.director ?? null; }
/** The ride's mixer, for the Sound check screen while a ride is running. */
export function currentMixer(): Mixer | null { return ride?.mixer ?? null; }
/** How far from stop 1 a rider must be, with another stop nearer, to be asked where to start. */
export const START_CHOICE_METRES = 300;

/** The start choice to offer for this fix, or null when stop 1 is the obvious start. Straight-line distances. */
export function startOffer(p: Pack, fix: Fix): StartChoice | null {
  const here: LngLat = [fix.lng, fix.lat];
  const dists = p.stops.map((s) => geoDistance(here, s.at));
  const first = dists[0] ?? 0;
  let nearest = 0;
  dists.forEach((d, i) => { if (d < dists[nearest]!) nearest = i; });
  // the last stop is where the ride ends: starting there is no ride
  if (nearest === p.stops.length - 1) {
    nearest = 0;
    dists.forEach((d, i) => { if (i < p.stops.length - 1 && d < dists[nearest]!) nearest = i; });
  }
  if (first <= START_CHOICE_METRES || nearest === 0) return null;
  return { nearest, toNearest: dists[nearest]!, toFirst: first };
}

let chooseHook: ((stop: number) => void) | null = null;
/** The rider chose where to start: stop 0 or the offered nearest stop. (The start choice sheet, task 25.) */
export function chooseStart(stop: number): void { chooseHook?.(stop); }

/** Rider chose to head for another stop (skipped one, or joined the route part way). */
export function jumpToStop(stop: number): void {
  if (!ride) return;
  ride.rec?.tap("jump", stop);
  ride.engine.jumpToSegment(stop);
  nav.value = { ...ride.engine.state };
}

// Handle for the end-to-end tests and for debugging on the phone.
declare global { interface Window { __versta?: { nav: typeof nav; log: typeof directorLog; nowPlaying: typeof nowPlaying; pack: typeof pack; timeline: () => readonly SoundEvent[] } } }
window.__versta = { nav, log: directorLog, nowPlaying, pack, timeline: () => (ride?.mixer as { timeline?: readonly SoundEvent[] } | undefined)?.timeline ?? [] };
