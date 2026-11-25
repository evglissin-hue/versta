/**
 * The position filter (docs/build/it7-31-position.md). Every fix the navigation engine takes goes through it first,
 * so a GPS that jumps about in a street of tall buildings cannot move the rider's marker, or make the engine think
 * the rider has left the route. Pure: no browser APIs, local metres in and out.
 *
 * A constant-velocity Kalman filter, one per axis (east and north), driven by white acceleration noise. Velocity is
 * measured from the device's speed and bearing (GPS Doppler, which multipath barely touches), so the estimate keeps
 * moving the right way while bad positions are refused. Each position is gated against the accuracy it claims: within
 * three sigma it is taken, out to about five and a half sigma it is taken with less and less weight, beyond that it
 * is refused as a jump. A taken position counts for less than its claim (GPS errors hold for seconds, so fixes are not
 * independent). Duplicates, fixes older than the last and fixes that arrive late are refused outright.
 *
 * Refused fixes become the new track only when they say the rider is somewhere else and could have got there. While
 * the device gives no velocity that is a run of fixes that agree with each other. With GPS Doppler steering the dead
 * reckoning, a cluster of fixes that sits a steady 50 m to one side is multipath, not the rider: the estimate coasts
 * on, and takes the fixes only when they pull away from it steadily at a rider's pace, as a rider leaving the
 * bearing's path would, or after a long spell of nothing but refusals (the track itself was wrong).
 */
import type { XY } from "../geo";
import type { Fix } from "../types";

/** White acceleration noise, m²/s³. */
export const Q_ACC = 1.5;

/**
 * The filter's tuning, overridable for experiments and tests (docs/build/it7-32-jitter-hunt.md has the sweep that
 * chose these).
 * - softGate, hardGate: Mahalanobis squared distances over both axes, measured against the fix's claimed accuracy:
 *   up to softGate taken as is, up to hardGate with less and less weight, beyond it refused. A fix 60 m out that
 *   claims 9 m is refused, however little weight it would have had.
 * - rScale: a taken fix's standard deviation is its claim times this.
 * - initSigma: the first fix is trusted no better than this, metres, so a first fix that lies cannot lock the track.
 * - qAcc: white acceleration noise, m²/s³.
 * - lostDopplerMs: with device velocity, after this long with nothing but refusals the track is taken to be wrong.
 */
export interface FilterTuning { softGate: number; hardGate: number; rScale: number; initSigma: number; qAcc: number; lostDopplerMs: number }
export const DEFAULT_TUNING: FilterTuning = { softGate: 9, hardGate: 30, rScale: 2, initSigma: 12, qAcc: Q_ACC, lostDopplerMs: 30_000 };
/** No position is trusted to better than this, metres. */
const MIN_SIGMA = 4;
/** The fastest the rider is believed to go, m/s, for re-acquiring and for a device speed worth using. */
const V_MAX = 15;
/** Refused fixes that agree with each other: how many, over how long, and how close each is to the last. */
const REACQUIRE_FIXES = 4;
const REACQUIRE_MS = 3000;
const REACQUIRE_STEP = 15;
/** A rider pulling away from the dead reckoning: this many refused fixes, over at least this long. */
const PULL_FIXES = 6;
const PULL_MS = 5000;
/** Without device velocity, after this long with nothing but refusals the track is taken to be wrong. */
const LOST_MS = 12_000;
/** Device velocity this recent steers the dead reckoning well enough to refuse a steady cluster of fixes. */
const DOPPLER_FRESH_MS = 5000;

/** A fix that arrives this much later than the freshest one did is stale. */
const LATE_MS = 10_000;
/** Coasting: after this long without a taken position the velocity fades, with this time constant. */
const COAST_MS = 10_000;
const COAST_TAU = 10;
/** The device's speed: below this the rider is standing; from this up its bearing means something. */
const STAND_SPEED = 0.3;
const MOVE_SPEED = 1;
/** Heading is reported only from this speed. */
const HEADING_SPEED = 1.5;

