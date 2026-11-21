import { signal } from "@preact/signals";
import { geoDistance } from "../geo";
import type { SavedRide } from "../ride";
import type { LngLat, NavState, Pack } from "../types";

/** Whether the full-screen story scene is showing. A story can keep playing with the scene hidden. */
export const sceneOpen = signal(true);
export const stopsOpen = signal(false);
export const soundOpen = signal(false);
/** The Sound check screen: every sound, to hear before a ride. Reachable from Home and from the sound sheet. */
export const soundCheckOpen = signal(false);
/** Map camera follows the rider. */
export const following = signal(true);
/** The map shows the whole route with the rider. Following is off while it does. */
export const wholeRoute = signal(false);
/** A peek at the next turn: the camera is on that manoeuvre until `until`, then following resumes. */
export const peek = signal<{ at: LngLat; until: number } | null>(null);
/** When the rider last touched the map, in milliseconds. Restarts the wait before following comes back. */
export const lastTouch = signal(0);
/** The zoom the follow camera uses, in map zoom levels. Remembered for the session. */
export const followZoom = signal(16.2);
/** Preview only: freezes the auto-recentre ring at this share (0 to 1) and stops the timer. */
export const ringDemo = signal<number | null>(null);

export const PEEK_MS = 4000;
export const RECENTRE_MS = 8000;
export const RECENTRE_WHOLE_MS = 12000;
let peekTimer = 0;

/** Back to following, eased: clears the whole route view and any peek. */
export function resumeFollow(): void {
  clearTimeout(peekTimer);
  peek.value = null;
  wholeRoute.value = false;
  following.value = true;
}
/** The rider took the camera (a drag or a rotate): stop following and start the wait to come back. */
export function leaveFollow(): void {
  clearTimeout(peekTimer);
  peek.value = null;
  following.value = false;
  lastTouch.value = Date.now();
}
/** Show the whole route with the rider. */
export function showWholeRoute(): void {
  clearTimeout(peekTimer);
  peek.value = null;
  wholeRoute.value = true;
  following.value = false;
  lastTouch.value = Date.now();
}
/** Fly to a manoeuvre for a few seconds, then follow again. */
export function peekAt(at: LngLat): void {
  clearTimeout(peekTimer);
  wholeRoute.value = false;
  peek.value = { at, until: Date.now() + PEEK_MS };
  peekTimer = window.setTimeout(resumeFollow, PEEK_MS);
}
/** Whether the finish logbook is showing. "Back to the map" hides it until the next finish. */
export const finishOpen = signal(true);
/** When the ride finished, in milliseconds. */
export const finishedAt = signal<number | null>(null);
/** The rider's own choice while heading for the route: the start, or the nearest point of the route. Null means the nearer one. */
export const joinTarget = signal<"start" | "route" | null>(null);
/** Preview only: stands in for the ride controller's start time and the director's heard list. */
export const demoRide = signal<{ startedAt: number; finishedAt: number; heard: string[] } | null>(null);

export interface JoinChoice {
  /** Metres to the start of the route. */
  startDist: number;
  /** Metres to the nearest point of the route, or null when joining there is not offered (no point, or it is next to the start). */
  routeDist: number | null;
  at: { start: LngLat; route: LngLat | null };
  chosen: "start" | "route";
}

/** Joining only matters when the nearest point is further than this from the start. */
export const JOIN_MIN_FROM_START = 150;

/** What the rider can head for while the route is not under them yet. Null in any other state. */
export function joinChoice(n: NavState, p: Pack): JoinChoice | null {
  if (n.status !== "to_start") return null;
  const start = p.stops[0]?.at;
  if (!start) return null;
  const near = n.nearest ?? null;
  const offered = near !== null && geoDistance(near.at, start) > JOIN_MIN_FROM_START;
  const routeDist = offered && near ? near.dist : null;
  const nearer: "start" | "route" = routeDist !== null && routeDist < n.toStop ? "route" : "start";
  const picked = joinTarget.value;
  const chosen = picked === "route" && routeDist === null ? "start" : picked ?? nearer;
  return { startDist: n.toStop, routeDist, at: { start, route: offered && near ? near.at : null }, chosen };
}

// Handle for the end-to-end tests: what the camera controls are doing.
declare global { interface Window { __verstaUi?: { following: typeof following; wholeRoute: typeof wholeRoute; peek: typeof peek; followZoom: typeof followZoom } } }
if (typeof window !== "undefined") window.__verstaUi = { following, wholeRoute, peek, followZoom };

/** The one-time sheet before the first ride on this device. Holds the ride it will start. */
export const firstRideSheet = signal<{ id: string; resume: SavedRide | null } | null>(null);
/** A ride being started from Home: the route is loading, or the ride itself is starting. */
export const startPhase = signal<{ id: string; phase: "loading" | "starting" } | null>(null);
/** The last start that failed, with what it takes to try again. */
export const startFailure = signal<{ id: string; kind: "load" | "start"; resume: SavedRide | null } | null>(null);
/** The device has no network. */
export const netDown = signal(typeof navigator !== "undefined" && navigator.onLine === false);

/** Back 15 s is offered when a recorded story is playing (not read by tapping) and the director can rewind. The preview has no director. */
export function canRewind(manual: boolean, director: { rewind?: unknown } | null): boolean {
  if (manual) return false;
  if (director) return typeof director.rewind === "function";
  return new URLSearchParams(location.search).get("demo") === "ride";
}
