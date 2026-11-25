import { angleDiff, cumulative, dist, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type Nearest, type XY } from "../geo";
import type { Aside, Cue, Fix, NavEngine, NavEvent, NavOptions, NavState, Pack, RouteGraph } from "../types";
import { createPositionFilter, type FilterTuning, type Filtered } from "./filter";
import { buildIndex, findWayBack, type GraphIndex, type WayTarget, type WayTurn } from "./reroute";

export const DEFAULT_NAV_OPTIONS: NavOptions = {
  maxAccuracy: 80, offRouteDistance: 40, offRouteDelay: 10, cueNowDistance: 15, cueApproachSeconds: 15, cueApproachMin: 70, asideLead: 40,
};

/**
 * Off route (docs/build/it7-31-position.md): a spell starts when the filtered position is beyond the threshold
 * (offRouteDistance plus the position's error, capped). It fires after offRouteDelay seconds, with OFF_RIDDEN metres
 * ridden in the spell, and only when the rider is going away from the line (less than half the distance ridden went
 * along it), or is OFF_FAR metres past the threshold, or the spell has lasted OFF_LONG_SECONDS and OFF_LONG_RIDDEN
 * metres. Riding along the line with a biased GPS never fires it; standing still never does.
 */
const OFF_RIDDEN = 30;
const OFF_FAR = 30;
const OFF_LONG_SECONDS = 45;
const OFF_LONG_RIDDEN = 200;
/** The spell ends after two fixes this far inside the threshold. */
const OFF_CLEAR = 10;
/** The error the thresholds use: the filter's sigma, the reported accuracy (capped), never less than ERR_MIN. */
const ERR_MIN = 8;
const ERR_ACC_CAP = 60;
const ERR_THRESHOLD_CAP = 40;
/** Back on route takes this many fixes in a row within BACK_ON_ROUTE. */
const BACK_FIXES = 2;
/**
 * Snap back: refused fixes this close to the line, and this close to where the dead reckoning has the rider along it
 * (plus the distance ridden since the last fix), end a multipath spell. A fix on the line but far up the street is not
 * the rider coming back: multipath runs along streets as often as across them.
 */
const SNAP_BACK_LINE = 15;
const SNAP_BACK_ALONG = 25;
const SNAP_BACK_FIXES = 2;
/** The estimate counts as on the line within this many metres of it: then refused fixes on the line never reset it. */
const EST_ON_LINE = 20;
/** Refused fixes on the line but further along than SNAP_BACK_ALONG take over after this many in a row: the track itself was wrong. */
const ONLINE_FIXES = 4;
/** Riding, the position along the line advances at most this many times the rider's speed per second, plus ALONG_SLACK metres. */
const ALONG_RATE = 1.5;
const ALONG_SLACK = 12;
/** The drawn marker moves at most the rider's speed times the time since the last fix, plus this many metres: no leaps. */
const SHOWN_SLACK = 10;
/** The marker: on the line within SNAP_FULL plus the error (capped at SNAP_FULL), blending to the filtered position over SNAP_BLEND metres. */
const SNAP_FULL = 25;
const SNAP_BLEND = 30;
/**
 * Riding on at HOLD_SPEED or more, the marker on the line does not slide back: an estimate that falls back by up to
 * HOLD_BACK metres holds the marker where it is until the estimate catches up. Further back, or heading back, it follows.
 */
const HOLD_BACK = 40;
const HOLD_SPEED = 1.5;
/** A missed arrival (already on the next segment) needs this many fixes in a row. */
const MISSED_FIXES = 2;
/** After a gap in the fixes this long, seconds, the distance the estimate moved counts as ridden (the rider went somewhere). */
const GAP_SECONDS = 5;

/** Metres from stop 0 beyond which a rider on the line is taken to have joined part way. */
const JOIN_MIN_FROM_START = 150;
const JOIN_MAX_FROM_LINE = 60;
const END_ARRIVE = 20;
/**
 * How much farther than its radius the rest of the line may take a rider from the stop, for the radius to count as
 * an arrival while the rider is on the line. More than this and the rider is passing the stop on the way in.
 */
const ARRIVE_AHEAD_MARGIN = 15;
const LEAVE_EXTRA = 15;
/** Along-the-line fallback for leaving a stop. Large on purpose: where a route doubles back past its own stop
 *  (Deptford), the approach already lies some way "along" the next segment, so distance from the stop decides. */
const LEAVE_ALONG = 150;
const MISSED_ARRIVAL_LINE = 30;
const WINDOW_BEHIND = 30;
const WINDOW_AHEAD = 400;
/**
 * While riding, the line is searched only as far ahead as the rider could have got since the last fix: REACH_MIN
 * plus REACH_FACTOR times the distance at their speed. Without it a fix with a few metres of GPS error at a hairpin
 * matches the leg coming back, 200 m further along, and the turn at the hairpin is never spoken.
 */