export type RefusedWhy = "stale" | "late" | "jump" | "poor";

export interface Filtered {
  /** The fix's position was taken (true also when it re-acquired the track). */
  used: boolean;
  /** Why it was refused. A refused "jump" still moves the estimate along by dead reckoning. */
  why?: RefusedWhy;
  /** The track was reset to this fix: the position jumped on purpose. */
  reacquired?: boolean;
  /** The estimate at the fix's time, local metres. */
  p: XY;
  v: XY;
  /** The estimate's 1-sigma position error, metres. Honest: at least MIN_SIGMA, growing while coasting. */
  sigma: number;
  /** Metres per second. */
  speed: number;
  /** Degrees clockwise from north, or null below HEADING_SPEED. */
  heading: number | null;
}

interface Axis { x: number; v: number; pxx: number; pxv: number; pvv: number }

export interface PositionFilter {
  /** Feed one fix (its position projected to local metres). Fixes with an accuracy worse than `maxAccuracy` are refused as poor. */
  push(p: XY, fix: Fix): Filtered;
  /** Start the track afresh at this fix (the engine's snap back). */
  resetTo(p: XY, fix: Fix): Filtered;
  /** Forget everything. */
  reset(): void;
  /** The current estimate, or null before the first fix. */
  readonly estimate: Filtered | null;
}

const rad = Math.PI / 180;

