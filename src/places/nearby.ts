/** Pure helpers for the Nearby screen. No browser APIs. */
import { geoDistance } from "../geo";
import type { LngLat, Place } from "../types";

export interface NearbyPlace { place: Place; dist: number }

/** Places within `within` metres of `here`, nearest first. */
export function nearbyPlaces(places: Place[], here: LngLat, within = 3000): NearbyPlace[] {
  return places
    .map((place) => ({ place, dist: geoDistance(here, place.at) }))
    .filter((p) => p.dist <= within)
    .sort((a, b) => a.dist - b.dist);
}

/** The places whose radius the rider is inside now and was outside at `prev` (or `prev` is unknown). Nearest first. */
export function arrivals(prev: LngLat | null, here: LngLat, places: Place[]): Place[] {
  return places
    .map((place) => ({ place, now: geoDistance(here, place.at), before: prev ? geoDistance(prev, place.at) : Infinity }))
    .filter((p) => p.now <= p.place.radius && p.before > p.place.radius)
    .sort((a, b) => a.now - b.now)
    .map((p) => p.place);
}

/** `arrivals` that remembers: each place is reported once, until the watcher is dropped (the session ends). */
export function createArrivalWatcher(): { check(here: LngLat, places: Place[]): Place[]; reset(): void } {
  let prev: LngLat | null = null;
  const done = new Set<string>();
  return {
    check(here, places) {
      const fresh = arrivals(prev, here, places).filter((p) => !done.has(p.id));
      prev = here;
      for (const p of fresh) done.add(p.id);
      return fresh;
    },
    reset() { prev = null; done.clear(); },
  };
}

/** The paragraph playing at `seconds`, from the story's paragraph start times. Without marks, spread by text length. */
export function paraAt(seconds: number, marks: number[] | undefined, paras: string[], dur: number): number {
  if (paras.length <= 1) return 0;
  if (marks && marks.length === paras.length) {
    let k = 0;
    for (let i = 0; i < marks.length; i++) if (seconds >= marks[i]!) k = i;
    return k;
  }
  const total = paras.reduce((n, p) => n + p.length, 0) || 1;
  let acc = 0;
  for (let i = 0; i < paras.length; i++) {
    acc += paras[i]!.length;
    if (seconds < (acc / total) * dur) return i;
  }
  return paras.length - 1;
}
