/**
 * Dead-end hunt without a browser: the real engine and the real director ride every pack in the index together,
 * with the virtual mixer and fake timers. One simulated second per fix. The sound timeline the mixer records is
 * checked by tests/unit/timeline.ts. To see what happened around a flagged moment, run with HUNT_DEBUG set to ride
 * seconds, for example `HUNT_DEBUG=424,2896 npx vitest run tests/unit/ride.integration.test.ts -t "fast rider"`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMixer } from "../../src/audio/mixer";
import { createNavEngine } from "../../src/nav/engine";
import { createDirector } from "../../src/story/director";
import { createJitter } from "../../src/nav/jitter";
import { cumulative, dist, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type XY } from "../../src/geo";
import { DEFAULT_SETTINGS, type DirectorLogEntry, type Fix, type Mixer, type NowPlaying, type Pack, type Settings, type SoundEvent } from "../../src/types";
import { PACKS, loaded, segInfo, straySide } from "./packs";
import { bedAfterLeave, effectProblems, heldVoice, lateCues, speechOverlaps, waitedTooLong } from "./timeline";

/** How steady the rider's marker was against where the rider really was (jittered rides). */
interface Steadiness { p95: number; worstStep: string | null; worstBack: number; worstBackAt: string | null; samples: number }

interface RideResult {
  log: DirectorLogEntry[]; arrived: number[]; status: string; overlaps: string[]; seconds: number; late: string[]; leads: number[];
  steady: Steadiness; lateInGap: string[];
  /** Cues the rider passed while the phone gave no fix (a gap in the last 8 s before the turn): no app could time those. */
  gapCues: string[];
  /** The sound timeline, when the rider left each stop, when each turn was passed, and when the director stopped or paused the voice. */
  timeline: readonly SoundEvent[]; leaves: number[]; turnAt: Map<string, number>; deliberate: number[];
}

const T0 = 1_700_000_000_000;

/** Everything the sound timeline must show on a whole ride: the dead-end hunt of docs/build/it5-00-audio.md. */
function soundProblems(pack: Pack, r: RideResult): string[] {
  const dbg = process.env.HUNT_DEBUG;
  if (dbg) {
    for (const at of dbg.split(",").map(Number)) {
      const lo = T0 + (at - 20) * 1000, hi = T0 + (at + 8) * 1000;
      const rows = [
        ...r.timeline.filter((e) => e.at >= lo && e.at <= hi).map((e) => ({ at: e.at, s: `${e.ch} ${e.ev} ${e.src}${e.pos !== undefined ? " @" + e.pos.toFixed(2) : ""}` })),
        ...r.log.filter((e) => e.at >= lo && e.at <= hi).map((e) => ({ at: e.at, s: `LOG ${e.what} ${e.id ?? ""} ${e.reason ?? ""}` })),
        ...r.leaves.filter((t) => t >= lo && t <= hi).map((t) => ({ at: t, s: "LEAVE" })),
        ...[...r.turnAt].filter(([, t]) => t >= lo && t <= hi).map(([id, t]) => ({ at: t, s: `TURN ${id}` })),
      ].sort((a, b) => a.at - b.at);
      console.log(`--- ${pack.id} around ${at} s\n` + rows.map((x) => `${((x.at - T0) / 1000).toFixed(2).padStart(8)}  ${x.s}`).join("\n"));
    }
  }
  return [
    ...speechOverlaps(r.timeline, T0),
    ...lateCues(r.timeline, r.log, pack, 3500, T0),
    ...waitedTooLong(r.timeline, r.log, pack, r.turnAt, 5000, T0),
    ...heldVoice(r.timeline, r.deliberate, 1000, T0),
    ...bedAfterLeave(r.timeline, r.leaves, 30_000, T0),
    ...effectProblems(r.timeline, r.log, pack, 0.5),
  ];
}

/** A detour: at `at` (0 to 1) along segment `seg`, leave the line by `metres` towards heading `rad` for `seconds`, then come back. */
interface Detour { seg: number; at: number; metres: number; seconds: number; rad: number }

