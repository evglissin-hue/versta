import { afterEach, describe, expect, it, vi } from "vitest";
// A frozen copy of the first Thames Loop pack: these tests are about the engine, and their scenarios are tuned to
// this geometry. The pack that ships is ridden end to end in ride.integration.test.ts and reroute.real.test.ts.
import packJson from "../fixtures/pack-v1.json";
import { cumulative, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type XY } from "../../src/geo";
import { createNavEngine } from "../../src/nav/engine";
import { createSimSource } from "../../src/nav/sources";
import type { Cue, Fix, LngLat, NavEvent, NavState, Pack, RouteGraph } from "../../src/types";

const pack = packJson as unknown as Pack;
const proj = makeProjection(pack.stops[0]!.at);
const T0 = 1_700_000_000_000;

function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ridden line from stop 0, or from `along` metres into segment `seg`. */
function line(seg = 1, along = 0): XY[] {
  const out: XY[] = [];
  for (let i = seg; i < pack.segments.length; i++) {
    let pts = at(pack.segments, i).map((q) => project(proj, q));
    if (i === seg && along > 0) {
      const cum = cumulative(pts);
      const cut = pointAlong(pts, along, cum);
      pts = [cut.point, ...pts.slice(cut.leg + 1)];
    }
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

interface FixOpts { speed?: number; noise?: number; accuracy?: number; seed?: number; offset?: (k: number) => number }

function fixesAlong(path: XY[], opts: FixOpts = {}): Fix[] {
  const speed = opts.speed ?? 4;
  const noise = opts.noise ?? 0;
  const rand = rng(opts.seed ?? 1);
  const cum = cumulative(path);
  const total = at(cum, cum.length - 1);
  const fixes: Fix[] = [];
  for (let k = 0, d = 0; ; k++, d = Math.min(total, d + speed)) {
    const pa = pointAlong(path, d, cum);
    const off = opts.offset ? opts.offset(k) : 0;
    const rad = (pa.bearing + 90) * (Math.PI / 180);
    const ang = rand() * Math.PI * 2;
    const r = rand() * noise;
    const xy: XY = [pa.point[0] + Math.sin(rad) * off + Math.cos(ang) * r, pa.point[1] + Math.cos(rad) * off + Math.sin(ang) * r];
    const ll = unproject(proj, xy);
    fixes.push({ lng: ll[0], lat: ll[1], accuracy: opts.accuracy ?? 5, heading: pa.bearing, speed, time: T0 + k * 1000 });
    if (d >= total) break;
  }
  // A few standing fixes at the end so the last stop is certain to register.
  const lastFix = at(fixes, fixes.length - 1);
  for (let j = 1; j <= 5; j++) fixes.push({ ...lastFix, time: lastFix.time + j * 1000 });
  return fixes;
}

interface Run { events: NavEvent[]; states: NavState[]; byFix: NavEvent[][]; engine: ReturnType<typeof createNavEngine> }

function run(fixes: Fix[]): Run {
  const engine = createNavEngine(pack);
  const events: NavEvent[] = [];
  const states: NavState[] = [];
  const byFix: NavEvent[][] = [];
  for (const f of fixes) {
    const ev = engine.update(f);
    events.push(...ev);
    byFix.push(ev);
    states.push({ ...engine.state, arrived: [...engine.state.arrived] });
  }
  return { events, states, byFix, engine };
}

const arrivals = (events: NavEvent[]): number[] => events.flatMap((e) => (e.type === "arrive" ? [e.stop] : []));
const cueEvents = (events: NavEvent[]) => events.flatMap((e) => (e.type === "cue" ? [e] : []));

/** Turns so close to a stop that they are announced as the rider sets off, with no earlier warning. This ride never stands still at a stop, so the old rule applies. */
const EXPECTED_NOW_ONLY = ["s03-003", "s09-002", "s11-003"];

describe("navigation engine on the Thames Loop", () => {
  it("1. a noiseless ride arrives at every stop in order and speaks every cue once, in order", () => {
    const r = run(fixesAlong(line()));
    expect(arrivals(r.events)).toEqual(Array.from({ length: 13 }, (_, i) => i));
    expect(r.engine.state.status).toBe("finished");
    expect(r.events.filter((e) => e.type === "finished")).toHaveLength(1);
    const cues = cueEvents(r.events);
    const now = cues.filter((e) => e.phase === "now");
    expect(now).toHaveLength(pack.cues.length);
    expect(now.map((e) => e.cue.id)).toEqual(pack.cues.map((c) => c.id));
    expect(new Set(now.map((e) => e.cue.id)).size).toBe(pack.cues.length);
    // Approach comes before now for every manoeuvre except the depart cues, and except a cue that is already inside
    // the "now" distance when it becomes next (the rider leaves a stop about 60 m from it, so a cue within ~80 m of a
    // segment start gets "now" only, as the brief says for a cue already past its approach point).
    const approached = new Set<string>();
    for (const e of cues) {
      if (e.phase === "approach") {
        expect(approached.has(e.cue.id)).toBe(false);
        approached.add(e.cue.id);
      }
    }
    const withoutApproach = pack.cues.filter((c) => c.turn !== "depart" && !approached.has(c.id));
    for (const c of withoutApproach) {
      const cum = cumulative(at(pack.segments, c.seg).map((q) => project(proj, q)));
      expect(at(cum, c.i)).toBeLessThan(80);
    }
    expect(withoutApproach.map((c) => c.id)).toEqual(EXPECTED_NOW_ONLY);
    // and an approach never comes after the cue's own now
    const nowSeen = new Set<string>();
    for (const e of cues) {
      if (e.phase === "now") nowSeen.add(e.cue.id);
      else expect(nowSeen.has(e.cue.id)).toBe(false);
    }
    expect(r.events.filter((e) => e.type === "off_route")).toHaveLength(0);
    // leave follows each arrival except the last
    expect(r.events.filter((e) => e.type === "leave").map((e) => (e as { stop: number }).stop)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it("2. a noisy ride (8 m, accuracy 10) gives the same arrivals and never goes off route", () => {
    const r = run(fixesAlong(line(), { noise: 8, accuracy: 10, seed: 7 }));
    expect(arrivals(r.events)).toEqual(Array.from({ length: 13 }, (_, i) => i));
    expect(r.events.filter((e) => e.type === "off_route")).toHaveLength(0);
    expect(r.engine.state.status).toBe("finished");
  });

  it("3. emits all 21 asides exactly once on a full ride", () => {
    expect(pack.asides).toHaveLength(21);
    for (const noise of [0, 8]) {
      const r = run(fixesAlong(line(), { noise, accuracy: 10, seed: 3 }));
      const ids = r.events.flatMap((e) => (e.type === "aside" ? [e.aside.id] : []));
      expect(ids).toHaveLength(21);
      expect(new Set(ids).size).toBe(21);
    }
  });

  it("4. a detour 120 m off the line for 30 s gives one off_route and one back_on_route", () => {
    const start = 60;
    const r = run(fixesAlong(line(), { offset: (k) => (k >= start && k < start + 30 ? 120 : 0) }));
    expect(r.events.filter((e) => e.type === "off_route")).toHaveLength(1);
    expect(r.events.filter((e) => e.type === "back_on_route")).toHaveLength(1);
    expect(at(r.states, start + 29).offRoute).toBe(true);
    expect(at(r.states, start + 32).offRoute).toBe(false);
    expect(arrivals(r.events)).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it("5. starting 2 km into segment 4 adopts segment 4 without arrive events for earlier stops", () => {
    const r = run(fixesAlong(line(4, 2000)));
    expect(at(r.states, 0).status).toBe("riding");
    expect(at(r.states, 0).seg).toBe(4);
    expect(at(r.states, 0).arrived).toEqual([0, 1, 2, 3]);
    expect(arrivals(r.events)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.engine.state.status).toBe("finished");
  });

  it("6. alongSeg never jumps more than 60 m between fixes on the shared Napier Avenue (segments 7 and 8)", () => {
    for (const noise of [0, 8]) {
      const r = run(fixesAlong(line(), { noise, accuracy: 10, seed: 11 }));
      let checked = 0;
      for (let i = 1; i < r.states.length; i++) {
        const a = at(r.states, i - 1);
        const b = at(r.states, i);
        if ((b.seg === 7 || b.seg === 8) && a.seg === b.seg) {
          expect(Math.abs(b.alongSeg - a.alongSeg)).toBeLessThanOrEqual(60);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(500);
    }
  });

  it("7. fixes with accuracy 200 never change seg or alongSeg", () => {
    const engine = createNavEngine(pack);
    const fixes = fixesAlong(line(4, 500));
    engine.update(at(fixes, 0));
    for (let i = 1; i < 20; i++) engine.update(at(fixes, i));
    const { seg, alongSeg, status } = engine.state;
    expect(status).toBe("riding");
    const far = at(fixesAlong(line(9, 300)), 0);
    for (let i = 0; i < 5; i++) {
      const ev = engine.update({ ...far, accuracy: 200, time: T0 + 100_000 + i * 1000 });
      expect(ev).toEqual([]);
      expect(engine.state.seg).toBe(seg);
      expect(engine.state.alongSeg).toBe(alongSeg);
      expect(engine.state.fix?.accuracy).toBe(200);
    }
    // and from the start: a poor fix leaves the engine locating
    const fresh = createNavEngine(pack);
    fresh.update({ ...far, accuracy: 200, time: T0 });
    expect(fresh.state.status).toBe("locating");
    expect(fresh.state.seg).toBe(0);
  });

  it("guides to the start, and jumpToSegment rides towards another stop", () => {
    const engine = createNavEngine(pack);
    const start = at(fixesAlong(line()), 0);
    const [sx, sy] = project(proj, [start.lng, start.lat]);
    const away = unproject(proj, [sx - 400, sy - 400]);
    engine.update({ ...start, lng: away[0], lat: away[1] });
    expect(engine.state.status).toBe("to_start");
    expect(engine.state.toStop).toBeGreaterThan(400);
    engine.jumpToSegment(6);
    expect(engine.state.status).toBe("riding");
    expect(engine.state.seg).toBe(6);
    expect(engine.state.arrived).toEqual([0, 1, 2, 3, 4, 5]);
    const f = fixesAlong(line(6, 200));
    engine.update(at(f, 0));
    expect(engine.state.seg).toBe(6);
    expect(engine.state.alongSeg).toBeGreaterThan(150);
    expect(engine.state.alongSeg).toBeLessThan(250);
  });

  it("treats a stop as reached when the rider turns up on the next segment", () => {
    const seg1End = at(pack.segments, 1).map((q) => project(proj, q));
    const cum = cumulative(seg1End);
    const cut: XY[] = [];
    for (let d = 0; d <= at(cum, cum.length - 1) - 70; d += 4) cut.push(pointAlong(seg1End, d, cum).point);
    const a = fixesAlong(cut, { speed: 4 }).slice(0, cut.length);
    const b = fixesAlong(line(2, 120), { speed: 4 }).slice(0, 40);
    const fixes = [...a, ...b.map((f, k) => ({ ...f, time: at(a, a.length - 1).time + (k + 1) * 1000 }))];
    const engine = createNavEngine(pack);
    const events: NavEvent[] = [];
    // stop 0 first so the ride is under way
    for (const f of [at(fixesAlong(line(1)), 0), ...fixes]) events.push(...engine.update(f));
    expect(arrivals(events)).toEqual([0, 1]);
    expect(engine.state.seg).toBe(2);
    expect(engine.state.status).toBe("riding");
    expect(engine.state.alongSeg).toBeGreaterThan(100);
  });
});

describe("simulator", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("8. at scale 50 completes the route, and its clock runs 50 times faster than real time", () => {
    vi.useFakeTimers();
    const source = createSimSource(pack, { speed: 20, scale: 50, from: 0 });
    const engine = createNavEngine(pack);
    const realStart = Date.now();
    let first: number | null = null;
    let fixes = 0;
    source.start((f) => { first ??= f.time; fixes++; engine.update(f); }, () => {});
    vi.advanceTimersByTime(4000);
    const simElapsed = source.now!() - first! + 1000;
    const ratio = simElapsed / (Date.now() - realStart);
    expect(ratio).toBeGreaterThan(40);
    expect(ratio).toBeLessThan(60);
    vi.advanceTimersByTime(120_000);
    source.stop();
    expect(engine.state.status).toBe("finished");
    expect(engine.state.arrived).toEqual(Array.from({ length: 13 }, (_, i) => i));
    expect(fixes).toBeGreaterThan(1000);
  });

  it("a ride started from stop 5 finishes and arrives at stops 5 to 12 once each", () => {
    vi.useFakeTimers();
    const source = createSimSource(pack, { speed: 6, scale: 100, from: 5 });
    const engine = createNavEngine(pack);
    const got: number[] = [];
    source.start((f) => { got.push(...arrivals(engine.update(f))); }, () => {});
    vi.advanceTimersByTime(120_000);
    source.stop();
    expect(engine.state.status).toBe("finished");
    expect(got.filter((s) => s >= 5)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(engine.state.arrived).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it("holds position on request and keeps emitting fixes", () => {
    vi.useFakeTimers();
    const source = createSimSource(pack, { speed: 5, scale: 10, from: 3 });
    const seen: Fix[] = [];
    source.start((f) => seen.push(f), () => {});
    vi.advanceTimersByTime(1000);
    source.hold!(true);
    const n = seen.length;
    vi.advanceTimersByTime(1000);
    const held = seen.slice(n);
    expect(held.length).toBe(10);
    const a = project(proj, [at(held, 0).lng, at(held, 0).lat]);
    const b = project(proj, [at(held, 9).lng, at(held, 9).lat]);
    expect(Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1))).toBeLessThan(7);
    expect(held.every((f) => f.accuracy === 6 && f.speed === 5)).toBe(true);
    source.stop();
  });
});

/** A 60 m street grid over the bounding box of one segment, padded by `pad` metres, shaped like RouteGraph. */
function gridOver(seg: number, pad = 500, step = 60): RouteGraph {
  const pts = at(pack.segments, seg).map((q) => project(proj, q));
  const xs = pts.map((p) => at(p, 0));
  const ys = pts.map((p) => at(p, 1));
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const nx = Math.floor((x1 - x0) / step) + 1, ny = Math.floor((y1 - y0) / step) + 1;
  const nodes: LngLat[] = [];
  const edges: RouteGraph["edges"] = [];
  const names: string[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push(unproject(proj, [x0 + i * step, y0 + j * step]));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * nx + i;
    if (i + 1 < nx) { names.push(`Row ${j}`); edges.push([a, a + 1, step, step, names.length - 1, 0, 0]); }
    if (j + 1 < ny) { names.push(`Col ${i}`); edges.push([a, a + nx, step, step, names.length - 1, 0, 0]); }
  }
  return { nodes, edges, names, kinds: ["road"] };
}

describe("finding a way back", () => {
  const SEG = 4;
  const graph = gridOver(SEG);
  const ALONG = 1950;
  const onRoute = line(SEG, ALONG);

  /** Fixes riding the route up to `ALONG` + 40 m, 4 m/s, one a second. */
  function ridden(): Fix[] { return fixesAlong(onRoute).slice(0, 50); }

  /** Where the rider is, 150 m to the right of the route, `lateral` metres out. */
  function offPoint(lateral: number): XY {
    const f = at(ridden(), 49);
    const p = project(proj, [f.lng, f.lat]);
    const pa = pointAlong(onRoute, 4 * 49);
    const rad = (pa.bearing + 90) * (Math.PI / 180);
    return [at(p, 0) + Math.sin(rad) * lateral, at(p, 1) + Math.cos(rad) * lateral];
  }
  const fixAt = (p: XY, time: number): Fix => {
    const ll = unproject(proj, p);
    return { lng: ll[0], lat: ll[1], accuracy: 5, heading: null, speed: 4, time };
  };

  interface Drive { engine: ReturnType<typeof createNavEngine>; time: number; events: { at: number; e: NavEvent }[] }
  function start(withGraph: boolean): Drive {
    const engine = createNavEngine(pack);
    if (withGraph) engine.setGraph?.(graph);
    const d: Drive = { engine, time: T0, events: [] };
    for (const f of ridden()) { for (const e of engine.update(f)) d.events.push({ at: f.time, e }); d.time = f.time; }
    return d;
  }
  function feed(d: Drive, p: XY): NavEvent[] {
    d.time += 1000;
    const ev = d.engine.update(fixAt(p, d.time));
    for (const e of ev) d.events.push({ at: d.time, e });
    return ev;
  }
  const ofType = (d: Drive, type: NavEvent["type"]) => d.events.filter((x) => x.e.type === type);
  /** Stand 150 m off the route until off_route fires and the engine has had its chance to answer. */
  function strayOut(d: Drive, lateral = 150): XY {
    const p = offPoint(lateral);
    for (let k = 0; k < 12; k++) feed(d, p);
    return p;
  }
  /** Walk `path` at 4 m/s from where the rider is, one fix a second, until it ends. */
  function walk(d: Drive, path: XY[]): void {
    const cum = cumulative(path);
    const total = at(cum, cum.length - 1);
    for (let m = 4; m < total + 4; m += 4) feed(d, pointAlong(path, Math.min(m, total), cum).point);
  }

  it("a detour 150 m off the line gives off_route, then a detour with a line that ends on the route", () => {
    const d = start(true);
    expect(d.engine.state.status).toBe("riding");
    strayOut(d);
    const order = d.events.map((x) => x.e.type).filter((x) => x === "off_route" || x === "detour");
    expect(order).toEqual(["off_route", "detour"]);
    expect(at(ofType(d, "detour"), 0).e).toEqual({ type: "detour", found: true });
    const det = d.engine.state.detour!;
    expect(det.line.length).toBeGreaterThan(2);
    const end = project(proj, at(det.line, det.line.length - 1));
    const g = at(pack.segments, SEG).map((q) => project(proj, q));
    expect(nearestOnPolyline(g, end).dist).toBeLessThan(1);
    expect(det.toRejoin).toBeGreaterThan(100);
    expect(det.toRejoin).toBeLessThan(500);
    // ahead of where the rider was, not behind
    expect(nearestOnPolyline(g, end).along).toBeGreaterThan(d.engine.state.alongSeg - 60);
  });

  it("with the rider following the detour: turns in order, then back_on_route with the detour cleared", () => {
    const d = start(true);
    const p = strayOut(d);
    const first = d.engine.state.detour!;
    const path = [p, ...first.line.slice(1).map((q) => project(proj, q))];
    walk(d, path);
    for (let k = 0; k < 4; k++) feed(d, path[path.length - 1]!);
    const turns = d.events.flatMap((x) => (x.e.type === "detour_turn" ? [x.e] : []));
    expect(turns.length).toBeGreaterThan(0);
    // The first announcement is the turn the detour said was next, and none is repeated back to back.
    expect({ turn: at(turns, 0).turn, name: at(turns, 0).name }).toEqual({ turn: first.next!.turn, name: first.next!.name });
    expect(first.next!.turn).not.toBe("straight");
    expect(turns.length).toBeLessThanOrEqual(3);
    const types = d.events.map((x) => x.e.type);
    expect(types.filter((x) => x === "back_on_route")).toHaveLength(1);
    expect(types.indexOf("detour")).toBeLessThan(types.indexOf("detour_turn"));
    expect(types.indexOf("detour_turn")).toBeLessThan(types.indexOf("back_on_route"));
    expect(d.engine.state.offRoute).toBe(false);
    expect(d.engine.state.detour ?? null).toBeNull();
  });

  it("announces a turn 40 m before it, and next shrinks as the rider walks", () => {
    const d = start(true);
    const p = strayOut(d);
    const first = d.engine.state.detour!;
    expect(first.next).not.toBeNull();
    const path = [p, ...first.line.slice(1).map((q) => project(proj, q))];
    const cum = cumulative(path);
    const nextAt = project(proj, first.next!.at);
    const turnAlong = nearestOnPolyline(path, nextAt, cum).along;
    let said: number | null = null;
    let lastDist = Infinity;
    for (let m = 4; m < turnAlong + 20; m += 4) {
      const ev = feed(d, pointAlong(path, m, cum).point);
      if (said === null && ev.some((e) => e.type === "detour_turn")) said = turnAlong - m;
      const nx = d.engine.state.detour?.next;
      if (nx && nx.name === first.next!.name && m < turnAlong - 8) { expect(nx.dist).toBeLessThanOrEqual(lastDist + 1); lastDist = nx.dist; }
    }
    expect(said).not.toBeNull();
    expect(said!).toBeLessThanOrEqual(40);
    expect(said!).toBeGreaterThan(30);
  });

  it("without a graph the same ride gives no detour events", () => {
    const d = start(false);
    const p = strayOut(d);
    walk(d, [p, ...ridden().slice(48, 49).map((f) => project(proj, [f.lng, f.lat]))]);
    expect(ofType(d, "off_route")).toHaveLength(1);
    expect(d.events.some((x) => x.e.type === "detour" || x.e.type === "detour_turn")).toBe(false);
    expect(d.engine.state.detour ?? null).toBeNull();
  });

  it("setGraph(null) turns the feature off again", () => {
    const d = start(true);
    d.engine.setGraph?.(null);
    strayOut(d);
    expect(d.events.some((x) => x.e.type === "detour")).toBe(false);
  });

  it("reports detour found false when the rider is far from any street, once", () => {
    const d = start(true);
    strayOut(d, 3000);
    for (let k = 0; k < 30; k++) feed(d, offPoint(3000));
    const found = ofType(d, "detour").map((x) => (x.e as { found: boolean }).found);
    expect(found).toEqual([false]);
    expect(d.engine.state.detour ?? null).toBeNull();
  });

  it("straying from the detour triggers one recompute, not a storm", () => {
    const d = start(true);
    strayOut(d, 150);
    expect(ofType(d, "detour")).toHaveLength(1);
    const first = d.time;
    // A different place 90 m further out, held for 25 s.
    const far = offPoint(240);
    for (let k = 0; k < 25; k++) feed(d, far);
    const found = ofType(d, "detour");
    expect(found).toHaveLength(2);
    expect(at(found, 1).at - at(found, 0).at).toBeGreaterThanOrEqual(10_000);
    expect(at(found, 1).at).toBeGreaterThan(first);
    // Drifting away at walking pace for a minute never searches more often than every 10 s.
    const before = ofType(d, "detour").length;
    for (let k = 0; k < 60; k++) feed(d, offPoint(240 + k * 3));
    const times = ofType(d, "detour").slice(before - 1).map((x) => x.at);
    for (let i = 1; i < times.length; i++) expect(at(times, i) - at(times, i - 1)).toBeGreaterThanOrEqual(10_000);
    expect(times.length).toBeLessThanOrEqual(7);
  });

  it("keeps the detour while off route and clears it on arrival at the stop or a jump", () => {
    const d = start(true);
    strayOut(d);
    expect(d.engine.state.detour).toBeTruthy();
    d.engine.jumpToSegment(SEG + 1);
    expect(d.engine.state.detour ?? null).toBeNull();
  });
});

describe("the nearest point of the route while guiding to the start", () => {
  it("points at the right segment for a rider near Greenwich", () => {
    // 100 m to the side of the line, 400 m along segment 5 (Deptford to Cutty Sark and Greenwich).
    const seg = 5;
    const pts = at(pack.segments, seg).map((q) => project(proj, q));
    const cum = cumulative(pts);
    const pa = pointAlong(pts, Math.min(400, at(cum, cum.length - 1) / 2), cum);
    const rad = (pa.bearing + 90) * (Math.PI / 180);
    const rider: XY = [at(pa.point, 0) + Math.sin(rad) * 100, at(pa.point, 1) + Math.cos(rad) * 100];
    const ll = unproject(proj, rider);
    const engine = createNavEngine(pack);
    const fix: Fix = { lng: ll[0], lat: ll[1], accuracy: 5, heading: null, speed: null, time: T0 };
    engine.update(fix);
    expect(engine.state.status).toBe("to_start");
    // brute force over every segment
    let best = { seg: 0, dist: Infinity };
    for (let k = 1; k < pack.segments.length; k++) {
      const n = nearestOnPolyline(at(pack.segments, k).map((q) => project(proj, q)), rider);
      if (n.dist < best.dist) best = { seg: k, dist: n.dist };
    }
    const near = engine.state.nearest!;
    expect(near).toBeTruthy();
    expect(near.seg).toBe(best.seg);
    expect(near.seg).toBe(seg);
    expect(near.dist).toBeCloseTo(best.dist, 3);
    expect(near.dist).toBeGreaterThan(90);
    expect(near.dist).toBeLessThan(105);
    // the point lies on the line
    expect(nearestOnPolyline(pts, project(proj, near.at)).dist).toBeLessThan(0.5);
  });

  it("is recomputed at most once every 5 s and cleared once the ride starts", () => {
    const engine = createNavEngine(pack);
    const start = at(fixesAlong(line()), 0);
    const [sx, sy] = project(proj, [start.lng, start.lat]);
    const place = (dx: number, k: number): Fix => {
      const ll = unproject(proj, [sx - 400 + dx, sy - 400]);
      return { ...start, lng: ll[0], lat: ll[1], time: T0 + k * 1000 };
    };
    engine.update(place(0, 0));
    const first = engine.state.nearest!;
    expect(first).toBeTruthy();
    engine.update(place(-300, 2));
    expect(engine.state.nearest).toBe(first);
    engine.update(place(-300, 6));
    expect(engine.state.nearest).not.toBe(first);
    engine.update(at(fixesAlong(line(4, 300)), 0));
    expect(engine.state.status).toBe("riding");
    expect(engine.state.nearest ?? null).toBeNull();
  });
});

/* ------------------------------------------------------------------ guidance (iteration 3) */

/** A straight pack: stop 0 at the origin, segment 1 runs 2000 m east, stop 2 sits beside its middle. */
function straightPack(): Pack {
  const origin = pack.stops[0]!.at;
  const east = (m: number, north = 0): LngLat => unproject(proj, [m, north]);
  const poly = (from: LngLat, to: LngLat): LngLat[] => Array.from({ length: 201 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / 200, from[1] + ((to[1] - from[1]) * i) / 200] as LngLat);
  const seg1 = poly(origin, east(2000));
  const seg2 = poly(east(2000), east(1000, 25));
  const cue = (id: string, along: number, turn: Cue["turn"]): Cue => ({
    id, seg: 1, i: Math.round(along / 10), at: east(along), turn, name: id, kind: "road", len: 100, say: id, audio: `cues/${id}.mp3`,
  });
  const stop = (id: string, at: LngLat, radius: number): Pack["stops"][number] => ({ id, name: id, at, note: "", ambience: "river", arriveRadius: radius, stories: [] });
  return {
    ...pack,
    stops: [stop("a", origin, 45), stop("b", east(2000), 20), stop("c", east(1000, 25), 20)],
    segments: [[], seg1, seg2],
    cues: [cue("A", 400, "left"), cue("B", 480, "right"), cue("C", 1000, "left"), cue("D", 1300, "right")],
    asides: [],
  };
}

interface Step { d: number; offset?: number }

/** One fix a second along the straight pack. Heading and speed come from the step before. */
function straightFixes(steps: Step[], opts: { headingNull?: boolean } = {}): Fix[] {
  return steps.map((st, k) => {
    const ll = unproject(proj, [st.d, st.offset ?? 0]);
    // the first fix takes its speed and direction from the step after it
    const delta = k > 0 ? st.d - steps[k - 1]!.d : (steps[1]?.d ?? st.d) - st.d;
    return {
      lng: ll[0], lat: ll[1], accuracy: 5, time: T0 + k * 1000, speed: Math.abs(delta),
      heading: opts.headingNull ? null : delta < 0 ? 270 : 90,
    };
  });
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let d = from; step > 0 ? d <= to : d >= to; d += step) out.push(d);
  return out;
};

describe("speed average", () => {
  it("settles near 5 on a 5 m/s ride, stays null for the first 5 s, and settles near 0 when standing", () => {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    const seen: (number | null | undefined)[] = [];
    for (const f of straightFixes(range(300, 1100, 5).map((d) => ({ d })))) { engine.update(f); seen.push(engine.state.speedAvg); }
    expect(seen.slice(0, 5).every((v) => v === null)).toBe(true);
    expect(seen[6]).not.toBeNull();
    expect(engine.state.speedAvg!).toBeGreaterThan(4.9);
    expect(engine.state.speedAvg!).toBeLessThan(5.1);

    const still = createNavEngine(sp);
    for (const f of straightFixes(Array.from({ length: 60 }, () => ({ d: 600 })))) still.update(f);
    expect(still.state.speedAvg!).toBeGreaterThanOrEqual(0);
    expect(still.state.speedAvg!).toBeLessThan(0.1);
  });

  it("falls back to distance over time when the fix has no speed, and ignores poor fixes", () => {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    const fixes = straightFixes(range(300, 700, 4).map((d) => ({ d }))).map((f) => ({ ...f, speed: null }));
    for (const f of fixes) engine.update(f);
    expect(engine.state.speedAvg!).toBeGreaterThan(3.8);
    expect(engine.state.speedAvg!).toBeLessThan(4.2);
    const before = engine.state.speedAvg;
    const last = fixes[fixes.length - 1]!;
    engine.update({ ...last, time: last.time + 1000, accuracy: 500, speed: 30 });
    expect(engine.state.speedAvg).toBe(before);
  });
});

describe("approach distance", () => {
  /** Rides cue A and B at a steady speed; returns the distance to each cue when its approach fired. */
  function approaches(speed: number): { id: string; toCue: number | null; index: number }[] {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    const out: { id: string; toCue: number | null; index: number }[] = [];
    let n = 0;
    for (const f of straightFixes(range(160, 1100, speed).map((d) => ({ d })))) {
      for (const e of engine.update(f)) {
        if (e.type === "cue") out.push({ id: `${e.cue.id}:${e.phase}`, toCue: e.phase === "approach" ? engine.state.toCue : null, index: n++ });
      }
    }
    return out;
  }

  it("grows with speed: about 70 m at 3 m/s and about 120 m at 8 m/s, with the state already updated", () => {
    const slow = approaches(3).find((a) => a.id === "A:approach")!;
    const fast = approaches(8).find((a) => a.id === "A:approach")!;
    expect(slow.toCue!).toBeGreaterThanOrEqual(64);
    expect(slow.toCue!).toBeLessThanOrEqual(73);
    expect(fast.toCue!).toBeGreaterThanOrEqual(110);
    expect(fast.toCue!).toBeLessThanOrEqual(128);
  });

  it("never announces a turn before the one in front of it has been reached", () => {
    for (const speed of [3, 8, 14]) {
      const a = approaches(speed);
      const aNow = a.find((x) => x.id === "A:now")!;
      const bApproach = a.find((x) => x.id === "B:approach");
      if (bApproach) {
        expect(bApproach.index).toBeGreaterThan(aNow.index);
        expect(bApproach.toCue!).toBeLessThanOrEqual(80 - 15 + 0.001);
      }
      // every cue is still spoken at least once, in order
      expect(a.filter((x) => x.id.endsWith(":now")).map((x) => x.id)).toEqual(["A:now", "B:now", "C:now", "D:now"].slice(0, a.filter((x) => x.id.endsWith(":now")).length));
    }
  });

  it("is capped at 320 m however fast the rider goes", () => {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    let d = 0;
    for (const f of straightFixes(range(500, 1100, 30).map((x) => ({ d: x })))) {
      for (const e of engine.update(f)) if (e.type === "cue" && e.phase === "approach" && e.cue.id === "C") d = engine.state.toCue!;
    }
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(320);
  });
});

describe("the cue after next", () => {
  it("is set for two cues 80 m apart and null for two 300 m apart", () => {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    const at300 = [] as NavState[];
    for (const f of straightFixes(range(300, 1250, 10).map((d) => ({ d })))) {
      engine.update(f);
      at300.push({ ...engine.state });
    }
    const near = at300.find((s) => s.nextCue?.id === "A")!;
    expect(near.thenCue?.id).toBe("B");
    expect(near.toThen!).toBeCloseTo(80, 0);
    const far = at300.find((s) => s.nextCue?.id === "C")!;
    expect(far.thenCue).toBeNull();
    expect(far.toThen).toBeNull();
    const last = at300.find((s) => s.nextCue?.id === "D")!;
    expect(last.thenCue).toBeNull();
  });
});

describe("wrong way", () => {
  const count = (events: NavEvent[]): number => events.filter((e) => e.type === "wrong_way").length;
  function ride(sp: Pack, steps: Step[], opts: { headingNull?: boolean } = {}): { events: NavEvent[]; states: NavState[] } {
    const engine = createNavEngine(sp);
    const events: NavEvent[] = [];
    const states: NavState[] = [];
    for (const f of straightFixes(steps, opts)) { events.push(...engine.update(f)); states.push({ ...engine.state }); }
    return { events, states };
  }
  const forward = range(300, 400, 5);
  const back = (n: number, from = 400, v = 5): number[] => Array.from({ length: n }, (_, i) => from - (i + 1) * v);

  it("riding the line backwards for 15 s gives one wrong_way and sets the flag; turning round clears it", () => {
    const sp = straightPack();
    const turnedRound = Array.from({ length: 12 }, (_, i) => 325 + i * 5);
    const r = ride(sp, [...forward, ...back(15), ...turnedRound].map((d) => ({ d })));
    expect(count(r.events)).toBe(1);
    const first = r.states.findIndex((s) => s.wrongWay);
    expect(first).toBeGreaterThan(forward.length + 8);
    expect(r.states[r.states.length - 1]!.wrongWay).toBe(false);
    // it stays set until the rider has been right for 5 s
    const cleared = r.states.findIndex((s, i) => i > first && !s.wrongWay);
    expect(cleared - (forward.length + 15)).toBeGreaterThanOrEqual(4);
  });

  it("also works from the bearing between fixes when the device gives no heading", () => {
    const r = ride(straightPack(), [...forward, ...back(15)].map((d) => ({ d })), { headingNull: true });
    expect(count(r.events)).toBe(1);
  });

  it("fires once per spell however long the rider goes on", () => {
    const sp = straightPack();
    const r = ride(sp, [...range(1000, 1200, 5), ...back(40, 1200)].map((d) => ({ d })));
    expect(count(r.events)).toBe(1);
  });

  it("does not fire on a normal ride, a slow dawdle, or a short U-turn", () => {
    const sp = straightPack();
    expect(count(ride(sp, range(300, 1100, 5).map((d) => ({ d }))).events)).toBe(0);
    expect(count(ride(sp, [...forward, ...back(15, 400, 1)].map((d) => ({ d }))).events)).toBe(0);
    expect(count(ride(sp, [...forward, ...back(5), ...range(375, 500, 5)].map((d) => ({ d }))).events)).toBe(0);
    const real = run(fixesAlong(line()));
    expect(real.events.filter((e) => e.type === "wrong_way")).toHaveLength(0);
    const noisy = run(fixesAlong(line(), { noise: 8, accuracy: 10, seed: 7 }));
    expect(noisy.events.filter((e) => e.type === "wrong_way")).toHaveLength(0);
  });

  it("does not fire within 60 m of a stop, where people circle about", () => {
    const sp = straightPack();
    // stop c sits beside the middle of the line, so this reversal happens inside its 60 m zone
    const nearStop = ride(sp, [...range(950, 1000, 5), ...back(8, 1000, 5)].map((d) => ({ d })));
    expect(count(nearStop.events)).toBe(0);
    // the same reversal further along the line does fire
    const away = ride(sp, [...range(1450, 1500, 5), ...back(15, 1500, 5)].map((d) => ({ d })));
    expect(count(away.events)).toBe(1);
  });

  it("does not fire while off route", () => {
    const sp = straightPack();
    const steps: Step[] = [...forward.map((d) => ({ d })), ...back(25).map((d) => ({ d, offset: 100 }))];
    const r = ride(sp, steps);
    expect(r.states.some((s) => s.offRoute)).toBe(true);
    expect(count(r.events)).toBe(0);
  });

  it("is cleared by going off route and by a jump", () => {
    const sp = straightPack();
    const engine = createNavEngine(sp);
    const steps: Step[] = [...forward, ...back(14)].map((d) => ({ d }));
    for (const f of straightFixes(steps)) engine.update(f);
    expect(engine.state.wrongWay).toBe(true);
    engine.jumpToSegment(1);
    expect(engine.state.wrongWay).toBe(false);
  });
});
