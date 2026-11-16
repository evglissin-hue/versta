import type { LngLat } from "../types";

const R = 6371008.8;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Length of a polyline in metres. */
export function lineLength(line: LngLat[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversine(line[i - 1] as LngLat, line[i] as LngLat);
  return m;
}

/** Splits a polyline at `dist` metres from its start. Both halves share the split point. */
export function splitAt(line: LngLat[], dist: number): [LngLat[], LngLat[]] {
  if (line.length < 2) return [line.slice(), []];
  if (dist <= 0) return [[], line.slice()];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as LngLat;
    const b = line[i] as LngLat;
    const seg = haversine(a, b);
    if (run + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - run) / seg;
      const p: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      return [[...line.slice(0, i), p], [p, ...line.slice(i)]];
    }
    run += seg;
  }
  return [line.slice(), []];
}

/** Metres per CSS pixel at a latitude and MapLibre zoom (512 px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (78271.517 * Math.cos(rad(lat))) / 2 ** zoom;
}

/** Signed shortest turn from bearing `b` to bearing `a`, in degrees, from -180 to 180. */
export function angleDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export const FOLLOW_ZOOM_MIN = 14.5;
export const FOLLOW_ZOOM_MAX = 18;
export const clampFollowZoom = (z: number): number => Math.min(FOLLOW_ZOOM_MAX, Math.max(FOLLOW_ZOOM_MIN, z));

/** The zoom the follow camera uses: the rider's own zoom, in a little for a turn close ahead, out a little when fast. */
export function cameraZoom(base: number, o: { toCue: number | null; turnAhead: boolean; speed: number | null }): number {
  let z = base;
  if (o.turnAhead && o.toCue !== null && o.toCue < 120) z += 0.4;
  if (o.speed !== null && o.speed > 7) z -= 0.4;
  return z;
}

/**
 * Where the rider sits in the visible band between `top` and `bottom` insets of a map `height` tall:
 * returns the padding that puts the map centre there. `share` is how far down the band (0.5 is the middle).
 */
export function lookAheadPadding(height: number, top: number, bottom: number, share: number): { top: number; bottom: number } {
  const visible = height - top - bottom;
  if (visible < 120) return { top, bottom };
  return { top: Math.round(top + visible * (2 * share - 1)), bottom };
}
