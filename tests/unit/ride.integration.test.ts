/**
 * Dead-end hunt without a browser: the real engine and the real director ride the whole Thames Loop together,
 * with the virtual mixer and fake timers. One simulated second per fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packJson from "../../public/packs/thames-loop/pack.json";
import { createMixer } from "../../src/audio/mixer";
import { createNavEngine } from "../../src/nav/engine";
import { createDirector } from "../../src/story/director";
import { cumulative, makeProjection, pointAlong, project, unproject } from "../../src/geo";
import { DEFAULT_SETTINGS, type DirectorLogEntry, type Fix, type NowPlaying, type Pack, type Settings } from "../../src/types";

const pack = packJson as unknown as Pack;

interface RideResult { log: DirectorLogEntry[]; arrived: number[]; status: string; overlaps: string[]; seconds: number; late: string[]; leads: number[] }

/** Ride every segment at `speed` m/s. The rider stands still while a story plays at a stop, as a real one would. */
async function ride(speed: number, patch: Partial<Settings> = {}, fromSeg = 1): Promise<RideResult> {
  const settings = { ...DEFAULT_SETTINGS, ...patch };
  const proj = makeProjection(pack.stops[0]!.at);
  let clock = 1_700_000_000_000;
  const log: DirectorLogEntry[] = [];
  const overlaps: string[] = [];
  let now: NowPlaying = null;
  /** Turns first heard at the turn itself, and for the others the metres of warning given. */
  const late: string[] = [];
  const leads: number[] = [];
  const warned = new Set<string>();
  const mixer = createMixer({ baseUrl: "", virtual: true });
  const engine = createNavEngine(pack);
  const director = createDirector({
    pack, mixer, settings: () => settings, clock: () => clock, timeScale: 1,
    onNowPlaying: (n) => { now = n; }, onLog: (e) => log.push(e),
  });
  const feed = async (lng: number, lat: number, heading: number | null, moving: boolean): Promise<void> => {
    const fix: Fix = { lng, lat, accuracy: 6, heading, speed: moving ? speed : 0, time: clock };
    const events = engine.update(fix);
    for (const e of events) {
      if (e.type !== "cue" || e.cue.turn === "depart" || e.cue.quiet) continue;
      if (e.phase === "approach") { warned.add(e.cue.id); leads.push(engine.state.toCue ?? 0); }
      else if (!warned.has(e.cue.id)) late.push(e.cue.id);
    }
    director.handle(events, engine.state);
    clock += 1000;
    await vi.advanceTimersByTimeAsync(1000);
  };
  const standWhileStory = async (lng: number, lat: number): Promise<void> => {
    let guard = 0;
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
    for (let d = 0; d <= total; d += speed) {
      const at = pointAlong(pts, d, cum);
      const ll = unproject(proj, at.point);
      await feed(ll[0], ll[1], at.bearing, true);
    }
    const end = pack.stops[seg]!.at;
    await feed(end[0], end[1], null, false);
    await standWhileStory(end[0], end[1]);
  }
  // let any last story finish
  for (let i = 0; i < 600 && now !== null; i++) await feed(pack.stops.at(-1)!.at[0], pack.stops.at(-1)!.at[1], null, false);
  const result = { log, arrived: [...engine.state.arrived], status: engine.state.status, overlaps, seconds: (clock - 1_700_000_000_000) / 1000, late, leads };
  director.dispose();
  return result;
}

const ids = (log: DirectorLogEntry[], what: DirectorLogEntry["what"]) => log.filter((e) => e.what === what).map((e) => e.id!);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("whole rides, engine and director together", () => {
  it("an easy ride: every stop, every turn once, every core story, sparse asides", async () => {
    const r = await ride(4.5);
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
  }, 120_000);

  it("a fast rider still hears every turn", async () => {
    const r = await ride(9);
    expect(r.status).toBe("finished");
    const spoken = ids(r.log, "cue_spoken");
    const mustSpeak = pack.cues.filter((c) => !c.quiet).map((c) => c.id);
    expect(mustSpeak.filter((id) => !spoken.includes(id))).toEqual([]);
    expect(r.log.some((e) => e.what === "wrong_way")).toBe(false);
    expect(r.late).toEqual([]);
    expect(Math.min(...r.leads)).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it("rich mode plays more passing-by stories than sparse, and off plays none", async () => {
    const sparse = (await ride(4.5)).log.filter((e) => e.what === "aside_played").length;
    const rich = (await ride(4.5, { asides: "rich" })).log.filter((e) => e.what === "aside_played").length;
    const off = (await ride(4.5, { asides: "off" })).log.filter((e) => e.what === "aside_played").length;
    expect(rich).toBeGreaterThan(sparse);
    expect(off).toBe(0);
  }, 240_000);

  it("with auto-play off no story starts, and the ride still completes", async () => {
    const r = await ride(4.5, { autoPlayStories: false });
    expect(r.status).toBe("finished");
    expect(ids(r.log, "story_start")).toEqual([]);
  }, 120_000);

  it("joining at Island Gardens rides the second half", async () => {
    const r = await ride(4.5, {}, 7);
    expect(r.status).toBe("finished");
    expect(ids(r.log, "arrive").map(Number).filter((n) => n >= 7)).toEqual([7, 8, 9, 10, 11, 12]);
  }, 120_000);

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