/**
 * The mixer, watched: a voice clip started while another is still sounding or paused is talking over it. Records when
 * the director stops, replaces or pauses the voice, so the hunt can tell a yield from a deliberate stop.
 */
function watched(inner: Mixer, overlaps: string[], clock: () => number, deliberate: number[]): Mixer {
  let current = "";
  return new Proxy(inner, {
    get(t, k) {
      if (k === "playVoice") {
        return (src: string, o?: Parameters<Mixer["playVoice"]>[1]) => {
          if (t.voiceBusy) overlaps.push(`${src} started over ${current} at ${Math.round((clock() - T0) / 1000)} s`);
          current = src;
          deliberate.push(clock());
          return t.playVoice(src, o);
        };
      }
      if (k === "stopVoice" || k === "pauseVoice" || k === "seekVoice") {
        const f = Reflect.get(t, k, t) as (...a: unknown[]) => unknown;
        return (...a: unknown[]) => { deliberate.push(clock()); return f.apply(t, a); };
      }
      const v: unknown = Reflect.get(t, k, t);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/**
 * Ride every segment at `speed` m/s. The rider stands still while a story plays at a stop, as a real one would. With
 * `jitter`, every true position goes through the urban GPS model of src/nav/jitter.ts (seeded) on its way to the engine.
 */
async function ride(pack: Pack, speed: number, patch: Partial<Settings> = {}, fromSeg = 1, detour: Detour | null = null, jitter: { seed: number } | null = null): Promise<RideResult> {
  const settings = { ...DEFAULT_SETTINGS, ...patch };
  const proj = makeProjection(pack.stops[0]!.at);
  // the mixer stamps its timeline with Date.now (faked), which runs in step with the ride's clock
  vi.setSystemTime(T0);
  let clock = T0;
  const leaves: number[] = [];
  const turnAt = new Map<string, number>();
  const deliberate: number[] = [];
  const log: DirectorLogEntry[] = [];
  const overlaps: string[] = [];
  let now: NowPlaying = null;
  /** Turns first heard at the turn itself, and for the others the metres of warning given. */
  const late: string[] = [];
  const leads: number[] = [];
  const warned = new Set<string>();
  const inner = createMixer({ baseUrl: "", virtual: true });
  const mixer = watched(inner, overlaps, () => Date.now(), deliberate);
  const engine = createNavEngine(pack);
  const director = createDirector({
    pack, mixer, settings: () => settings, clock: () => Date.now(), timeScale: 1,
    onNowPlaying: (n) => { now = n; }, onLog: (e) => log.push(e),
  });
  const model = jitter ? createJitter(jitter.seed, "urban") : null;
  /** When the GPS last gave nothing for a second, and the late cues that a gap explains. */
  let lastGap = -Infinity;
  const lateInGap: string[] = [];
  const gapSeconds = new Set<number>();
  /** When the rider really passed each cue. */
  const passAt = new Map<string, number>();
  const segPts = pack.segments.map((line) => { const pts = line.map((q) => project(proj, q)); return { pts, cum: cumulative(pts) }; });
  const offs: number[] = [];
  let worstStep: { by: number; at: number } | null = null;
  let worstBack = 0;
  let worstBackAt: string | null = null;
  let prevShown: XY | null = null;
  let prevTruth: XY | null = null;
  /** The drawn marker's place along the line at the previous sampled second. */
  let prevAlong: { seg: number; along: number } | null = null;
  const trace: string[] = [];
  let traceTruth: XY = [0, 0];
  const feedOne = (fix: Fix): void => {
    const events = engine.update(fix);
    if (process.env.HUNT_TRACE) {
      const st = engine.state;
      const raw = project(proj, [fix.lng, fix.lat]);
      const pos = st.pos ? project(proj, st.pos) : raw;
      const d = (a: XY, b: XY): string => Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(0);
      trace.push(`${((clock - T0) / 1000).toFixed(0)}s seg${st.seg} ${st.status}${st.offRoute ? " OFF" : ""} along ${st.alongSeg.toFixed(0)} offBy ${st.offBy.toFixed(1)} acc ${fix.accuracy.toFixed(0)} raw-truth ${d(raw, traceTruth)} pos-truth ${d(pos, traceTruth)} truth ${traceTruth.map((v) => v.toFixed(0))} pos ${pos.map((v) => v.toFixed(0))} sigma ${(st.posAccuracy ?? 0).toFixed(1)} spd ${fix.speed?.toFixed(1)} hd ${fix.heading?.toFixed(0)} ev ${events.map((e) => e.type).join(",")}`);
      if (trace.length > 60) trace.shift();
      const win = process.env.HUNT_WINDOW?.split(",").map(Number);
      if (win && (clock - T0) / 1000 >= win[0]! && (clock - T0) / 1000 <= win[1]!) {
        const sh = st.shown ? project(proj, st.shown) : raw;
        const g = segPts[st.seg]!;
        console.log(`${trace[trace.length - 1]} shown-truth ${d(sh, traceTruth)} shownAlong ${nearestOnPolyline(g.pts, sh, g.cum, st.alongSeg - 150, st.alongSeg + 150).along.toFixed(0)} hd ${st.shownHeading?.toFixed(0)} route ${st.routeBearing?.toFixed(0)}`);
      }
      if (events.some((e) => e.type === "off_route" || e.type === "wrong_way")) console.log(`--- ${pack.id} ${events.map((e) => e.type).join(",")}\n${trace.join("\n")}`);
    }
    const passed = engine.state.currentCue?.id;
    if (passed && !turnAt.has(passed)) turnAt.set(passed, clock);
    for (const e of events) {
      if (e.type === "leave") leaves.push(clock);
      if (e.type !== "cue" || e.cue.turn === "depart" || e.cue.quiet) continue;
      if (e.phase === "approach") { warned.add(e.cue.id); leads.push(engine.state.toCue ?? 0); }
      // "Continue onto ..." heard at the junction itself asks nothing of the rider: only real turns must be warned of
      else if (!warned.has(e.cue.id) && e.cue.turn !== "straight") {
        // a phone that gave no fix while the rider passed the warning point cannot warn: that is the GPS, not a dead end
        if (clock - lastGap <= 12_000) lateInGap.push(e.cue.id);
        else late.push(e.cue.id);
      }
    }
    director.handle(events, engine.state);
  };
  const feed = async (lng: number, lat: number, heading: number | null, moving: boolean): Promise<void> => {
    if (!model) feedOne({ lng, lat, accuracy: 6, heading, speed: moving ? speed : 0, time: clock });
    else {
      const truth = project(proj, [lng, lat]);
      traceTruth = truth;
      const got = model.next({ p: truth, time: clock, speed: moving ? speed : 0, heading: moving ? heading : null });
      for (const r of got) {
        const ll = unproject(proj, r.p);
        feedOne({ lng: ll[0], lat: ll[1], accuracy: r.accuracy, heading: r.heading, speed: r.speed, time: r.time, receivedAt: r.receivedAt });
      }
      if (got.length === 0) { lastGap = clock; gapSeconds.add(clock); }
      // the marker against the truth, while riding the line, at the seconds the phone gave a fix (in a gap it cannot move)
      const st = engine.state;
      if (got.some((r) => r.time === clock) && st.status === "riding" && !st.offRoute && st.shown) {
        const shown = project(proj, st.shown);
        offs.push(Math.hypot(shown[0] - truth[0], shown[1] - truth[1]));
        if (process.env.HUNT_ERRS && offs[offs.length - 1]! > Number(process.env.HUNT_ERRS)) console.log(`err ${offs[offs.length - 1]!.toFixed(1)} | ${trace[trace.length - 1] ?? ""}`);
        if (prevShown && prevTruth) {
          const step = Math.hypot(shown[0] - prevShown[0], shown[1] - prevShown[1]) - Math.hypot(truth[0] - prevTruth[0], truth[1] - prevTruth[1]);
          if (!worstStep || step > worstStep.by) worstStep = { by: step, at: clock };
        }
        const g = segPts[st.seg]!;
        const along = nearestOnPolyline(g.pts, shown, g.cum, st.alongSeg - 150, st.alongSeg + 150).along;
        // back along the line as far as the marker really moved: where the line folds back on itself near a stop, a
        // marker that hardly moves can project onto the other fold
        const back = moving && prevAlong && prevShown && prevAlong.seg === st.seg ? Math.min(prevAlong.along - along, dist(shown, prevShown)) : 0;
        if (prevAlong && back > worstBack) {
          worstBack = back;
          worstBackAt = `${(clock - T0) / 1000} s, segment ${st.seg}, ${prevAlong.along.toFixed(0)} m to ${along.toFixed(0)} m`;
        }
        prevShown = shown; prevTruth = truth; prevAlong = { seg: st.seg, along };
      } else { prevShown = null; prevTruth = null; prevAlong = null; }
    }
    clock += 1000;
    await vi.advanceTimersByTimeAsync(1000);
  };
  const standWhileStory = async (lng: number, lat: number): Promise<void> => {
    let guard = 0;
    // the first story follows "Arriving at" after a short lead (src/story/director.ts): stand through it
    for (let i = 0; i < 4 && (now as NowPlaying) === null; i++) await feed(lng, lat, null, false);
    // stand while a story of this stop plays, wherever the status says the rider is
    while ((now as NowPlaying)?.kind === "story") {
      await feed(lng, lat, null, false);
      if (++guard > 3600) { overlaps.push("a story at a stop ran for over an hour"); break; }
    }
  };

  // start standing at the first stop of the ride
  const start = pack.stops[fromSeg - 1]!.at;
  await feed(start[0], start[1], null, false);
  await standWhileStory(start[0], start[1]);
  for (let seg = fromSeg; seg < pack.segments.length; seg++) {
    const pts = pack.segments[seg]!.map((p) => project(proj, p));
    const cum = cumulative(pts);
    const total = cum[cum.length - 1]!;
    let strayed = false;
    for (let d = 0; d <= total; d += speed) {
      const at = pointAlong(pts, d, cum);
      for (const c of pack.cues) if (c.seg === seg && !passAt.has(c.id) && d >= cum[c.i]!) passAt.set(c.id, clock);
      if (detour && !strayed && seg === detour.seg && d >= total * detour.at) {
        strayed = true;
        // out sideways, wait off the line, and back to the same point
        const rad = detour.rad;
        const steps = Math.ceil(detour.metres / speed);
        const path: number[] = [];
        for (let i = 1; i <= steps; i++) path.push((detour.metres * i) / steps);
        for (let i = 0; i < detour.seconds; i++) path.push(detour.metres);
        for (let i = steps - 1; i >= 0; i--) path.push((detour.metres * i) / steps);
        for (const off of path) {
          const q = unproject(proj, [at.point[0] + Math.sin(rad) * off, at.point[1] + Math.cos(rad) * off] as never);
          await feed(q[0], q[1], null, true);
        }
      }
      const ll = unproject(proj, at.point);
      await feed(ll[0], ll[1], at.bearing, true);
    }
    const end = pack.stops[seg]!.at;
    await feed(end[0], end[1], null, false);
    await standWhileStory(end[0], end[1]);
  }
  // let any last story finish
  for (let i = 0; i < 600 && now !== null; i++) await feed(pack.stops.at(-1)!.at[0], pack.stops.at(-1)!.at[1], null, false);
  // let the bed fade and the last sounds finish
  for (let i = 0; i < 40; i++) { clock += 1000; await vi.advanceTimersByTimeAsync(1000); }
  const sorted = [...offs].sort((a, b) => a - b);
  const ws = worstStep as { by: number; at: number } | null;
  const result: RideResult = {
    log, arrived: [...engine.state.arrived], status: engine.state.status, overlaps, seconds: (clock - T0) / 1000, late, leads,
    timeline: [...inner.timeline], leaves, turnAt, deliberate, lateInGap,
    gapCues: [...passAt].filter(([, t]) => [...gapSeconds].some((g) => g >= t - 8000 && g <= t + 2000)).map(([id]) => id),
    steady: { p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)]! : 0, worstStep: ws ? `${ws.by.toFixed(1)} m at ${(ws.at - T0) / 1000} s` : null, worstBack, worstBackAt, samples: offs.length },
  };
  director.dispose();
  return result;
}

const ids = (log: DirectorLogEntry[], what: DirectorLogEntry["what"]) => log.filter((e) => e.what === what).map((e) => e.id!);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** The segment nearest the middle of the ride with room for a 150 m detour half way along, and the side to take. */
function detourAt(pack: Pack): { seg: number; rad: number } {
  const mid = Math.floor(pack.segments.length / 2);
  for (let k = 0; k < pack.segments.length; k++) {
    for (const i of [mid + k, mid - k]) {
      if (i < 1 || i >= pack.segments.length) continue;
      const { length, ridden } = segInfo(pack, i);
      if (!ridden || length < 600) continue;
      const rad = straySide(pack, i, length / 2, 150, 120);
      if (rad !== null) return { seg: i, rad };
    }
  }
  throw new Error(`${pack.id} has no segment with room for a detour`);
}

describe.each(PACKS.map((p) => [p.entry.id, p] as const))("whole rides of %s, engine and director together", (_id, entry) => {
  const pack = loaded(entry);
  const half = Math.floor(pack.stops.length / 2) + 1;

  it("an easy ride: every stop, every turn once, every core story, sparse asides", async () => {
    const r = await ride(pack, 4.5);
    expect(r.status).toBe("finished");
    expect(r.arrived).toEqual(pack.stops.map((_, i) => i));
    expect(ids(r.log, "arrive")).toEqual(pack.stops.map((_, i) => String(i)));

    const spoken = ids(r.log, "cue_spoken");
    expect(new Set(spoken).size).toBe(spoken.length);
    const mustSpeak = pack.cues.filter((c) => !c.quiet).map((c) => c.id);
    expect(mustSpeak.filter((id) => !spoken.includes(id))).toEqual([]);
    expect(ids(r.log, "cue_shown").sort()).toEqual(pack.cues.filter((c) => c.quiet).map((c) => c.id).sort());

    const started = ids(r.log, "story_start");
    const core = pack.stops.flatMap((s) => s.stories.filter((x) => x.kind === "core").map((x) => x.id));
    expect(core.filter((id) => !started.includes(id))).toEqual([]);
    // optional stories never start by themselves
    const optional = pack.stops.flatMap((s) => s.stories.filter((x) => x.kind === "optional").map((x) => x.id));
    expect(started.filter((id) => optional.includes(id))).toEqual([]);
    // every story that started also ended: none cut off by the next arrival
    expect(ids(r.log, "story_stopped")).toEqual([]);
    expect(ids(r.log, "story_end").sort()).toEqual([...started].sort());

    const played = r.log.filter((e) => e.what === "aside_played");
    expect(played.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < played.length; i++) expect((played[i]!.at - played[i - 1]!.at) / 1000).toBeGreaterThanOrEqual(300);
    expect(r.log.some((e) => e.what === "off_route")).toBe(false);
    // a rider on the line is never told they are riding against it, wherever the line doubles back
    expect(r.log.some((e) => e.what === "wrong_way")).toBe(false);
    // no turn is first heard at the turn itself, and every warning comes with room to act on it
    expect(r.late).toEqual([]);
    expect(Math.min(...r.leads)).toBeGreaterThanOrEqual(20);
    expect(r.overlaps).toEqual([]);
    expect(soundProblems(pack, r)).toEqual([]);
  }, 120_000);

  it("a fast rider still hears every turn", async () => {
    const r = await ride(pack, 9);
    expect(r.status).toBe("finished");
    const spoken = ids(r.log, "cue_spoken");
    const mustSpeak = pack.cues.filter((c) => !c.quiet).map((c) => c.id);
    expect(mustSpeak.filter((id) => !spoken.includes(id))).toEqual([]);
    expect(r.log.some((e) => e.what === "wrong_way")).toBe(false);
    expect(r.late).toEqual([]);
    expect(Math.min(...r.leads)).toBeGreaterThanOrEqual(20);
    expect(soundProblems(pack, r)).toEqual([]);
  }, 120_000);

  it("a walker on the last stretch: the sound timeline holds at walking pace", async () => {
    const from = Math.max(1, pack.stops.length - 3);
    const r = await ride(pack, 1.4, {}, from);
    expect(r.status).toBe("finished");
    expect(soundProblems(pack, r)).toEqual([]);
  }, 180_000);

  it("rich mode plays more passing-by stories than sparse, and off plays none", async () => {
    const sparse = (await ride(pack, 4.5)).log.filter((e) => e.what === "aside_played").length;
    const rich = (await ride(pack, 4.5, { asides: "rich" })).log.filter((e) => e.what === "aside_played").length;
    const off = (await ride(pack, 4.5, { asides: "off" })).log.filter((e) => e.what === "aside_played").length;
    expect(rich).toBeGreaterThan(sparse);
    expect(off).toBe(0);
  }, 240_000);

  it("with auto-play off no story starts, and the ride still completes", async () => {
    const r = await ride(pack, 4.5, { autoPlayStories: false });
    expect(r.status).toBe("finished");
    expect(ids(r.log, "story_start")).toEqual([]);
  }, 120_000);

  it(`joining at stop ${half - 1} rides the second half`, async () => {
    const r = await ride(pack, 4.5, {}, half);
    expect(r.status).toBe("finished");
    expect(ids(r.log, "arrive").map(Number).filter((n) => n >= half)).toEqual(pack.stops.map((_, i) => i).filter((i) => i >= half));
    expect(r.overlaps).toEqual([]);
    expect(soundProblems(pack, r)).toEqual([]);
  }, 120_000);

  it("a slow rider who strays 150 m off the route for a minute is told, comes back and still finishes", async () => {
    const { seg, rad } = detourAt(pack);
    const r = await ride(pack, 3, {}, 1, { seg, at: 0.5, metres: 150, seconds: 60, rad });
    expect(r.status).toBe("finished");
    expect(r.arrived).toEqual(pack.stops.map((_, i) => i));
    expect(r.log.filter((e) => e.what === "off_route").length, `one off route on segment ${seg}`).toBe(1);
    expect(r.log.filter((e) => e.what === "back_on_route").length).toBe(1);
    const spoken = ids(r.log, "cue_spoken");
    expect(new Set(spoken).size).toBe(spoken.length);
    expect(pack.cues.filter((c) => !c.quiet && !spoken.includes(c.id)).map((c) => c.id)).toEqual([]);
    expect(r.overlaps).toEqual([]);
    expect(soundProblems(pack, r)).toEqual([]);
  }, 180_000);

  // The class check for issue 1 of iteration 7: a GPS that jumps about in a city must not move the marker or make
  // the engine say off route, wrong way or rerouting, and every stop, turn and core story must still come.
  it.each([[4.5, 1], [4.5, 2], [7, 3], [7, 4]])("urban GPS jitter at %s m/s (seed %s): no false alarms, everything said, a steady marker", async (speed, seed) => {
    const r = await ride(pack, speed, {}, 1, null, { seed });
    expect(r.status).toBe("finished");
    expect(ids(r.log, "arrive")).toEqual(pack.stops.map((_, i) => String(i)));
    for (const what of ["off_route", "wrong_way", "detour", "back_on_route"] as const) expect(ids(r.log, what), `no ${what} in jitter`).toEqual([]);
    const spoken = ids(r.log, "cue_spoken");
    expect(new Set(spoken).size).toBe(spoken.length);
    // a turn the rider reached in a GPS gap stays unsaid (said after it, it would send the rider down the wrong street);
    // the rider is still never sent off route for it, which the checks above make sure of
    const unsaid = pack.cues.filter((c) => !c.quiet && !spoken.includes(c.id)).map((c) => c.id);
    expect(unsaid.filter((id) => !r.gapCues.includes(id)), "turns never spoken").toEqual([]);
    expect(unsaid.length, `GPS gaps explain only a few unsaid turns (${unsaid.join(", ")})`).toBeLessThanOrEqual(3);
    expect(r.late, "turns first heard at the turn").toEqual([]);
    const core = pack.stops.flatMap((st) => st.stories.filter((x) => x.kind === "core").map((x) => x.id));
    expect(core.filter((id) => !ids(r.log, "story_start").includes(id)), "core stories never played").toEqual([]);
    expect(ids(r.log, "story_stopped"), "stories cut off").toEqual([]);
    expect(r.steady.samples).toBeGreaterThan(500);
    // at 7 m/s a GPS gap of several seconds that ends in a multipath spell pulls the estimate off for a while (see
    // docs/build/iteration-7-rounds.md): the bound is wider there
    const p95Max = speed >= 7 ? 18 : 15;
    expect(r.steady.p95, `the marker within ${p95Max} m of the rider, 95 percent of the time`).toBeLessThan(p95Max);
    const step = r.steady.worstStep ? Number(r.steady.worstStep.split(" ")[0]) : 0;
    expect(step, `the marker never leaps more than 15 m beyond the rider's own movement (${r.steady.worstStep})`).toBeLessThan(15);
    // back along the line no further than a leap: where the line folds back past itself the marker can hop to the
    // right fold (11 m at worst in these rides); before the hold it slid back 30 m in multipath
    expect(r.steady.worstBack, `the marker never slides back along the line by more than 15 m (${r.steady.worstBackAt})`).toBeLessThan(15);
    expect(soundProblems(pack, r)).toEqual([]);
  }, 240_000);

  it("a real detour in urban GPS jitter is still caught, once, and the ride finishes", async () => {
    const { seg, rad } = detourAt(pack);
    const r = await ride(pack, 4, {}, 1, { seg, at: 0.5, metres: 250, seconds: 30, rad }, { seed: 5 });
    expect(r.status).toBe("finished");
    expect(r.arrived).toEqual(pack.stops.map((_, i) => i));
    expect(r.log.filter((e) => e.what === "off_route").length, `one off route on segment ${seg}`).toBe(1);
    expect(r.log.filter((e) => e.what === "back_on_route").length).toBe(1);
  }, 240_000);

  it("at every stop the rider counts as at the stop until they ride away", async () => {
    // A route that doubles back past its own stop once made the engine think the rider had left at once (Deptford).
    const engine = createNavEngine(pack);
    const proj = makeProjection(pack.stops[0]!.at);
    let clock = 1_700_000_000_000;
    const start = pack.stops[0]!.at;
    engine.update({ lng: start[0], lat: start[1], accuracy: 6, heading: null, speed: 0, time: clock });
    for (let seg = 1; seg < pack.segments.length; seg++) {
      const pts = pack.segments[seg]!.map((q) => project(proj, q));
      const cum = cumulative(pts);
      const total = cum[cum.length - 1]!;
      for (let d = 0; d <= total; d += 4) {
        const ll = unproject(proj, pointAlong(pts, d, cum).point);
        clock += 1000;
        engine.update({ lng: ll[0], lat: ll[1], accuracy: 6, heading: null, speed: 4, time: clock });
      }
      if (seg === pack.segments.length - 1) break;
      // stand at the stop for a minute: still at the stop, no premature leave
      const end = pack.stops[seg]!.at;
      for (let i = 0; i < 60; i++) {
        clock += 1000;
        const events = engine.update({ lng: end[0], lat: end[1], accuracy: 6, heading: null, speed: 0, time: clock });
        expect(events.filter((e) => e.type === "leave"), `no leave while standing at stop ${seg}`).toEqual([]);
      }
      expect(engine.state.status, `status while standing at stop ${seg}`).toBe("at_stop");
    }
  }, 120_000);
});
