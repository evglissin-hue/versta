import { angleDiff, bearing, cumulative, dist, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type XY } from "../geo";
import type { Aside, Cue, Fix, NavEngine, NavEvent, NavOptions, NavState, Pack, RouteGraph } from "../types";
import { buildIndex, findWayBack, type GraphIndex, type WayTarget, type WayTurn } from "./reroute";

export const DEFAULT_NAV_OPTIONS: NavOptions = {
  maxAccuracy: 80, offRouteDistance: 45, offRouteDelay: 8, cueNowDistance: 15, cueApproachSeconds: 15, cueApproachMin: 70, asideLead: 40,
};

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
const MOVED_MIN = 2;
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
    thenCue: null, toThen: null, speedAvg: null, wrongWay: false,
  };
}

export function createNavEngine(pack: Pack, opts: Partial<NavOptions> = {}): NavEngine {
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
  let offSince: number | null = null;
  /** Next riding fix searches the whole segment (after a jump). */
  let needFull = false;
  /** Index of the stop the rider is waiting at while status is at_stop. */
  let atStop = -1;
  /** The corridor graph, once given. Null means no way back is looked for. */
  let index: GraphIndex | null = null;
  let active: ActiveDetour | null = null;
  /** When the way back was last computed (fix time), null before the first search of an off-route spell. */
  let lastCompute: number | null = null;
  let strayingSince: number | null = null;
  let notFoundSaid = false;
  let nearestAt: number | null = null;
  /** Motion between usable fixes: the previous one, the first one, and what this one says about speed and heading. */
  let prevFix: { p: XY; time: number } | null = null;
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
  }

  /** Update the speed average and this fix's speed and heading. Called once per usable fix. */
  function trackMotion(fix: Fix, p: XY): void {
    const prev = prevFix;
    const dt = prev ? (fix.time - prev.time) / 1000 : 0;
    fixGap = dt;
    const moved = prev ? dist(prev.p, p) : 0;
    curSpeed = fix.speed ?? (dt > 0 ? moved / dt : null);
    curHeading = fix.heading ?? (prev && moved >= MOVED_MIN ? bearing(prev.p, p) : null);
    if (firstTime === null) firstTime = fix.time;
    if (curSpeed !== null) {
      if (avg === null || dt <= 0) avg = avg ?? curSpeed;
      else avg += (curSpeed - avg) * (1 - Math.exp(-dt / SPEED_TAU));
    }
    s.speedAvg = avg !== null && fix.time - firstTime >= SPEED_MIN_SECONDS * 1000 ? avg : null;
    prevFix = { p, time: fix.time };
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
    if (!bad) { wrongSince = null; return; }
    if (wrongSince === null) { wrongSince = fix.time; wrongFrom = s.alongSeg; }
    if (fix.time - wrongSince >= WRONG_SECONDS * 1000 && wrongFrom - s.alongSeg >= WRONG_BACK) {
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
      s.toStop = 0; s.distanceDone = total; s.distanceLeft = 0; s.nextCue = null; s.toCue = null; s.thenCue = null; s.toThen = null;
      return;
    }
    if (s.status === "locating" || s.status === "idle") return;
    if (s.status === "to_start") {
      s.distanceDone = 0; s.distanceLeft = total; s.nextCue = null; s.toCue = null; s.currentCue = null; s.routeBearing = null; s.thenCue = null; s.toThen = null;
      return;
    }
    const g = segAt(s.seg);
    const along = Math.min(g.len, Math.max(0, s.alongSeg));
    s.distanceDone = before[s.seg]! + along;
    s.distanceLeft = Math.max(0, total - s.distanceDone);
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
    offSince = null;
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
    const threshold = o.offRouteDistance + Math.min(fix.accuracy, 30);
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

    // Missed arrival: off the line but already on the next one.
    if (n.dist > threshold && s.seg < lastStop) {
      const next = segAt(s.seg + 1);
      const nx = nearestOnPolyline(next.pts, p, next.cum);
      if (nx.dist <= MISSED_ARRIVAL_LINE) {
        arriveAt(s.seg, ev);
        clearWrongWay();
        s.seg += 1;
        s.alongSeg = nx.along;
        s.offRoute = false;
        clearDetour();
        offSince = null;
        needFull = false;
        markBehind(s.seg, nx.along);
        s.offBy = nx.dist;
        derive();
        return;
      }
    }

    s.alongSeg = n.along;
    if (needFull) {
      needFull = false;
      markBehind(s.seg, n.along);
    }

    if (!s.offRoute) {
      if (n.dist > threshold) {
        if (offSince === null) offSince = fix.time;
        if (fix.time - offSince >= o.offRouteDelay * 1000) {
          s.offRoute = true;
          clearWrongWay();
          ev.push({ type: "off_route" });
        }
      } else {
        offSince = null;
      }
    } else if (n.dist <= BACK_ON_ROUTE) {
      s.offRoute = false;
      offSince = null;
      markBehind(s.seg, n.along);
      clearDetour();
      ev.push({ type: "back_on_route" });
    }

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
    const d0 = dist(p, stopAt(0));
    if (d0 <= radiusOf(0)) {
      arriveAt(0, ev);
      s.status = "at_stop";
      atStop = 0;
      s.seg = 1;
      s.alongSeg = 0;
      s.toStop = segs[1]?.len ?? 0;
      derive();
      s.snapped = unproject(proj, stopAt(0));
      return;
    }
    if (d0 > JOIN_MIN_FROM_START) {
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
        offSince = null;
        riding(fix, p, ev, false);
        return;
      }
    }
    s.toStop = d0;
    s.offBy = 0;
    s.offRoute = false;
    if (nearestAt === null || fix.time - nearestAt >= NEAREST_SECONDS * 1000 || !s.nearest) {
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

  function update(fix: Fix): NavEvent[] {
    const ev: NavEvent[] = [];
    s.fix = fix;
    if (s.status === "finished" || fix.accuracy > o.maxAccuracy) return ev;
    const p = project(proj, [fix.lng, fix.lat]);
    trackMotion(fix, p);
    if (s.status === "locating" || s.status === "idle") s.status = "to_start";
    if (s.status === "to_start" && s.seg === 0) toStart(fix, p, ev);
    else if (s.status === "to_start") { s.nearest = null; s.status = "riding"; riding(fix, p, ev, false); }
    else if (s.status === "at_stop") atStopStep(fix, p, ev);
    else riding(fix, p, ev, false);
    return ev;
  }

  function jumpToSegment(seg: number): void {
    const target = Math.max(0, Math.min(lastStop, Math.floor(seg)));
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
    offSince = null;
    atStop = -1;
    needFull = target > 0;
    s.status = target === 0 ? "to_start" : "riding";
    clearWrongWay();
    derive();
  }

  function setGraph(graph: RouteGraph | null): void {
    index = graph && graph.nodes.length > 0 ? buildIndex(graph, (q) => project(proj, q)) : null;
    clearDetour();
  }

  function reset(): void {
    s = initialState();
    prevFix = null; fixGap = 0; firstTime = null; avg = null; curSpeed = null; curHeading = null;
    wrongSince = null; rightSince = null;
    active = null;
    lastCompute = null;
    strayingSince = null;
    notFoundSaid = false;
    nearestAt = null;
    resetFlags();
    offSince = null;
    needFull = false;
    atStop = -1;
  }

  return {
    update,
    get state() { return s; },
    jumpToSegment,
    setGraph,
    reset,
  };
}
