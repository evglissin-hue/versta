import { signal } from "@preact/signals";
import { geoDistance } from "../geo";
import type { LngLat, NavState, Pack } from "../types";

/** Whether the full-screen story scene is showing. A story can keep playing with the scene hidden. */
export const sceneOpen = signal(true);
export const stopsOpen = signal(false);
export const soundOpen = signal(false);
/** Map camera follows the rider. */
export const following = signal(true);
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
