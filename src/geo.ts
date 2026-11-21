import type { LngLat } from "./types";

/** A point in metres on the local flat projection: [east, north]. */
export type XY = [number, number];

const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export interface Projection { origin: LngLat; kx: number; ky: number }

/** Local equirectangular projection centred on `origin`. Accurate to centimetres over a few kilometres. */
export function makeProjection(origin: LngLat): Projection {
  const ky = EARTH_RADIUS * RAD;
  return { origin, kx: ky * Math.cos(origin[1] * RAD), ky };
}

export function project(proj: Projection, p: LngLat): XY {
  return [(p[0] - proj.origin[0]) * proj.kx, (p[1] - proj.origin[1]) * proj.ky];
}

export function unproject(proj: Projection, p: XY): LngLat {
  return [proj.origin[0] + p[0] / proj.kx, proj.origin[1] + p[1] / proj.ky];
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Bearing from a to b in degrees clockwise from north, 0 to 360. */
export function bearing(a: XY, b: XY): number {
  const deg = Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
  return (deg + 360) % 360;
}

/** Great-circle distance in metres between two WGS84 points. */
export function geoDistance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance at every vertex. cum[0] is 0 and the last entry is the length. */
export function cumulative(pts: XY[]): number[] {
  const cum: number[] = [];
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) sum += dist(pts[i - 1]!, pts[i]!);
    cum.push(sum);
  }
  return cum;
}

export function polylineLength(pts: XY[]): number {
  const cum = cumulative(pts);
  return cum.length ? cum[cum.length - 1]! : 0;
}

export interface Nearest {
  point: XY;
  /** Metres along the polyline from its start. */
  along: number;
  /** Metres from the query point to `point`. */
  dist: number;
  /** Index of the leg (vertex i to i + 1) the point lies on. */
  leg: number;
}

/**
 * Nearest point on a polyline. With `minAlong` and `maxAlong` only the part of the line between those distances
 * is searched, which keeps a rider from snapping to a distant part of a route that doubles back on itself. With
 * `heading` (degrees, the direction the rider is going), a leg that runs more than 90 degrees against it counts as
 * `against` metres further away when choosing, so at a hairpin a rider is kept on the leg they are riding even when
 * the GPS puts them nearer the other. The returned `dist` is always the true distance.
 */
export function nearestOnPolyline(pts: XY[], p: XY, cum: number[] = cumulative(pts), minAlong = 0, maxAlong = Infinity, heading: number | null = null, against = 0): Nearest {
  if (pts.length === 0) return { point: p, along: 0, dist: Infinity, leg: 0 };
  if (pts.length === 1) return { point: pts[0]!, along: 0, dist: dist(p, pts[0]!), leg: 0 };
  let best: Nearest | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const start = cum[i]!;
    const end = cum[i + 1]!;
    const len = end - start;
    if (len <= 0 || end < minAlong || start > maxAlong) continue;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    let t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
    const lo = Math.max(0, (minAlong - start) / len);
    const hi = Math.min(1, (maxAlong - start) / len);
    t = Math.min(hi, Math.max(lo, t));
    const point: XY = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = dist(p, point);
    const score = heading !== null && against > 0 && Math.abs(angleDiff(bearing(a, b), heading)) > 90 ? d + against : d;
    if (!best || score < bestScore) { best = { point, along: start + t * len, dist: d, leg: i }; bestScore = score; }
  }
  if (best) return best;
  // The window missed the line entirely: search all of it.
  if (minAlong > 0 || maxAlong < Infinity) return nearestOnPolyline(pts, p, cum, 0, Infinity, heading, against);
  return { point: pts[0]!, along: 0, dist: dist(p, pts[0]!), leg: 0 };
}

export interface PointAlong { point: XY; bearing: number; leg: number }

/** The point `d` metres along a polyline (clamped to its ends) and the bearing of the leg it lies on. */
export function pointAlong(pts: XY[], d: number, cum: number[] = cumulative(pts)): PointAlong {
  if (pts.length === 0) return { point: [0, 0], bearing: 0, leg: 0 };
  if (pts.length === 1) return { point: pts[0]!, bearing: 0, leg: 0 };
  const total = cum[cum.length - 1]!;
  const at = Math.min(total, Math.max(0, d));
  let leg = 0;
  while (leg < pts.length - 2 && cum[leg + 1]! < at) leg++;
  // Skip zero-length legs so the bearing is meaningful.
  while (leg < pts.length - 2 && cum[leg + 1]! - cum[leg]! <= 0) leg++;
  const a = pts[leg]!;
  const b = pts[leg + 1]!;
  const len = cum[leg + 1]! - cum[leg]!;
  const t = len > 0 ? (at - cum[leg]!) / len : 0;
  return { point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], bearing: bearing(a, b), leg };
}

/** Signed difference between two bearings, -180 to 180. Positive means a turn to the right (clockwise). */
export function angleDiff(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
