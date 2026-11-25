/**
 * On demand only: a sweep of the position filter's tuning over jittered whole rides of every pack (engine only, no
 * director), as used to choose DEFAULT_TUNING in src/nav/filter.ts (docs/build/it7-32-jitter-hunt.md). For each set of
 * tuning it prints false alarms, turns never said (with the GPS gap seconds near each), turns first said at the turn,
 * marker leaps and back-slides, and the marker's 95th percentile error.
 *   SWEEP='{"now":{},"wider":{"softGate":12,"hardGate":40}}' npx vitest run tests/unit/jitter-sweep.test.ts
 * RIDES='[["chelsea-loop",4.5,1]]' picks the rides; TRACE=1 prints the fixes before a false alarm, BACKTRACE=1 before
 * a back-slide, and WINDOW=a,b (with TRACE) every fix between ride seconds a and b.
 */
import { it } from "vitest";
import { createNavEngine } from "../../src/nav/engine";
import { createJitter } from "../../src/nav/jitter";
import { cumulative, makeProjection, nearestOnPolyline, pointAlong, project, unproject, type XY } from "../../src/geo";
import type { FilterTuning } from "../../src/nav/filter";
import { PACKS, loaded } from "./packs";
import type { Fix, NavEvent } from "../../src/types";

function rideOnce(pid: string, speed: number, seed: number, tune: Partial<FilterTuning>) {
  const pack = loaded(PACKS.find((p) => p.entry.id === pid)!);
  const proj = makeProjection(pack.stops[0]!.at);
  const engine = createNavEngine(pack, {}, tune);
  const model = createJitter(seed, "urban");
  let clock = 1_700_000_000_000;
  const out = { alarms: 0, missing: 0, late: 0, errs: [] as number[], leaps: 0, worstLeap: 0, backs: 0, worstBack: 0 };
  const now = new Set<string>(), appr = new Set<string>();
  let prevSh: XY | null = null, prevT: XY | null = null, prevShAlong: number | null = null;
  const hist: string[] = [];
  const gaps = new Set<number>();
  const passed = new Map<string, number>();
  for (let seg = 1; seg < pack.segments.length; seg++) {
    const pts = pack.segments[seg]!.map((p) => project(proj, p));
    const cum = cumulative(pts);
    const total = cum[cum.length - 1]!;
    const end = project(proj, pack.stops[seg]!.at);
    for (let d = 0; d <= total + speed * 70; d += speed) {
      const moving = d <= total;
      const at = moving ? pointAlong(pts, d, cum) : { point: end, bearing: 0 };
      const got = model.next({ p: at.point, time: clock, speed: moving ? speed : 0, heading: moving ? at.bearing : null });
      if (got.length === 0) gaps.add(clock);
      for (const c of pack.cues) if (c.seg === seg && !passed.has(c.id) && d >= cum[c.i]!) passed.set(c.id, clock);
      for (const r of got) {
        const ll = unproject(proj, r.p);
        const fix: Fix = { lng: ll[0], lat: ll[1], accuracy: r.accuracy, heading: r.heading, speed: r.speed, time: r.time, receivedAt: r.receivedAt };
        const ev: NavEvent[] = engine.update(fix);
        if (process.env.TRACE || process.env.BACKTRACE) {
          const st = engine.state; const pos = st.pos ? project(proj, st.pos) : r.p;
          hist.push(`${((clock - 1_700_000_000_000) / 1000).toFixed(0)}s seg${st.seg} ${st.status}${st.offRoute ? " OFF" : ""} along ${st.alongSeg.toFixed(0)} truthAlong ${d.toFixed(0)} offBy ${st.offBy.toFixed(1)} acc ${r.accuracy.toFixed(0)} raw-truth ${Math.hypot(r.p[0] - at.point[0], r.p[1] - at.point[1]).toFixed(0)} pos-truth ${Math.hypot(pos[0] - at.point[0], pos[1] - at.point[1]).toFixed(1)} sig ${st.posAccuracy?.toFixed(1)} spd ${r.speed?.toFixed(1)} hd ${r.heading?.toFixed(0)} ev ${ev.map((e) => e.type).join(",")}`);
          if (hist.length > 45) hist.shift();
          if (process.env.WINDOW) { const [a, b] = process.env.WINDOW.split(",").map(Number); const t = (clock - 1_700_000_000_000) / 1000; if (t >= a! && t <= b!) console.log(hist[hist.length - 1]); }
          if (process.env.TRACE && ev.some((e) => e.type === "off_route" || e.type === "wrong_way")) console.log(`--- ${pid} ${speed} ${seed}\n` + hist.join("\n"));
        }
        for (const e of ev) {
          if (e.type === "off_route" || e.type === "wrong_way" || e.type === "detour") out.alarms++;
          if (e.type === "cue" && e.phase === "approach") appr.add(e.cue.id);
          if (e.type === "cue" && e.phase === "now") { now.add(e.cue.id); if (!appr.has(e.cue.id) && e.cue.turn !== "depart") out.late++; }
        }
      }
      const st = engine.state;
      if (got.some((r) => r.time === clock) && st.status === "riding" && !st.offRoute && st.shown && moving) {
        const sh = project(proj, st.shown);
        out.errs.push(Math.hypot(sh[0] - at.point[0], sh[1] - at.point[1]));
        if (prevSh && prevT) { const leap = Math.hypot(sh[0] - prevSh[0], sh[1] - prevSh[1]) - Math.hypot(at.point[0] - prevT[0], at.point[1] - prevT[1]); if (leap > 15) out.leaps++; out.worstLeap = Math.max(out.worstLeap, leap); }
        const sa = nearestOnPolyline(pts, sh, cum, Math.max(0, d - 120), d + 120).along;
        if (prevShAlong !== null) {
          const back = prevShAlong - sa; if (back > 10) out.backs++; out.worstBack = Math.max(out.worstBack, back);
          if (back > 10 && process.env.BACKTRACE) console.log(`--- back ${back.toFixed(1)} ${pid} ${speed} ${seed} shownAlong ${sa.toFixed(0)} prev ${prevShAlong.toFixed(0)} truth ${d.toFixed(0)} shown-truth ${Math.hypot(sh[0] - at.point[0], sh[1] - at.point[1]).toFixed(1)}\n` + hist.slice(-6).join("\n"));
        }
        prevSh = sh; prevT = at.point; prevShAlong = sa;
      } else { prevSh = null; prevT = null; prevShAlong = null; }
      clock += 1000;
    }
  }
  const miss = pack.cues.filter((c) => !c.quiet && !now.has(c.id));
  out.missing = miss.length;
  const gapNear = (id: string) => { const t = passed.get(id); if (t === undefined) return "never passed"; let n = 0; for (let k = -8; k <= 2; k++) if (gaps.has(t + k * 1000)) n++; return `gap seconds near: ${n}, approach ${appr.has(id) ? "spoken" : "not spoken"}`; };
  if (miss.length || out.alarms) console.log(`  ${pid} ${speed} ${seed}: missing ${miss.map((c) => `${c.id} ${c.turn} ${c.say} (${gapNear(c.id)})`).join(" | ")} alarms ${out.alarms}`);
  return out;
}