const REACH_MIN = 40;
const REACH_FACTOR = 2;
/** Metres a leg running against the rider's heading counts as further away, when matching a moving rider to the line. */
const AGAINST_LEG = 20;
const BACK_ON_ROUTE = 25;
const DEPART_ALONG = 15;
/** Setting off: a rider this far along the next stretch, this close to it, moving with it for this many fixes, has left the stop. */
const SET_OFF_ALONG = 20;
const SET_OFF_LINE = 15;
const SET_OFF_HEADING = 60;
const SET_OFF_FIXES = 2;
const STANDING_SPEED = 1;
const ASIDE_LATE = 60;
const LATE_CUE = 30;
const UNKNOWN_SPEED = 4;
/** Speed average: time constant and the data needed before it is reported. */
const SPEED_TAU = 20;
const SPEED_MIN_SECONDS = 5;
/** Approach announcements: never further than this, and never closer than this to the cue in front. */
const APPROACH_MAX = 320;
const APPROACH_PREV_GAP = 15;
/** A cue follows another closely enough to be mentioned with it. */
const THEN_WITHIN = 120;
/** Wrong way: seconds of fixes, minimum speed, heading error, metres gone back, seconds to clear, heading error to clear, and the stop radius it is ignored in. */
const WRONG_SECONDS = 10;
const WRONG_MIN_SPEED = 1.5;
const WRONG_HEADING = 135;
const WRONG_BACK = 40;
const WRONG_CLEAR_SECONDS = 5;
const WRONG_CLEAR_HEADING = 60;
const WRONG_STOP_RADIUS = 60;
/** Way back: how far behind the last known position targets are sampled, their spacing, and the penalty factor for behind. */
const TARGET_BEHIND = 50;
const TARGET_STEP = 50;
const BEHIND_PENALTY = 1.5;
/** Metres before a detour turn at which it is announced. */
const DETOUR_TURN_LEAD = 40;
/** Metres from the detour line beyond which the rider has strayed from it, for how many seconds, and the pause between searches. */
const STRAY_DISTANCE = 40;
const STRAY_SECONDS = 6;
const RECOMPUTE_SECONDS = 10;
const NEAREST_SECONDS = 5;
const TURN_PASSED = 3;

interface CueInfo { cue: Cue; along: number; depart: boolean; approached: boolean; done: boolean }
interface AsideInfo { aside: Aside; along: number; done: boolean }
interface ActiveDetour { pts: XY[]; cum: number[]; turns: (WayTurn & { said: boolean })[] }
interface SegInfo { pts: XY[]; cum: number[]; len: number; cues: CueInfo[]; asides: AsideInfo[]; aheadFar: number[] }

function initialState(): NavState {
  return {
    status: "locating", fix: null, snapped: null, seg: 0, alongSeg: 0, toStop: 0, distanceDone: 0, distanceLeft: 0,
    routeBearing: null, offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [],
    thenCue: null, toThen: null, speedAvg: null, wrongWay: false, pos: null, posAccuracy: null, shown: null, shownHeading: null,
  };
}

