import { cumulative, dist, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type XY } from "../geo";
import type { Aside, Cue, Fix, NavEngine, NavEvent, NavOptions, NavState, Pack } from "../types";

export const DEFAULT_NAV_OPTIONS: NavOptions = {
  maxAccuracy: 80, offRouteDistance: 45, offRouteDelay: 8, cueNowDistance: 15, cueApproachSeconds: 12, cueApproachMin: 60, asideLead: 40,
};

/** Metres from stop 0 beyond which a rider on the line is taken to have joined part way. */
const JOIN_MIN_FROM_START = 150;
const JOIN_MAX_FROM_LINE = 60;
const END_ARRIVE = 20;
const LEAVE_EXTRA = 15;
/** Along-the-line fallback for leaving a stop. Large on purpose: where a route doubles back past its own stop
 *  (Deptford), the approach already lies some way "along" the next segment, so distance from the stop decides. */
const LEAVE_ALONG = 150;
const MISSED_ARRIVAL_LINE = 30;
const WINDOW_BEHIND = 30;
const WINDOW_AHEAD = 400;
const BACK_ON_ROUTE = 25;
const DEPART_ALONG = 15;
const ASIDE_LATE = 60;
const LATE_CUE = 30;
const UNKNOWN_SPEED = 4;

interface CueInfo { cue: Cue; along: number; depart: boolean; approached: boolean; done: boolean }
interface AsideInfo { aside: Aside; along: number; done: boolean }
interface SegInfo { pts: XY[]; cum: number[]; len: number; cues: CueInfo[]; asides: AsideInfo[] }

function initialState(): NavState {
  return {
    status: "locating", fix: null, snapped: null, seg: 0, alongSeg: 0, toStop: 0, distanceDone: 0, distanceLeft: 0,
    routeBearing: null, offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [],
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
    return { pts, cum, len: cum.length ? cum[cum.length - 1]! : 0, cues, asides };
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
      s.toStop = 0; s.distanceDone = total; s.distanceLeft = 0; s.nextCue = null; s.toCue = null;
      return;
    }
    if (s.status === "locating" || s.status === "idle") return;
    if (s.status === "to_start") {
      s.distanceDone = 0; s.distanceLeft = total; s.nextCue = null; s.toCue = null; s.currentCue = null; s.routeBearing = null;
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
    s.currentCue = current ? current.cue : null;
  }

  function processCues(fix: Fix, ev: NavEvent[], departNow: boolean): void {
    const g = segAt(s.seg);
    const along = s.alongSeg;
    const approachDist = Math.max(o.cueApproachMin, (fix.speed ?? UNKNOWN_SPEED) * o.cueApproachSeconds);
    for (const c of g.cues) {
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
      if (d > approachDist) break;
      if (d <= o.cueNowDistance) {
        c.done = true; c.approached = true;
        if (d >= -LATE_CUE) ev.push({ type: "cue", cue: c.cue, phase: "now" });
        continue;
      }
      if (!c.approached) {
        c.approached = true;
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

  function riding(fix: Fix, p: XY, ev: NavEvent[], departNow: boolean): void {
    const g = segAt(s.seg);
    const full = needFull || s.offRoute;
    const n = full
      ? nearestOnPolyline(g.pts, p, g.cum)
      : nearestOnPolyline(g.pts, p, g.cum, s.alongSeg - WINDOW_BEHIND, s.alongSeg + WINDOW_AHEAD);
    const threshold = o.offRouteDistance + Math.min(fix.accuracy, 30);
    s.offBy = n.dist;

    // Arrival by distance to the stop, or by reaching the end of the line while on it.
    const nearStop = dist(p, stopAt(s.seg)) <= radiusOf(s.seg);
    const atEnd = g.len - n.along <= END_ARRIVE && n.dist <= threshold;
    if (nearStop || atEnd) {
      s.alongSeg = n.along;
      // Anything the rider is still due to hear on the last stretch goes out before the arrival.
      processCues(fix, ev, departNow);
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
        s.seg += 1;
        s.alongSeg = nx.along;
        s.offRoute = false;
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
          ev.push({ type: "off_route" });
        }
      } else {
        offSince = null;
      }
    } else if (n.dist <= BACK_ON_ROUTE) {
      s.offRoute = false;
      offSince = null;
      markBehind(s.seg, n.along);
      ev.push({ type: "back_on_route" });
    }

    if (!s.offRoute) {
      processCues(fix, ev, departNow);
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
    derive();
  }

  function atStopStep(fix: Fix, p: XY, ev: NavEvent[]): void {
    const g = segAt(s.seg);
    const n = nearestOnPolyline(g.pts, p, g.cum, s.alongSeg - WINDOW_BEHIND, s.alongSeg + WINDOW_AHEAD);
    const radius = radiusOf(atStop);
    if (dist(p, stopAt(atStop)) > radius + LEAVE_EXTRA || n.along > LEAVE_ALONG) {
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
    if (s.status === "locating" || s.status === "idle") s.status = "to_start";
    if (s.status === "to_start" && s.seg === 0) toStart(fix, p, ev);
    else if (s.status === "to_start") { s.status = "riding"; riding(fix, p, ev, false); }
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
    s.offBy = 0;
    offSince = null;
    atStop = -1;
    needFull = target > 0;
    s.status = target === 0 ? "to_start" : "riding";
    derive();
  }

  function reset(): void {
    s = initialState();
    resetFlags();
    offSince = null;
    needFull = false;
    atStop = -1;
  }

  return {
    update,
    get state() { return s; },
    jumpToSegment,
    reset,
  };
}
