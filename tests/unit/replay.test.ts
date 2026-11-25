/**
 * Replays recorded rides (tests/fixtures/rides/*.json, made by the ride recorder on a phone or generated below)
 * through the real engine and director with the virtual mixer and a fake clock, and checks what a rider would have
 * got stuck on: speech over speech, late turn cues, a held voice, a bed left running after the rider left a stop,
 * an off route or wrong way the recording did not have, a stop the recording reached that the replay did not.
 * Drop a recording from a real ride into tests/fixtures/rides/ and it becomes a test.
 *
 * To make the seeded fixtures again (a simulated Royal Docks ride at 5 m/s with 4 m of GPS noise, one fix a second;
 * and a Chelsea Loop ride at 4.5 m/s through the urban GPS model of src/nav/jitter.ts, seed 11: multipath, lying
 * accuracy, gaps, late and duplicate fixes):
 *   MAKE_FIXTURE=1 npx vitest run tests/unit/replay.test.ts -t "make the seeded fixture"
 *   MAKE_FIXTURE=jitter npx vitest run tests/unit/replay.test.ts -t "make the jittered fixture"
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixer } from "../../src/audio/mixer";
import { cumulative, makeProjection, pointAlong, project, unproject } from "../../src/geo";
import { createNavEngine } from "../../src/nav/engine";
import { createJitter } from "../../src/nav/jitter";
import { beginRecording } from "../../src/record/recorder";
import { memoryStorage, useStorage } from "../../src/record/store";
import { createDirector } from "../../src/story/director";
import { DEFAULT_SETTINGS, type DirectorLogEntry, type Fix, type Mixer, type NavEvent, type NowPlaying, type Pack, type RideRecording } from "../../src/types";
import { PACKS, loaded } from "./packs";
import { bedAfterLeave, heldVoice, lateCues, speechOverlaps } from "./timeline";

const FIXTURES = new URL("../fixtures/rides/", import.meta.url);

/** The mixer, watched: a voice clip started over another is talking over it; stops and pauses are deliberate. */
function watched(inner: Mixer, overlaps: string[], deliberate: number[]): Mixer {
  let current = "";
  return new Proxy(inner, {
    get(t, k) {
      if (k === "playVoice") {
        return (src: string, o?: Parameters<Mixer["playVoice"]>[1]) => {
          if (t.voiceBusy) overlaps.push(`${src} started over ${current} at ${Math.round(Date.now() / 1000)} s`);
          current = src;
          deliberate.push(Date.now());
          return t.playVoice(src, o);
        };
      }
      if (k === "stopVoice" || k === "pauseVoice" || k === "seekVoice") {
        const f = Reflect.get(t, k, t) as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => { deliberate.push(Date.now()); return f.apply(t, a); };
      }
      const v: unknown = Reflect.get(t, k, t);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** The engine and the director on a fake clock, fed one fix at a time. */
function session(pack: Pack, startAt: number, t0: number) {
  vi.setSystemTime(t0);
  const overlaps: string[] = [];
  const deliberate: number[] = [];
  const log: DirectorLogEntry[] = [];
  const events: { at: number; event: NavEvent }[] = [];
  const leaves: number[] = [];
  let now: NowPlaying = null;
  const inner = createMixer({ baseUrl: "", virtual: true });
  const mixer = watched(inner, overlaps, deliberate);
  const engine = createNavEngine(pack);
  const director = createDirector({ pack, mixer, settings: () => DEFAULT_SETTINGS, clock: () => Date.now(), timeScale: 1, onNowPlaying: (n) => { now = n; }, onLog: (e) => log.push(e) });
  if (startAt > 0) engine.startAt?.(startAt);
  return {
    log, events, overlaps, engine,
    playing: (): NowPlaying => now,
    async feed(fix: Fix): Promise<NavEvent[]> {
      const delta = fix.time - Date.now();
      if (delta > 0) await vi.advanceTimersByTimeAsync(delta);
      const evs = engine.update(fix);
      for (const event of evs) { events.push({ at: fix.time, event }); if (event.type === "leave") leaves.push(fix.time); }
      director.handle(evs, engine.state);
      return evs;
    },
    async finish() {
      // let the last sounds finish and the bed fade
      await vi.advanceTimersByTimeAsync(40_000);
      const timeline = [...inner.timeline];
      director.dispose();
      return { timeline, leaves, deliberate };
    },
  };
}

/** A name for an event that ignores timing: what happened, to what. */
function eventKey(e: NavEvent): string {
  switch (e.type) {
    case "cue": return `cue ${e.cue.id} ${e.phase}`;
    case "arrive": case "leave": return `${e.type} stop ${e.stop}`;
    case "aside": return `aside ${e.aside.id}`;
    case "detour": return `detour ${e.found ? "found" : "none"}`;
    case "detour_turn": return `detour_turn ${e.turn}`;
    default: return e.type;
  }
}
function counts(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
/** What is in `a` and not in `b`, counting repeats. */
function minus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, n] of a) { const d = n - (b.get(k) ?? 0); if (d > 0) out.push(d > 1 ? `${k} x${d}` : k); }
  return out.sort();
}

export interface ReplayResult {
  problems: string[];
  /** Events the replay produced that the recording did not. */
  extra: string[];
  /** Events the recording had that the replay did not. */
  missing: string[];
}

/** Replay a recording and say what a rider would have got stuck on. */
async function replay(rec: RideRecording, pack: Pack): Promise<ReplayResult> {
  const fixes = rec.fixes;
  const s = session(pack, rec.startAt, fixes[0]?.time ?? rec.startedAt);
  for (const f of fixes) await s.feed(f);
  const { timeline, leaves, deliberate } = await s.finish();
  const t0 = fixes[0]?.time ?? 0;

  const problems: string[] = [
    ...s.overlaps,
    ...speechOverlaps(timeline, t0),
    ...lateCues(timeline, s.log, pack, 3500, t0),
    ...heldVoice(timeline, deliberate, 1000, t0),
    ...bedAfterLeave(timeline, leaves, 30_000, t0),
  ];
  // an off route or wrong way the recording itself did not have
  for (const what of ["off_route", "wrong_way"] as const) {
    const had = rec.log.filter((e) => e.what === what).length;
    const got = s.log.filter((e) => e.what === what).length;
    if (got > had) problems.push(`replay has ${got} ${what}, the recording had ${had}`);
  }
  // every stop the recording arrived at is arrived at
  const arrived = new Set(s.events.filter((e) => e.event.type === "arrive").map((e) => (e.event as { stop: number }).stop));
  for (const e of rec.events) if (e.event.type === "arrive" && !arrived.has(e.event.stop)) problems.push(`stop ${e.event.stop} was arrived at in the recording and never in the replay`);

  const was = counts(rec.events.map((e) => eventKey(e.event)));
  const is = counts(s.events.map((e) => eventKey(e.event)));
  return { problems, extra: minus(is, was), missing: minus(was, is) };
}

function report(name: string, r: ReplayResult): void {
  const list = (xs: string[]): string => (xs.length ? xs.slice(0, 12).join(", ") + (xs.length > 12 ? `, and ${xs.length - 12} more` : "") : "none");
  console.log(`replay ${name}: problems ${r.problems.length}; replay only: ${list(r.extra)}; recording only: ${list(r.missing)}`);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort();
const packOf = (id: string): Pack => {
  const entry = PACKS.find((p) => p.entry.id === id);
  if (!entry) throw new Error(`a recording is of ${id}, which is not in public/packs/index.json`);
  return loaded(entry);
};
const load = (f: string): RideRecording => JSON.parse(readFileSync(new URL(f, FIXTURES), "utf8")) as RideRecording;

describe("ride recordings replay through the engine and the director", () => {
  it.each(files)("%s replays without a dead end", async (f) => {
    const rec = load(f);
    const r = await replay(rec, packOf(rec.packId));
    report(f, r);
    expect(r.problems).toEqual([]);
  }, 300_000);

  it("a recording doctored with a 300 m wander off the route fails the replay", async () => {
    const rec = load(files[0]!);
    const pack = packOf(rec.packId);
    // From a quarter of the way in the rider wanders 300 m north at 5 m/s, waits half a minute and comes back, with
    // the speed and bearing a phone would report for that. (A few fixes that jump 300 m and back are GPS noise, which
    // the position filter rightly ignores: that is no longer a dead end for the replay to find.)
    const from = Math.floor(rec.fixes.length / 4);
    const ramp = 60, hold = 30;
    const offAt = (k: number): number => (k < 0 || k >= 2 * ramp + hold ? 0 : k < ramp ? (300 * k) / ramp : k < ramp + hold ? 300 : (300 * (2 * ramp + hold - k)) / ramp);
    const rad = Math.PI / 180;
    const doctored: RideRecording = {
      ...rec,
      fixes: rec.fixes.map((x, i) => {
        const k = i - from;
        if (k < 0 || k >= 2 * ramp + hold) return x;
        const north = k < ramp ? 5 : k < ramp + hold ? 0 : -5;
        const h = (x.heading ?? 0) * rad, sp = x.heading === null ? 0 : x.speed ?? 0;
        const ve = sp * Math.sin(h), vn = sp * Math.cos(h) + north;
        const speed = Math.hypot(ve, vn);
        return { ...x, lat: x.lat + offAt(k) / 111_320, speed, heading: speed >= 1 ? ((Math.atan2(ve, vn) / rad) + 360) % 360 : null };
      }),
    };
    const r = await replay(doctored, pack);
    report(`${files[0]} with a 300 m wander`, r);
    expect(r.problems.length + r.extra.length + r.missing.length).toBeGreaterThan(0);
    expect(r.problems.length).toBeGreaterThan(0);
  }, 300_000);

  it.runIf(process.env.MAKE_FIXTURE === "1")("make the seeded fixture", async () => {
    const pack = packOf("royal-docks");
    const T0 = 1_700_000_000_000;
    const speed = 5;
    let seed = 20260607;
    const rand = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const proj = makeProjection(pack.stops[0]!.at);
    useStorage(memoryStorage());
    vi.setSystemTime(T0);
    const recorder = beginRecording({ packId: pack.id, version: null, startAt: 0, app: "simulated" });
    const s = session(pack, 0, T0);
    const unlog = s.log.push.bind(s.log);
    s.log.push = (...e: DirectorLogEntry[]): number => { for (const x of e) recorder.log(x); return unlog(...e); };
    let clock = T0;
    const feed = async (lng: number, lat: number, heading: number | null, moving: boolean): Promise<void> => {
      const p = project(proj, [lng, lat]);
      const q = unproject(proj, [p[0] + gauss() * 4, p[1] + gauss() * 4] as never);
      const fix: Fix = { lng: Math.round(q[0] * 1e6) / 1e6, lat: Math.round(q[1] * 1e6) / 1e6, accuracy: 5, heading: heading === null ? null : Math.round(heading), speed: moving ? speed : 0, time: clock };
      recorder.fix(fix);
      recorder.events(clock, await s.feed(fix));
      clock += 1000;
    };
    const stand = async (lng: number, lat: number): Promise<void> => {
      for (let i = 0; i < 4 && s.playing() === null; i++) await feed(lng, lat, null, false);
      for (let g = 0; s.playing()?.kind === "story" && g < 3600; g++) await feed(lng, lat, null, false);
    };
    const first = pack.stops[0]!.at;
    await feed(first[0], first[1], null, false);
    await stand(first[0], first[1]);
    for (let seg = 1; seg < pack.segments.length; seg++) {
      const pts = pack.segments[seg]!.map((p) => project(proj, p));
      const cum = cumulative(pts);
      const total = cum[cum.length - 1]!;
      for (let d = 0; d <= total; d += speed) {
        const at = pointAlong(pts, d, cum);
        const ll = unproject(proj, at.point);
        await feed(ll[0], ll[1], at.bearing, true);
      }
      const end = pack.stops[seg]!.at;
      await feed(end[0], end[1], null, false);
      await stand(end[0], end[1]);
    }
    for (let i = 0; i < 600 && s.playing() !== null; i++) await feed(pack.stops.at(-1)!.at[0], pack.stops.at(-1)!.at[1], null, false);
    vi.setSystemTime(clock);
    recorder.end();
    await s.finish();
    const text = JSON.stringify(recorder.recording);
    writeFileSync(new URL("royal-docks-5ms-noise4.json", FIXTURES), text);
    console.log(`fixture: ${recorder.recording.fixes.length} fixes, ${recorder.recording.events.length} events, ${recorder.recording.log.length} log entries, ${(text.length / 1024).toFixed(0)} KB`);
    expect(s.engine.state.status).toBe("finished");
  }, 600_000);

  it.runIf(process.env.MAKE_FIXTURE === "jitter")("make the jittered fixture", async () => {
    const pack = packOf("chelsea-loop");
    const T0 = 1_700_000_000_000;
    const speed = 4.5;
    const model = createJitter(11, "urban");
    const proj = makeProjection(pack.stops[0]!.at);
    useStorage(memoryStorage());
    vi.setSystemTime(T0);
    const recorder = beginRecording({ packId: pack.id, version: null, startAt: 0, app: "simulated" });
    const s = session(pack, 0, T0);
    const unlog = s.log.push.bind(s.log);
    s.log.push = (...e: DirectorLogEntry[]): number => { for (const x of e) recorder.log(x); return unlog(...e); };
    let clock = T0;
    const feed = async (lng: number, lat: number, heading: number | null, moving: boolean): Promise<void> => {
      for (const r of model.next({ p: project(proj, [lng, lat]), time: clock, speed: moving ? speed : 0, heading: moving ? heading : null })) {
        const q = unproject(proj, r.p);
        const fix: Fix = {
          lng: Math.round(q[0] * 1e6) / 1e6, lat: Math.round(q[1] * 1e6) / 1e6, accuracy: Math.round(r.accuracy * 10) / 10,
          heading: r.heading === null ? null : Math.round(r.heading), speed: r.speed === null ? null : Math.round(r.speed * 10) / 10, time: r.time, receivedAt: r.receivedAt,
        };
        recorder.fix(fix);
        recorder.events(clock, await s.feed(fix));
      }
      clock += 1000;
    };
    const stand = async (lng: number, lat: number): Promise<void> => {
      for (let i = 0; i < 4 && s.playing() === null; i++) await feed(lng, lat, null, false);
      for (let g = 0; s.playing()?.kind === "story" && g < 3600; g++) await feed(lng, lat, null, false);
    };
    const first = pack.stops[0]!.at;
    await feed(first[0], first[1], null, false);
    await stand(first[0], first[1]);
    for (let seg = 1; seg < pack.segments.length; seg++) {
      const pts = pack.segments[seg]!.map((p) => project(proj, p));
      const cum = cumulative(pts);
      const total = cum[cum.length - 1]!;
      for (let d = 0; d <= total; d += speed) {
        const at = pointAlong(pts, d, cum);
        const ll = unproject(proj, at.point);
        await feed(ll[0], ll[1], at.bearing, true);
      }
      const end = pack.stops[seg]!.at;
      await feed(end[0], end[1], null, false);
      await stand(end[0], end[1]);
    }
    for (let i = 0; i < 600 && s.playing() !== null; i++) await feed(pack.stops.at(-1)!.at[0], pack.stops.at(-1)!.at[1], null, false);
    vi.setSystemTime(clock);
    recorder.end();
    await s.finish();
    const text = JSON.stringify(recorder.recording);
    writeFileSync(new URL("chelsea-loop-urban-jitter.json", FIXTURES), text);
    console.log(`fixture: ${recorder.recording.fixes.length} fixes, ${recorder.recording.events.length} events, ${recorder.recording.log.length} log entries, ${(text.length / 1024).toFixed(0)} KB`);
    expect(s.engine.state.status).toBe("finished");
    expect(s.log.filter((e) => e.what === "off_route" || e.what === "wrong_way")).toEqual([]);
  }, 600_000);
});