export function createNavEngine(pack: Pack, opts: Partial<NavOptions> = {}, tuning: Partial<FilterTuning> = {}): NavEngine {
  const o: NavOptions = { ...DEFAULT_NAV_OPTIONS, ...opts };
  const proj = makeProjection(pack.stops[0]!.at);
  const stopPts: XY[] = pack.stops.map((st) => project(proj, st.at));
  const lastStop = pack.stops.length - 1;

  const segs: SegInfo[] = pack.segments.map((line, i) => {
    const pts = line.map((p) => project(proj, p));
    const cum = cumulative(pts);
    const cues: CueInfo[] = pack.cues
      .filter((c) => c.seg === i)
      .map((cue) => ({ cue, along: cum[Math.min(cue.i, cum.length - 1)] ?? 0, depart: cue.turn === "depart", approached: false, done: false }))
      .sort((a, b) => a.along - b.along);
    const asides: AsideInfo[] = pack.asides
      .filter((a) => a.seg === i)
      .map((aside) => ({ aside, along: nearestOnPolyline(pts, project(proj, aside.at), cum).along, done: false }))
      .sort((a, b) => a.along - b.along);
    // aheadFar[k]: the farthest the line takes the rider from the stop it leads to, from vertex k to its end
    const aheadFar: number[] = new Array<number>(pts.length).fill(0);
    const to = stopPts[i];
    for (let k = pts.length - 1, far = 0; k >= 0 && to; k--) { far = Math.max(far, dist(pts[k]!, to)); aheadFar[k] = far; }
    return { pts, cum, len: cum.length ? cum[cum.length - 1]! : 0, cues, asides, aheadFar };
  });
  const total = segs.reduce((sum, g) => sum + g.len, 0);
  const before: number[] = [];
  segs.reduce((sum, g, i) => { before[i] = sum; return sum + g.len; }, 0);

  const segAt = (i: number): SegInfo => segs[i]!;
  const stopAt = (i: number): XY => stopPts[i]!;
  const radiusOf = (i: number): number => pack.stops[i]!.arriveRadius;

  let s: NavState = initialState();
  /** Next riding fix searches the whole segment (after a jump). */
  let needFull = false;
  /** Index of the stop the rider is waiting at while status is at_stop. */
  let atStop = -1;
  /** The stop the rider chose to start at (`startAt`), or -1: then no joining part way, the ride goes to that stop. */
  let chosenStart = -1;
  /** Metres of the route before the chosen start, taken off the distances done and left. */
  let origin = 0;
  /** The corridor graph, once given. Null means no way back is looked for. */
  let index: GraphIndex | null = null;
  let active: ActiveDetour | null = null;
  /** When the way back was last computed (fix time), null before the first search of an off-route spell. */
  let lastCompute: number | null = null;
  let strayingSince: number | null = null;
  let notFoundSaid = false;
  let nearestAt: number | null = null;
  /** The position filter every decision reads through (src/nav/filter.ts). */
  const filter = createPositionFilter(o.maxAccuracy, tuning);
  /** The error of this fix's filtered position, for every threshold. */
  let errNow = ERR_MIN;
  /** The spell of being beyond the off route threshold, before off route fires. */
  let spell: { since: number; along0: number; ridden: number; clear: number } | null = null;
  let backFixes = 0;
  let snapBacks = 0;
  let onLineFixes = 0;
  /** This fix as the device gave it lies on the route line, near where the rider is along it: evidence against off route. */
  let rawOnLine = false;
  let rawOnLineRun = 0;
  /** The drawn marker, local metres, and where it is along the line when it is drawn on it. */
  let shownXY: XY | null = null;
  let shownAlong: { seg: number; along: number } | null = null;
  let missed = 0;
  /** Metres ridden in the current wrong way spell. */
  let wrongRidden = 0;
  /** The filtered position at the previous fix, and how far it has moved since. */
  let lastPos: XY | null = null;
  let movedNow = 0;
  /** Motion between usable fixes: the time of the previous one, the first one, and what this one says about speed and heading. */
  let prevFix: { time: number } | null = null;
  /** Seconds since the fix before this one (0 for the first). */
  let fixGap = 0;
  let firstTime: number | null = null;
  let avg: number | null = null;
  let curSpeed: number | null = null;
  let curHeading: number | null = null;
  /** Wrong way: when the current spell of heading against the line began, and where along the segment. */
  let wrongSince: number | null = null;
  let wrongFrom = 0;
  let rightSince: number | null = null;
  /** Consecutive fixes at a stop that look like riding away along the next stretch. */
  let settingOff = 0;
  /** The stop the rider has come to rest at. Only a rider who stopped can set off; one rolling through leaves by the radius. */
  let stoodAt = -1;

  function clearWrongWay(): void {
    s.wrongWay = false;
    wrongSince = null;
    rightSince = null;
    wrongRidden = 0;
  }

  /** Update the speed average and this fix's speed and heading, from the filter. Called once per usable fix. */
  function trackMotion(fix: Fix, f: Filtered): void {
    const prev = prevFix;
    const dt = prev ? (fix.time - prev.time) / 1000 : 0;
    fixGap = dt;
    curSpeed = f.speed;
    curHeading = f.heading;
    if (firstTime === null) firstTime = fix.time;
    if (avg === null || dt <= 0) avg = avg ?? curSpeed;
    else avg += (curSpeed - avg) * (1 - Math.exp(-dt / SPEED_TAU));
    s.speedAvg = fix.time - firstTime >= SPEED_MIN_SECONDS * 1000 ? avg : null;
    prevFix = { time: fix.time };
  }

  /** The off route threshold for this fix: wider when the position is less certain, within reason. */
  const offThreshold = (): number => o.offRouteDistance + Math.min(errNow, ERR_THRESHOLD_CAP);

  /** Metres ridden since the last fix: speed times time, or after a gap in the fixes the distance the estimate moved. */
  const riddenNow = (): number => (fixGap >= GAP_SECONDS ? Math.max(movedNow, (curSpeed ?? 0) * Math.min(fixGap, 1)) : Math.max(0, curSpeed ?? 0) * fixGap);

  /** Count a fix towards, or away from, an off route spell; fire off_route when the spell says the rider really left. */
  function offSpell(fix: Fix, n: Nearest, threshold: number, ev: NavEvent[]): void {
    // the device's own fixes back on the route, two in a row, end a spell: the estimate is what strayed
    if (spell && rawOnLineRun >= 2) { spell = null; return; }
    if (n.dist > threshold) {
      if (!spell) spell = { since: fix.time, along0: n.along, ridden: fixGap >= GAP_SECONDS ? movedNow : 0, clear: 0 };
      else spell.ridden += riddenNow();
      spell.clear = 0;
      const age = (fix.time - spell.since) / 1000;
      const away = n.along - spell.along0 < 0.5 * spell.ridden;
      const far = n.dist >= threshold + OFF_FAR;
      const long = age >= OFF_LONG_SECONDS && spell.ridden >= OFF_LONG_RIDDEN;
      if (age >= o.offRouteDelay && spell.ridden >= OFF_RIDDEN && (away || far || long) && !rawOnLine) {
        s.offRoute = true;
        spell = null;
        backFixes = 0;
        clearWrongWay();
        ev.push({ type: "off_route" });
      }
    } else if (spell && n.dist <= threshold - OFF_CLEAR) {
      if (++spell.clear >= 2) spell = null;
    }
  }

  /** Notice a rider following the line backwards. Only called while riding on the line. */
  function wrongWayStep(fix: Fix, p: XY, ev: NavEvent[]): void {
    const bear = s.routeBearing;
    const diff = curHeading !== null && bear !== null ? Math.abs(angleDiff(bear, curHeading)) : null;
    if (s.wrongWay) {
      if (diff !== null && diff < WRONG_CLEAR_HEADING) {
        rightSince ??= fix.time;
        if (fix.time - rightSince >= WRONG_CLEAR_SECONDS * 1000) clearWrongWay();
      } else rightSince = null;
      return;
    }
    const nearStop = pack.stops.some((_, i) => dist(p, stopAt(i)) <= WRONG_STOP_RADIUS);
    const bad = !nearStop && diff !== null && diff > WRONG_HEADING && curSpeed !== null && curSpeed > WRONG_MIN_SPEED;
    if (!bad) { wrongSince = null; wrongRidden = 0; return; }
    if (wrongSince === null) { wrongSince = fix.time; wrongFrom = s.alongSeg; wrongRidden = 0; }
    else wrongRidden += (curSpeed ?? 0) * fixGap;
    // gone back along the line, and really ridden that far: a GPS that jumps back and forth goes nowhere
    if (fix.time - wrongSince >= WRONG_SECONDS * 1000 && wrongFrom - s.alongSeg >= WRONG_BACK && wrongRidden >= WRONG_BACK) {
      s.wrongWay = true;
      wrongSince = null;
      rightSince = null;
      ev.push({ type: "wrong_way" });
    }
  }

  function clearDetour(): void {
    active = null;
    s.detour = null;
    lastCompute = null;
    strayingSince = null;
    notFoundSaid = false;
  }

  function resetFlags(): void {
    for (const g of segs) {
      for (const c of g.cues) { c.approached = false; c.done = false; }
      for (const a of g.asides) a.done = false;
    }
  }

  /** Mark cues and asides at or behind `along` on a segment as passed, without events. */
  function markBehind(seg: number, along: number): void {
    const g = segAt(seg);
    for (const c of g.cues) {
      if (c.depart ? along >= DEPART_ALONG : c.along <= along) { c.done = true; c.approached = true; }
    }
    for (const a of g.asides) if (a.along <= along) a.done = true;
  }

  function addArrived(stop: number): void {
    if (!s.arrived.includes(stop)) { s.arrived.push(stop); s.arrived.sort((a, b) => a - b); }
  }

  function arriveAt(stop: number, ev: NavEvent[]): void {
    ev.push({ type: "arrive", stop });
    addArrived(stop);
  }

  function derive(): void {
    if (s.status === "finished") {
      s.toStop = 0; s.distanceDone = total - origin; s.distanceLeft = 0; s.nextCue = null; s.toCue = null; s.thenCue = null; s.toThen = null;
      return;
    }
    if (s.status === "locating" || s.status === "idle") return;
    if (s.status === "to_start") {
      s.distanceDone = 0; s.distanceLeft = total - origin; s.nextCue = null; s.toCue = null; s.currentCue = null; s.routeBearing = null; s.thenCue = null; s.toThen = null;
      return;
    }
    const g = segAt(s.seg);
    const along = Math.min(g.len, Math.max(0, s.alongSeg));
    s.distanceDone = Math.max(0, before[s.seg]! + along - origin);
    s.distanceLeft = Math.max(0, total - before[s.seg]! - along);
    const pa = pointAlong(g.pts, along, g.cum);
    s.snapped = unproject(proj, pa.point);
    s.routeBearing = pa.bearing;
    s.toStop = s.offRoute && s.fix ? dist(project(proj, [s.fix.lng, s.fix.lat]), stopAt(s.seg)) : Math.max(0, g.len - along);
    let next: CueInfo | null = null;
    let current: CueInfo | null = null;
    for (const c of g.cues) {
      if (c.along <= along) current = c;
      else if (!next) next = c;
    }
    s.nextCue = next ? next.cue : null;
    s.toCue = next ? next.along - along : null;
    const after = next ? g.cues[g.cues.indexOf(next) + 1] : undefined;
    const gap = next && after ? after.along - next.along : Infinity;
    s.thenCue = after && !after.depart && gap <= THEN_WITHIN ? after.cue : null;
    s.toThen = s.thenCue ? gap : null;
    s.currentCue = current ? current.cue : null;
  }

  function processCues(ev: NavEvent[], departNow: boolean): void {
    const g = segAt(s.seg);
    const along = s.alongSeg;
    const base = Math.min(APPROACH_MAX, Math.max(o.cueApproachMin, (s.speedAvg ?? UNKNOWN_SPEED) * o.cueApproachSeconds));
    for (let k = 0; k < g.cues.length; k++) {
      const c = g.cues[k]!;
      if (c.done) {
        // A cue already spoken but not yet passed holds back the ones after it.
        if (c.along > along) break;
        continue;
      }
      if (c.depart) {
        if (!departNow && along < DEPART_ALONG) break;
        c.done = true; c.approached = true;
        ev.push({ type: "cue", cue: c.cue, phase: "now" });
        continue;
      }
      const d = c.along - along;
      // Never announce a turn before the one in front of it has been reached; never later than the "now" distance.
      const prev = g.cues[k - 1];
      const approachDist = Math.max(o.cueNowDistance, prev ? Math.min(base, c.along - prev.along - APPROACH_PREV_GAP) : base);
      if (d > approachDist) break;
      if (d <= o.cueNowDistance) {
        c.done = true; c.approached = true;
        if (d >= -LATE_CUE) ev.push({ type: "cue", cue: c.cue, phase: "now" });
        continue;
      }
      if (!c.approached) {
        c.approached = true;
        derive(); // the director reads the distance to the cue from the state
        ev.push({ type: "cue", cue: c.cue, phase: "approach" });
      }
      break;
    }
  }

  function processAsides(ev: NavEvent[]): void {
    const along = s.alongSeg;
    for (const a of segAt(s.seg).asides) {
      if (a.done) continue;
      if (along > a.along + ASIDE_LATE) { a.done = true; continue; }
      if (along >= a.along - o.asideLead) {
        a.done = true;
        ev.push({ type: "aside", aside: a.aside });
      }
    }
  }

  /** Called after the rider reaches stops[s.seg] (by radius, by the end of the line, or by a missed arrival). */
  function finishArrival(ev: NavEvent[]): void {
    const stop = s.seg;
    arriveAt(stop, ev);
    spell = null; backFixes = 0;
    s.offRoute = false;
    clearWrongWay();
    clearDetour();
    s.offBy = 0;
    if (stop === lastStop) {
      s.status = "finished";
      s.alongSeg = segAt(stop).len;
      ev.push({ type: "finished" });
      derive();
      return;
    }
    s.status = "at_stop";
    atStop = stop;
    s.seg = stop + 1;
    s.alongSeg = 0;
    derive();
    s.snapped = unproject(proj, stopAt(stop));
  }

  /** Look for a way back from `p` to the current segment, ahead of the rider by preference. */
  function computeDetour(fix: Fix, p: XY, ev: NavEvent[]): void {
    lastCompute = fix.time;
    strayingSince = null;
    const g = segAt(s.seg);
    const targets: WayTarget[] = [];
    const from = Math.max(0, s.alongSeg - TARGET_BEHIND);
    for (let d = from; d < g.len + TARGET_STEP; d += TARGET_STEP) {
      const at = Math.min(d, g.len);
      targets.push({ at: pointAlong(g.pts, at, g.cum).point, penalty: at < s.alongSeg ? BEHIND_PENALTY * (s.alongSeg - at) : 0 });
      if (at >= g.len) break;
    }
    targets.push({ at: stopAt(s.seg), penalty: 0 });
    const way = index ? findWayBack(index, p, targets) : null;
    if (!way) {
      active = null;
      s.detour = null;
      if (!notFoundSaid) { notFoundSaid = true; ev.push({ type: "detour", found: false }); }
      return;
    }
    notFoundSaid = false;
    const cum = cumulative(way.line);
    active = { pts: way.line, cum, turns: way.turns.map((t) => ({ ...t, said: false })) };
    ev.push({ type: "detour", found: true });
    trackDetour(p, ev);
  }

  /** Trim the detour behind the rider, update its distances and announce the turns that are close. */
  function trackDetour(p: XY, ev: NavEvent[]): void {
    const a = active;
    if (!a) return;
    const n = nearestOnPolyline(a.pts, p, a.cum, 0, a.cum.length ? a.cum[a.cum.length - 1]! : 0);
    const total = a.cum[a.cum.length - 1] ?? 0;
    const rest = a.pts.slice(n.leg + 1);
    const line = [p, ...rest];
    let next: NonNullable<NavState["detour"]>["next"] = null;
    for (const t of a.turns) {
      const ahead = t.along - n.along;
      if (ahead < TURN_PASSED) { t.said = true; continue; }
      if (!t.said && ahead <= DETOUR_TURN_LEAD) { t.said = true; ev.push({ type: "detour_turn", turn: t.turn, name: t.name }); }
      if (!next) next = { turn: t.turn, name: t.name, at: unproject(proj, t.at), dist: ahead };
    }
    s.detour = { line: line.map((q) => unproject(proj, q)), toRejoin: Math.max(0, total - n.along), next };
    // Strayed from the way back: look again, but not too often.
    if (n.dist > STRAY_DISTANCE) strayingSince ??= s.fix?.time ?? 0;
    else strayingSince = null;
  }

  /** Off route: find, follow and renew the way back. Does nothing without a graph. */
  function detourStep(fix: Fix, p: XY, ev: NavEvent[]): void {
    if (!index) return;
    const due = lastCompute === null || fix.time - lastCompute >= RECOMPUTE_SECONDS * 1000;
    if (!active) {
      if (due) computeDetour(fix, p, ev);
      return;
    }
    trackDetour(p, ev);
    if (strayingSince !== null && fix.time - strayingSince >= STRAY_SECONDS * 1000 && due) computeDetour(fix, p, ev);
  }

  /** The rider's heading when they are moving fast enough for it to mean something. */
  const movingHeading = (): number | null => (curHeading !== null && curSpeed !== null && curSpeed > WRONG_MIN_SPEED ? curHeading : null);
  /** How far ahead along the line the rider can be at this fix. */
  const reach = (): number => Math.min(WINDOW_AHEAD, REACH_MIN + REACH_FACTOR * Math.max(curSpeed ?? 0, s.speedAvg ?? 0, UNKNOWN_SPEED) * Math.max(1, fixGap));

  function riding(fix: Fix, p: XY, ev: NavEvent[], departNow: boolean): void {
    const g = segAt(s.seg);
    const full = needFull || s.offRoute;
    const n = full
      ? nearestOnPolyline(g.pts, p, g.cum)
      : nearestOnPolyline(g.pts, p, g.cum, s.alongSeg - WINDOW_BEHIND, s.alongSeg + reach(), movingHeading(), AGAINST_LEG);
    const threshold = offThreshold();
    s.offBy = n.dist;

    // Arrival by distance to the stop, or by reaching the end of the line while on it. A rider on the line whose rest
    // of it leads well away from the stop first (a path that runs past it before a spur turns back to it) is passing
    // on the way in, not arriving: there the radius counts only once the rider has left the line.
    const ahead = g.aheadFar[Math.min(n.leg + 1, g.aheadFar.length - 1)] ?? 0;
    const nearStop = dist(p, stopAt(s.seg)) <= radiusOf(s.seg) && (ahead <= radiusOf(s.seg) + ARRIVE_AHEAD_MARGIN || n.dist > threshold);
    const atEnd = g.len - n.along <= END_ARRIVE && n.dist <= threshold;
    if (nearStop || atEnd) {
      s.alongSeg = n.along;
      // Anything the rider is still due to hear on the last stretch goes out before the arrival.
      processCues(ev, departNow);
      processAsides(ev);
      s.alongSeg = g.len;
      finishArrival(ev);
      return;
    }

    // Missed arrival: off the line but already on the next one, two fixes in a row.
    let onNext: Nearest | null = null;
    if (n.dist > threshold && s.seg < lastStop) {
      const next = segAt(s.seg + 1);
      const nx = nearestOnPolyline(next.pts, p, next.cum);
      if (nx.dist <= MISSED_ARRIVAL_LINE) onNext = nx;
    }
    missed = onNext ? missed + 1 : 0;
    if (onNext && missed >= MISSED_FIXES) {
      const nx = onNext;
      missed = 0;
      arriveAt(s.seg, ev);
      clearWrongWay();
      s.seg += 1;
      s.alongSeg = nx.along;
      s.offRoute = false;
      clearDetour();
      spell = null;
      needFull = false;
      markBehind(s.seg, nx.along);
      s.offBy = nx.dist;
      derive();
      return;
    }

    // The position along the line advances no faster than the rider can ride: an estimate off to one side at a bend
    // must not throw it forward to the next turn. (Not after a jump or off route: then the whole line is searched.)
    const maxAdvance = Math.max(curSpeed ?? 0, 1) * Math.max(fixGap, 1) * ALONG_RATE + ALONG_SLACK;
    s.alongSeg = !full && n.along > s.alongSeg + maxAdvance ? s.alongSeg + maxAdvance : n.along;
    if (needFull) {
      needFull = false;
      markBehind(s.seg, n.along);
    }

    if (!s.offRoute) {
      offSpell(fix, n, threshold, ev);
    } else if (n.dist <= BACK_ON_ROUTE) {
      if (++backFixes >= BACK_FIXES) {
        s.offRoute = false;
        backFixes = 0;
        spell = null;
        markBehind(s.seg, n.along);
        clearDetour();
        ev.push({ type: "back_on_route" });
      }
    } else backFixes = 0;

    if (s.offRoute) detourStep(fix, p, ev);
    if (!s.offRoute) {
      if (n.dist > threshold) wrongSince = null;
      else {
        derive();
        wrongWayStep(fix, p, ev);
      }
      processCues(ev, departNow);
      processAsides(ev);
    }
    derive();
  }

  function toStart(fix: Fix, p: XY, ev: NavEvent[]): void {
    const goal = s.seg;
    const d0 = dist(p, stopAt(goal));
    if (d0 <= radiusOf(goal)) {
      arriveAt(goal, ev);
      s.status = "at_stop";
      atStop = goal;
      s.seg = goal + 1;
      s.alongSeg = 0;
      s.toStop = segs[goal + 1]?.len ?? 0;
      derive();
      s.snapped = unproject(proj, stopAt(goal));
      return;
    }
    if (chosenStart < 0 && d0 > JOIN_MIN_FROM_START) {
      let best: { seg: number; along: number; dist: number } | null = null;
      for (let k = 1; k < segs.length; k++) {
        const n = nearestOnPolyline(segAt(k).pts, p, segAt(k).cum);
        if (n.dist <= JOIN_MAX_FROM_LINE && (!best || n.dist < best.dist)) best = { seg: k, along: n.along, dist: n.dist };
      }
      // A rider standing at a stop is adopted onto the segment that ends there, so that stop is announced.
      for (let j = 1; j < segs.length; j++) {
        if (dist(p, stopAt(j)) <= radiusOf(j)) {
          const n = nearestOnPolyline(segAt(j).pts, p, segAt(j).cum);
          best = { seg: j, along: n.along, dist: n.dist };
          break;
        }
      }
      if (best) {
        s.nearest = null;
        s.status = "riding";
        s.seg = best.seg;
        s.alongSeg = best.along;
        s.arrived = Array.from({ length: best.seg }, (_, i) => i);
        markBehind(best.seg, best.along);
        needFull = false;
        spell = null; backFixes = 0;
        riding(fix, p, ev, false);
        return;
      }
    }
    s.toStop = d0;
    s.offBy = 0;
    s.offRoute = false;
    if (chosenStart >= 0) s.nearest = null;
    else if (nearestAt === null || fix.time - nearestAt >= NEAREST_SECONDS * 1000 || !s.nearest) {
      nearestAt = fix.time;
      let near: NavState["nearest"] = null;
      for (let k = 1; k < segs.length; k++) {
        const n = nearestOnPolyline(segAt(k).pts, p, segAt(k).cum);
        if (!near || n.dist < near.dist) near = { at: unproject(proj, n.point), seg: k, dist: n.dist };
      }
      s.nearest = near;
    }
    derive();
  }

  function atStopStep(fix: Fix, p: XY, ev: NavEvent[]): void {
    const g = segAt(s.seg);
    const n = nearestOnPolyline(g.pts, p, g.cum, s.alongSeg - WINDOW_BEHIND, s.alongSeg + WINDOW_AHEAD);
    const radius = radiusOf(atStop);
    // A first turn 60 m from a stop is passed before the leave radius is reached, so a rider who stopped and is now
    // plainly riding away along the line has left already. The heading test keeps a rider standing where the line
    // doubles back at the stop; having stood still keeps one who is still arriving where the line overshoots it.
    if (curSpeed !== null && curSpeed < STANDING_SPEED) stoodAt = atStop;
    const lineBearing = pointAlong(g.pts, Math.min(g.len, Math.max(0, n.along)), g.cum).bearing;
    const goingWithIt = curHeading !== null && curSpeed !== null && curSpeed > WRONG_MIN_SPEED
      && Math.abs(angleDiff(lineBearing, curHeading)) < SET_OFF_HEADING;
    settingOff = stoodAt === atStop && goingWithIt && n.along > SET_OFF_ALONG && n.dist < SET_OFF_LINE ? settingOff + 1 : 0;
    if (dist(p, stopAt(atStop)) > radius + LEAVE_EXTRA || n.along > LEAVE_ALONG || settingOff >= SET_OFF_FIXES) {
      settingOff = 0;
      ev.push({ type: "leave", stop: atStop });
      s.status = "riding";
      atStop = -1;
      riding(fix, p, ev, true);
      return;
    }
    s.alongSeg = n.along;
    s.offBy = n.dist;
    derive();
  }

  /**
   * Where a refused fix lies against the line, while the estimate itself has strayed off it: "here" on the line where
   * the dead reckoning has the rider (the multipath is over), "elsewhere" on the line but further along (the track may
   * be wrong), or "off". While the estimate is on the line too, a refused fix on the line is "off": in a street of tall
   * buildings multipath often lands along the street itself, and the estimate the device's velocity steers is the
   * better guess. The filter's own re-acquire settles a conflict that lasts.
   */
  function onLineWhereExpected(raw: XY, f: Filtered, fix: Fix): "here" | "elsewhere" | "off" {
    if ((s.status !== "riding" && s.status !== "at_stop") || s.offRoute) return "off";
    const g = segAt(s.seg);
    if (nearestOnPolyline(g.pts, f.p, g.cum, s.alongSeg - 200, s.alongSeg + 200).dist <= EST_ON_LINE) return "off";
    const gap = prevFix ? Math.max(0, (fix.time - prevFix.time) / 1000) : 1;
    const ahead = s.alongSeg + f.speed * gap;
    const window = SNAP_BACK_ALONG + f.speed * gap;
    const near = nearestOnPolyline(g.pts, raw, g.cum, ahead - window, ahead + window);
    if (near.dist <= SNAP_BACK_LINE && Math.abs(near.along - ahead) <= window) return "here";
    const wide = nearestOnPolyline(g.pts, raw, g.cum, s.alongSeg - 200, s.alongSeg + 200);
    return wide.dist <= SNAP_BACK_LINE ? "elsewhere" : "off";
  }

  /** The device's own fix lies on the line of this segment, within 200 m along of where the rider is. */
  function rawNearLine(raw: XY): boolean {
    if (s.status !== "riding" || s.offRoute) return false;
    const g = segAt(s.seg);
    return nearestOnPolyline(g.pts, raw, g.cum, s.alongSeg - 200, s.alongSeg + 200).dist <= SNAP_BACK_LINE;
  }

  /** Where the map draws the rider, and which way the arrow points. */
  function updateShown(f: Filtered): void {
    const p = f.p;
    let target: XY;
    if ((s.status === "riding" || s.status === "at_stop") && !s.offRoute && s.snapped) {
      const full = SNAP_FULL + Math.min(errNow, SNAP_FULL);
      const w = s.offBy <= full ? 1 : s.offBy >= full + SNAP_BLEND ? 0 : 1 - (s.offBy - full) / SNAP_BLEND;
      const q = project(proj, s.snapped);
      target = [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w];
      s.shownHeading = w >= 0.5 ? s.routeBearing : f.heading;
      const onLine = w >= 0.5 && s.status === "riding";
      const back = onLine && shownAlong && shownAlong.seg === s.seg ? shownAlong.along - s.alongSeg : 0;
      // riding forward: the bearing agrees with the line where the marker is, or where the estimate now projects (in a
      // dogleg the two differ; a rider who turns back disagrees with both)
      const held = back > 0 && shownAlong ? pointAlong(segAt(s.seg).pts, shownAlong.along, segAt(s.seg).cum).bearing : null;
      const agrees = (b: number | null): boolean => b !== null && f.heading !== null && Math.abs(angleDiff(f.heading, b)) < 90;
      const forward = f.speed >= HOLD_SPEED && (agrees(held) || agrees(s.routeBearing));
      if (shownXY && back > 0 && back <= HOLD_BACK && forward) target = shownXY;
      else shownAlong = onLine ? { seg: s.seg, along: s.alongSeg } : null;
    } else if (s.status === "finished") {
      target = s.snapped ? project(proj, s.snapped) : p;
      s.shownHeading = null;
      shownAlong = null;
    } else {
      target = p;
      s.shownHeading = f.heading;
      shownAlong = null;
    }
    // no leaps: the marker moves no faster than the rider plus a little; a reset or a recovery glides in over a few fixes
    if (shownXY) {
      const max = f.speed * Math.max(fixGap, 0) + SHOWN_SLACK;
      const d = dist(shownXY, target);
      shownXY = d <= max ? target : [shownXY[0] + ((target[0] - shownXY[0]) * max) / d, shownXY[1] + ((target[1] - shownXY[1]) * max) / d];
    } else shownXY = target;
    s.shown = unproject(proj, shownXY);
  }

  function update(fix: Fix): NavEvent[] {
    const ev: NavEvent[] = [];
    s.fix = fix;
    if (s.status === "finished" || fix.accuracy > o.maxAccuracy) return ev;
    const raw = project(proj, [fix.lng, fix.lat]);
    let f = filter.push(raw, fix);
    // a duplicate, an old fix or a late one says nothing about now
    if (f.why === "stale" || f.why === "late" || f.why === "poor") return ev;
    const where = f.why === "jump" ? onLineWhereExpected(raw, f, fix) : "off";
    rawOnLine = rawNearLine(raw);
    rawOnLineRun = rawOnLine ? rawOnLineRun + 1 : 0;
    snapBacks = where === "here" ? snapBacks + 1 : 0;
    onLineFixes = where !== "off" ? onLineFixes + 1 : 0;
    if (snapBacks >= SNAP_BACK_FIXES || onLineFixes >= ONLINE_FIXES) { f = filter.resetTo(raw, fix); snapBacks = 0; onLineFixes = 0; }
    // a refused jump still moves the estimate on by dead reckoning: every decision reads the estimate
    const p = f.p;
    movedNow = lastPos ? dist(lastPos, p) : 0;
    lastPos = p;
    s.pos = unproject(proj, p);
    s.posAccuracy = f.sigma;
    errNow = Math.max(f.sigma, Math.min(fix.accuracy, ERR_ACC_CAP), ERR_MIN);
    trackMotion(fix, f);
    if (s.status === "locating" || s.status === "idle") s.status = "to_start";
    if (s.status === "to_start" && s.seg === Math.max(0, chosenStart)) toStart(fix, p, ev);
    else if (s.status === "to_start") { s.nearest = null; s.status = "riding"; riding(fix, p, ev, false); }
    else if (s.status === "at_stop") atStopStep(fix, p, ev);
    else riding(fix, p, ev, false);
    updateShown(f);
    return ev;
  }

  function jumpToSegment(seg: number): void {
    const target = Math.max(0, Math.min(lastStop, Math.floor(seg)));
    filter.reset();
    shownXY = null;
    shownAlong = null;
    chosenStart = -1;
    origin = 0;
    resetFlags();
    for (let i = 0; i < target; i++) markBehind(i, Infinity);
    s.seg = target;
    s.alongSeg = 0;
    s.arrived = Array.from({ length: target }, (_, i) => i);
    s.offRoute = false;
    clearDetour();
    s.nearest = null;
    nearestAt = null;
    s.offBy = 0;
    spell = null; backFixes = 0; rawOnLine = false; rawOnLineRun = 0;
    atStop = -1;
    needFull = target > 0;
    s.status = target === 0 ? "to_start" : "riding";
    clearWrongWay();
    derive();
  }

  function startAt(stop: number): void {
    const k = Math.max(0, Math.min(lastStop - 1, Math.floor(stop)));
    filter.reset();
    shownXY = null;
    shownAlong = null;
    resetFlags();
    // the stops before it, and the stretch leading to it, are behind: no cue or aside there ever fires
    for (let i = 0; i <= k; i++) markBehind(i, Infinity);
    chosenStart = k;
    origin = k > 0 ? before[k + 1] ?? 0 : 0;
    s.seg = k;
    s.alongSeg = 0;
    s.arrived = [];
    s.offRoute = false;
    clearDetour();
    s.nearest = null;
    nearestAt = null;
    s.offBy = 0;
    spell = null; backFixes = 0; rawOnLine = false; rawOnLineRun = 0;
    atStop = -1;
    needFull = false;
    s.status = "to_start";
    clearWrongWay();
    derive();
  }

  function setGraph(graph: RouteGraph | null): void {
    index = graph && graph.nodes.length > 0 ? buildIndex(graph, (q) => project(proj, q)) : null;
    clearDetour();
  }

  function reset(): void {
    s = initialState();
    filter.reset(); errNow = ERR_MIN; snapBacks = 0; onLineFixes = 0; missed = 0; wrongRidden = 0; lastPos = null; movedNow = 0; shownXY = null; shownAlong = null;
    rawOnLine = false; rawOnLineRun = 0;
    prevFix = null; fixGap = 0; firstTime = null; avg = null; curSpeed = null; curHeading = null;
    wrongSince = null; rightSince = null;
    active = null;
    lastCompute = null;
    strayingSince = null;
    notFoundSaid = false;
    nearestAt = null;
    resetFlags();
    spell = null; backFixes = 0;
    needFull = false;
    atStop = -1;
    chosenStart = -1;
    origin = 0;
  }

  return {
    update,
    get state() { return s; },
    jumpToSegment,
    startAt,
    setGraph,
    reset,
  };
}
