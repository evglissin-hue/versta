/**
 * A stop arrives when the rider gets there, never on the way in. Found by the iteration 5 dead-end hunt: at East India
 * Dock the cycle path runs 45 m past the stop before the line turns down a spur to it, and the engine called the
 * arrival there, 158 m early; the rider then heard the next leg's turns and "wrong way" on the spur. This rides every
 * segment of every pack with each fix pulled towards the stop it is heading for, as a GPS error in the worst
 * direction, and checks that after every arrival the rest of the line stays close to the stop (the rider is not still
 * to ride away from it and back) and that every turn on the way is spoken.
 *
 * The same hunt found the second half of the class: at the Twelvetrees Crescent hairpin the line comes back 12 m from
 * where it went out, and 6 m of GPS error matched the leg coming back, so the sharp left was never spoken. Every turn
 * must also be spoken with the fixes a steady few metres to either side of the line.
 */
import { describe, expect, it } from "vitest";
import { cumulative, makeProjection, pointAlong, project, unproject, type XY } from "../../src/geo";
import { createNavEngine } from "../../src/nav/engine";
import type { Fix, NavEvent, Pack } from "../../src/types";
import { PACKS, loaded } from "./packs";

const T0 = 1_700_000_000_000;
const STEP = 4;
/** The worst GPS error the check allows for, in metres, all of it towards the stop. */
const PULL = 15;
/** After an arrival, how much farther than its radius the rest of the line may still lead from the stop. */
const AHEAD_OK = 15 + STEP;
/** Steady GPS error to one side of the line, in metres. */
const SIDE = 8;

type Error_ = (pt: XY, bearing: number, stop: XY) => XY;

/** Pulled towards the stop the rider is heading for, by up to PULL metres. */
const towardsStop: Error_ = (pt, _b, stop) => {
  const dx = stop[0] - pt[0], dy = stop[1] - pt[1];
  const far = Math.hypot(dx, dy);
  const k = far > 0 ? Math.min(PULL, far) / far : 0;
  return [pt[0] + dx * k, pt[1] + dy * k];
};
/** A steady `m` metres to the right of the direction of travel (negative: to the left). */
const sideways = (m: number): Error_ => (pt, b) => {
  const r = (b + 90) * (Math.PI / 180);
  return [pt[0] + Math.sin(r) * m, pt[1] + Math.cos(r) * m];
};

interface Ride { problems: string[]; arrived: number[]; unheard: string[] }

/** Ride every segment of the pack with this GPS error, standing a few seconds at each stop. */
function ride(pack: Pack, error: Error_): Ride {
  const proj = makeProjection(pack.stops[0]!.at);
  const engine = createNavEngine(pack);
  const problems: string[] = [];
  const heard = new Set<string>();
  const arrived: number[] = [];
  let t = T0;
  const feed = (xy: XY, heading: number | null, speed: number): NavEvent[] => {
    const ll = unproject(proj, xy);
    const fix: Fix = { lng: ll[0], lat: ll[1], accuracy: 6, heading, speed, time: (t += 1000) };
    const ev = engine.update(fix);
    for (const e of ev) {
      if (e.type === "cue") heard.add(e.cue.id);
      if (e.type === "wrong_way" || e.type === "off_route") problems.push(`${e.type} at ${((t - T0) / 1000).toFixed(0)} s, riding along the line`);
    }
    return ev;
  };
  feed(project(proj, pack.stops[0]!.at), null, 0);
  arrived.push(0);
  for (let seg = 1; seg < pack.segments.length; seg++) {
    const pts = pack.segments[seg]!.map((q) => project(proj, q));
    const cum = cumulative(pts);
    const len = cum[cum.length - 1]!;
    const stop = project(proj, pack.stops[seg]!.at);
    const radius = pack.stops[seg]!.arriveRadius;
    for (let d = 0; ; d = Math.min(len, d + STEP)) {
      const pa = pointAlong(pts, d, cum);
      for (const e of feed(error(pa.point, pa.bearing, stop), pa.bearing, STEP)) {
        if (e.type !== "arrive") continue;
        arrived.push(e.stop);
        if (e.stop !== seg) continue;
        const far = Math.max(...pts.filter((_, i) => cum[i]! > d).map((q) => Math.hypot(q[0] - stop[0], q[1] - stop[1])), 0);
        if (far > radius + AHEAD_OK) problems.push(`${pack.stops[seg]!.id} arrived with ${(len - d).toFixed(0)} m of the line still to ride, which leads ${far.toFixed(0)} m from the stop`);
      }
      if (d >= len || arrived.includes(seg)) break;
    }
    // the rider stands at the stop, then sets off
    for (let j = 0; j < 3; j++) feed(stop, null, 0);
  }
  return { problems, arrived, unheard: pack.cues.filter((c) => !c.quiet && !heard.has(c.id)).map((c) => c.id) };
}

for (const p of PACKS) describe(`${p.entry.id}: arrivals and turns with GPS error`, () => {
  it("arrivals never come on a pass on the way in, every turn before them is spoken, and no wrong way", () => {
    const pack = loaded(p);
    const r = ride(pack, towardsStop);
    expect(r.problems).toEqual([]);
    expect(r.arrived).toEqual([...pack.stops.keys()]);
    expect(r.unheard, "turns never spoken").toEqual([]);
  });

  it(`every turn is spoken, and no wrong way, with the fixes ${SIDE} m to the left or to the right of the line`, () => {
    const pack = loaded(p);
    for (const m of [SIDE, -SIDE]) {
      const r = ride(pack, sideways(m));
      expect(r.problems, `${m} m`).toEqual([]);
      expect(r.arrived, `${m} m`).toEqual([...pack.stops.keys()]);
      expect(r.unheard, `turns never spoken ${m} m to the side`).toEqual([]);
    }
  });
});