export function createPositionFilter(maxAccuracy = 80, tune: Partial<FilterTuning> = {}): PositionFilter {
  const T: FilterTuning = { ...DEFAULT_TUNING, ...tune };
  let ax: Axis | null = null;
  let ay: Axis | null = null;
  let lastTime = -Infinity;
  let lastTaken = -Infinity;
  /** When the device last gave a moving velocity (speed and bearing). */
  let dopplerAt = -Infinity;
  let takenAt: XY | null = null;
  let est: Filtered | null = null;
  /** Fixes refused as jumps since the last taken one, with how far each was from the dead reckoning. */
  let jumps: { p: XY; time: number; acc: number; off: XY }[] = [];
  /** The smallest delay seen between a fix's time and its arrival, over the last fixes (a constant clock skew). */
  let lags: number[] = [];

  /** What the fix claims, for the gate; and the weight it gets, for the update. */
  const claim2 = (fix: Fix): number => Math.max(fix.accuracy, MIN_SIGMA) ** 2;
  const r2 = (fix: Fix): number => claim2(fix) * T.rScale ** 2;

  function velocityOf(fix: Fix): { v: XY; var: number } | null {
    const s = fix.speed;
    if (s === null || !Number.isFinite(s) || s < 0 || s > V_MAX) return null;
    if (s < STAND_SPEED) return { v: [0, 0], var: 0.5 ** 2 };
    if (s >= MOVE_SPEED && fix.heading !== null && Number.isFinite(fix.heading)) {
      const h = fix.heading * rad;
      return { v: [s * Math.sin(h), s * Math.cos(h)], var: (0.6 + 0.1 * s) ** 2 };
    }
    return null;
  }

  function init(p: XY, fix: Fix): void {
    const vel = velocityOf(fix);
    const pv = vel ? vel.var : 25;
    const p0 = Math.max(r2(fix), T.initSigma ** 2);
    ax = { x: p[0], v: vel ? vel.v[0] : 0, pxx: p0, pxv: 0, pvv: pv };
    ay = { x: p[1], v: vel ? vel.v[1] : 0, pxx: p0, pxv: 0, pvv: pv };
    lastTime = fix.time;
    lastTaken = fix.time;
    takenAt = p;
    jumps = [];
  }

  function predict(a: Axis, dt: number, coastMs: number): void {
    if (dt <= 0) return;
    a.x += a.v * dt;
    const q = T.qAcc;
    a.pxx += 2 * dt * a.pxv + dt * dt * a.pvv + (q * dt ** 3) / 3;
    a.pxv += dt * a.pvv + (q * dt * dt) / 2;
    a.pvv += q * dt;
    // a long coast with no position: the velocity fades rather than carrying the rider off for ever
    if (coastMs > COAST_MS) a.v *= Math.exp(-dt / COAST_TAU);
  }

  function updatePos(a: Axis, z: number, r: number): void {
    const s = a.pxx + r;
    const kx = a.pxx / s;
    const kv = a.pxv / s;
    const y = z - a.x;
    a.x += kx * y;
    a.v += kv * y;
    const pxx = a.pxx, pxv = a.pxv;
    a.pxx = pxx * (1 - kx);
    a.pxv = pxv * (1 - kx);
    a.pvv -= kv * pxv;
  }

  function updateVel(a: Axis, z: number, r: number): void {
    const s = a.pvv + r;
    const kx = a.pxv / s;
    const kv = a.pvv / s;
    const y = z - a.v;
    a.x += kx * y;
    a.v += kv * y;
    const pxv = a.pxv, pvv = a.pvv;
    a.pxx -= kx * pxv;
    a.pxv = pxv * (1 - kv);
    a.pvv = pvv * (1 - kv);
  }

  function snapshot(used: boolean, why?: RefusedWhy, reacquired?: boolean): Filtered {
    const x = ax!, y = ay!;
    const speed = Math.hypot(x.v, y.v);
    const heading = speed >= HEADING_SPEED ? ((Math.atan2(x.v, y.v) / rad) + 360) % 360 : null;
    const sigma = Math.max(MIN_SIGMA, Math.sqrt(Math.max(0, (x.pxx + y.pxx) / 2)));
    est = { used, p: [x.x, y.x], v: [x.v, y.v], sigma, speed, heading, ...(why ? { why } : {}), ...(reacquired ? { reacquired } : {}) };
    return est;
  }

  /** Refused without touching the track. */
  function refuse(why: RefusedWhy): Filtered {
    if (est) return { ...est, used: false, why };
    return { used: false, why, p: [0, 0], v: [0, 0], sigma: Infinity, speed: 0, heading: null };
  }

  function lateness(fix: Fix): boolean {
    if (fix.receivedAt === undefined || !Number.isFinite(fix.receivedAt)) return false;
    const lag = fix.receivedAt - fix.time;
    lags.push(lag);
    if (lags.length > 30) lags = lags.slice(-30);
    return lag - Math.min(...lags) > LATE_MS;
  }

  function push(p: XY, fix: Fix): Filtered {
    if (!(fix.accuracy <= maxAccuracy)) return refuse("poor");
    if (lateness(fix)) return refuse("late");
    if (!ax || !ay) { init(p, fix); return snapshot(true); }
    if (fix.time <= lastTime) return refuse("stale");
    const dt = (fix.time - lastTime) / 1000;
    const coast = fix.time - lastTaken;
    lastTime = fix.time;
    predict(ax, dt, coast);
    predict(ay, dt, coast);

    const r = r2(fix);
    const c = claim2(fix);
    const ix = p[0] - ax.x, iy = p[1] - ay.x;
    const d2 = (ix * ix) / (ax.pxx + c) + (iy * iy) / (ay.pxx + c);
    const vel = velocityOf(fix);
    if (d2 > T.hardGate) {
      jumps.push({ p, time: fix.time, acc: Math.max(fix.accuracy, MIN_SIGMA), off: [ix, iy] });
      if (reacquire(fix)) { init(p, fix); return snapshot(true, undefined, true); }
      // dead reckoning: the device's velocity still steers the estimate while its positions are refused
      if (vel) applyVelocity(vel, true);
      return snapshot(false, "jump");
    }
    const scale = d2 > T.softGate ? (d2 / T.softGate) ** 2 : 1;
    updatePos(ax, p[0], r * scale);
    updatePos(ay, p[1], r * scale);
    if (vel) applyVelocity(vel, false);
    lastTaken = fix.time;
    takenAt = [ax.x, ay.x];
    jumps = [];
    return snapshot(true);
  }

  /** Apply a velocity measurement, skipping one that disagrees wildly with the track (a speed made from a jump). */
  function applyVelocity(vel: { v: XY; var: number }, coasting: boolean): void {
    const x = ax!, y = ay!;
    // the device's own velocity, moving or standing: a cluster of fixes 50 m away while it says "standing" is multipath
    dopplerAt = lastTime;
    const dx = vel.v[0] - x.v, dy = vel.v[1] - y.v;
    const d2 = (dx * dx) / (x.pvv + vel.var) + (dy * dy) / (y.pvv + vel.var);
    if (d2 > (coasting ? 9 : 30)) return;
    updateVel(x, vel.v[0], vel.var);
    updateVel(y, vel.v[1], vel.var);
  }

  /**
   * The last refused fixes draw away from the dead reckoning as a rider leaving it would: for PULL_FIXES fixes over
   * at least PULL_MS, each further out, at 1.5 to 10 m/s, in one direction, and from much nearer than they end up.
   * Multipath does not: it lands far out at once and then sits there.
   */
  function pullingAway(): boolean {
    const run = jumps.slice(-PULL_FIXES);
    if (run.length < PULL_FIXES) return false;
    const first = run[0]!, last = run[run.length - 1]!;
    const span = (last.time - first.time) / 1000;
    if (span < PULL_MS / 1000) return false;
    const d = run.map((j) => Math.hypot(j.off[0], j.off[1]));
    const rate = (d[d.length - 1]! - d[0]!) / span;
    if (rate < 1.5 || rate > 10 || d[0]! > 0.7 * d[d.length - 1]!) return false;
    // steadily: no step back, and no step far bigger than the average one (multipath arrives in one or two leaps)
    for (let i = 1; i < d.length; i++) {
      const step = d[i]! - d[i - 1]!;
      const dt = (run[i]!.time - run[i - 1]!.time) / 1000;
      if (step < -2 || step > 2 * rate * dt + 4) return false;
    }
    const cos = (first.off[0] * last.off[0] + first.off[1] * last.off[1]) / Math.max(1e-6, d[0]! * d[d.length - 1]!);
    return cos > Math.cos(35 * rad);
  }

  /** The refused fixes say the rider is somewhere else, and could have got there: take them. */
  function reacquire(fix: Fix): boolean {
    const n = jumps.length;
    if (n === 0) return false;
    const newest = jumps[n - 1]!;
    const doppler = fix.time - dopplerAt <= DOPPLER_FRESH_MS;
    if (newest.time - lastTaken >= (doppler ? T.lostDopplerMs : LOST_MS)) return true;
    if (n < REACQUIRE_FIXES) return false;
    // With the device's velocity steering, a cluster that sits a steady distance to one side is multipath: coast on.
    // Fixes that pull away from the dead reckoning steadily, at a rider's pace and in one direction, are the rider
    // going where the device's bearing did not say (the bearing lags or lies): take them.
    if (doppler && !pullingAway()) return false;
    const run = jumps.slice(-REACQUIRE_FIXES);
    if (newest.time - run[0]!.time < REACQUIRE_MS) return false;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!, b = run[i]!;
      const gap = (b.time - a.time) / 1000;
      if (Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) > REACQUIRE_STEP + V_MAX * gap + b.acc) return false;
    }
    const from = takenAt ?? newest.p;
    const since = (fix.time - lastTaken) / 1000;
    return Math.hypot(newest.p[0] - from[0], newest.p[1] - from[1]) <= V_MAX * since + 2 * newest.acc;
  }

  return {
    push,
    resetTo(p, fix) { init(p, fix); return snapshot(true, undefined, true); },
    reset() { ax = null; ay = null; lastTime = -Infinity; lastTaken = -Infinity; dopplerAt = -Infinity; takenAt = null; est = null; jumps = []; lags = []; },
    get estimate() { return est; },
  };
}