it.runIf(process.env.SWEEP !== undefined)("sweep", () => {
  const sets: Record<string, Partial<FilterTuning>> = JSON.parse(process.env.SWEEP ?? '{"default":{}}');
  for (const [name, tune] of Object.entries(sets)) {
    const tot = { alarms: 0, missing: 0, late: 0, leaps: 0, backs: 0, worstLeap: 0, worstBack: 0, p95: [] as number[] };
    const rides = JSON.parse(process.env.RIDES ?? "null") as [string, number, number][] | null;
    const all: [string, number, number][] = rides ?? ["thames-loop", "royal-docks", "chelsea-loop"].flatMap((pid) => ([[4.5, 1], [4.5, 2], [7, 3], [7, 4], [3, 5]] as const).map(([sp, se]) => [pid, sp, se] as [string, number, number]));
    for (const [pid, speed, seed] of all) {
      const r = rideOnce(pid, speed, seed, tune);
      const e = [...r.errs].sort((a, b) => a - b);
      tot.alarms += r.alarms; tot.missing += r.missing; tot.late += r.late; tot.leaps += r.leaps; tot.backs += r.backs;
      tot.worstLeap = Math.max(tot.worstLeap, r.worstLeap); tot.worstBack = Math.max(tot.worstBack, r.worstBack);
      tot.p95.push(e[Math.floor(e.length * 0.95)]!);
    }
    console.log(`${name.padEnd(22)} alarms ${tot.alarms} missing ${tot.missing} late ${tot.late} leaps ${tot.leaps} (worst ${tot.worstLeap.toFixed(0)}) backs ${tot.backs} (worst ${tot.worstBack.toFixed(0)}) p95 max ${Math.max(...tot.p95).toFixed(1)} mean ${(tot.p95.reduce((a, b) => a + b, 0) / tot.p95.length).toFixed(1)}`);
  }
}, 600_000);
