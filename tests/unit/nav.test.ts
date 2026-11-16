import { afterEach, describe, expect, it, vi } from "vitest";
import packJson from "../../public/packs/thames-loop/pack.json";
import { cumulative, makeProjection, pointAlong, project, unproject, type XY } from "../../src/geo";
import { createNavEngine } from "../../src/nav/engine";
import { createSimSource } from "../../src/nav/sources";
import type { Fix, NavEvent, NavState, Pack } from "../../src/types";

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

/** Turns so close to a stop that they are announced as the rider sets off, with no earlier warning. */
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
