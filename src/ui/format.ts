import type { Pack, TurnKind } from "../types";

export const pad2 = (n: number): string => String(n).padStart(2, "0");
export const stopLabel = (pack: Pack, i: number): string => `${pad2(i + 1)} ${pack.stops[i]?.name ?? ""}`;

/** Distance as a rider wants it: to 10 m under a kilometre, then one decimal of km. */
export function fmtDist(m: number, nowUnder = 0): string {
  if (m < nowUnder) return "now";
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const TURN_ANGLE: Record<TurnKind, number> = {
  depart: 0, straight: 0, slight_right: 45, right: 90, sharp_right: 135, slight_left: -45, left: -90, sharp_left: -135,
};
export const turnAngle = (t: TurnKind): number => TURN_ANGLE[t];

const TURN_WORD: Record<TurnKind, string> = {
  depart: "Set off", straight: "Continue onto", slight_left: "Bear left", slight_right: "Bear right",
  left: "Turn left", right: "Turn right", sharp_left: "Sharp left", sharp_right: "Sharp right",
};
export const turnWord = (t: TurnKind): string => TURN_WORD[t];

export function minutesOf(story: { paras: string[]; audio?: { dur: number } }): number {
  if (story.audio) return Math.max(1, Math.round(story.audio.dur / 60));
  return Math.max(1, Math.round(story.paras.join(" ").split(/\s+/).length / 140));
}

function hav(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const lenCache = new WeakMap<Pack, number[]>();
/** Metres of each segment (segment i leads to stop i). */
export function segmentLengths(pack: Pack): number[] {
  let lens = lenCache.get(pack);
  if (!lens) {
    lens = pack.segments.map((seg) => seg.reduce((sum, p, i) => (i === 0 ? 0 : sum + hav(seg[i - 1]!, p)), 0));
    lenCache.set(pack, lens);
  }
  return lens;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function fmtMB(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

/** Time taken, as a rider says it: "48 min" or "2 h 14 min". */
export function fmtDuration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The label above a distance: "Turn left in", or just "Turn left" once the turn is here. "Continue onto" has no distance after it. */
export function turnLabel(t: TurnKind, dist: number | null): string {
  if (t === "straight") return turnWord(t);
  return dist !== null && dist < 20 ? turnWord(t) : `${turnWord(t)} in`;
}

/** Speed assumed for the time estimate when the rider is not moving or the speed is not known yet, metres per second. */
export const DEFAULT_SPEED = 4;

/** "about 5 min" or "about 1 h 10 min": the time to cover `m` metres at the smoothed speed, or 4 m/s when that is absent or under 1 m/s. */
export function fmtEta(m: number, speed: number | null | undefined): string {
  const v = speed != null && speed >= 1 ? speed : DEFAULT_SPEED;
  const mins = Math.max(1, Math.round(m / v / 60));
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r === 0 ? `about ${h} h` : `about ${h} h ${r} min`;
}

/** "1.2 km, about 5 min": the line under the next stop's name. */
export function fmtDistTime(m: number, speed: number | null | undefined): string {
  return `${fmtDist(m)}, ${fmtEta(m, speed)}`;
}

const THEN_WORD: Record<TurnKind, string> = {
  depart: "set off", straight: "continue", left: "left", right: "right",
  slight_left: "bear left", slight_right: "bear right", sharp_left: "sharp left", sharp_right: "sharp right",
};
/** The small second line of the turn banner: "then right onto Cable Street". */
export function thenText(turn: TurnKind, name: string): string {
  const word = THEN_WORD[turn];
  if (!name) return `then ${word}`;
  return `then ${word} onto ${name}`;
}
