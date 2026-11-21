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
import { IDLE_NAV, directorLog, gpsError, nav, nowPlaying, openStop, pack, packBase, screen, settings, simulated } from "./state";
import type { Director, FixSource, Mixer, NavEngine, Pack, RouteGraph, SoundEvent } from "./types";

export interface SimOptions { speed: number; scale: number; from: number; virtualAudio: boolean }

interface Ride { pack: Pack; source: FixSource; engine: NavEngine; mixer: Mixer; director: Director; wake: WakeLockSentinel | null; startedAt: number; stopEffects: () => void }
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
  const clock = (): number => (source.now ? source.now() : Date.now());
  const mixer = createMixer({ baseUrl: packBase(p.id), virtual: sim?.virtualAudio ?? false, timeScale: sim?.scale ?? 1, clock });
  await mixer.unlock();
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
      directorLog.value = [...directorLog.value.slice(-400), entry];
      if (entry.what === "arrive" || entry.what === "story_start" || entry.what === "aside_played" || entry.what === "finished") saveRide();
    },
  });
  // the rider's soundscape level follows the setting, live
  const stopEffects = effect(() => { mixer.setBedLevel?.(BED_LEVELS[settings.value.bedLevel] ?? 1); });
  ride = { pack: p, source, engine, mixer, director, wake: await acquireWake(), startedAt: resume?.startedAt ?? Date.now(), stopEffects };
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
  ride.stopEffects(); ride.source.stop(); ride.director.stopAll(); ride.director.dispose(); ride.mixer.dispose?.();
  void ride.wake?.release().catch(() => {});
  ride = null;
  nav.value = IDLE_NAV; nowPlaying.value = null; openStop.value = null; screen.value = "home";
}

export function currentDirector(): Director | null { return ride?.director ?? null; }
/** The ride's mixer, for the Sound check screen while a ride is running. */
export function currentMixer(): Mixer | null { return ride?.mixer ?? null; }
/** Rider chose to head for another stop (skipped one, or joined the route part way). */
export function jumpToStop(stop: number): void {
  if (!ride) return;
  ride.engine.jumpToSegment(stop);
  nav.value = { ...ride.engine.state };
}

// Handle for the end-to-end tests and for debugging on the phone.
declare global { interface Window { __versta?: { nav: typeof nav; log: typeof directorLog; nowPlaying: typeof nowPlaying; pack: typeof pack; timeline: () => readonly SoundEvent[] } } }
window.__versta = { nav, log: directorLog, nowPlaying, pack, timeline: () => (ride?.mixer as { timeline?: readonly SoundEvent[] } | undefined)?.timeline ?? [] };
