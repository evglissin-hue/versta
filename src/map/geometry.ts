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
