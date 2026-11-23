/**
 * What the practice ride uses and the nav states it shows (task 34). Pure: no ride, no browser, so the tests can run it
 * on every pack.
 */
import { cumulative, makeProjection, pointAlong, project, unproject, type XY } from "../geo";
import { IDLE_NAV } from "../state";
import type { Aside, Cue, NavState, Pack } from "../types";

const SPOKEN: Cue["turn"][] = ["left", "right", "slight_left", "slight_right", "sharp_left", "sharp_right"];
const APPROACH_M = 150;

export interface PracticePick {
  /** The stop whose story and leg the tour uses (index into pack.stops). */
  stop: number;
  cue: Cue;
  /** Candidate passing-by stories, the best first: on the leg after the stop, then any with audio. */
  asides: Aside[];
}

function legLength(pack: Pack, i: number): number {
  const proj = makeProjection(pack.stops[0]!.at);
  const c = cumulative((pack.segments[i] ?? []).map((p) => project(proj, p)));
  return c.length ? c[c.length - 1]! : 0;
}

function cueAlong(pack: Pack, cue: Cue): number {
  const proj = makeProjection(pack.stops[0]!.at);
  const c = cumulative((pack.segments[cue.seg] ?? []).map((p) => project(proj, p)));
  return c[Math.min(cue.i, c.length - 1)] ?? 0;
}

/**
 * Pick what the practice ride uses: stop `k`, the first from 1 whose first core story has audio and at least three
 * paragraphs and whose leg has a spoken turn; the cue, the first such turn on that leg; the asides, those with audio.
 * A first pass also wants the turn at least 150 m into its leg and a leg after the stop long enough for a passing-by
 * story; a second pass drops those two wishes. Null when the pack has no stop that fits.
 */
export function pickPractice(pack: Pack): PracticePick | null {
  for (const strict of [true, false]) {
    for (let k = 1; k < pack.stops.length; k++) {
      const story = pack.stops[k]!.stories.find((s) => s.kind === "core");
      if (!story?.audio || story.paras.length < 3) continue;
      const turns = pack.cues.filter((c) => c.seg === k && SPOKEN.includes(c.turn) && c.audio && !c.quiet).sort((a, b) => cueAlong(pack, a) - cueAlong(pack, b));
      const cue = strict ? turns.find((c) => cueAlong(pack, c) >= APPROACH_M) : turns[0];
      if (!cue) continue;
      if (strict && (k + 1 >= pack.segments.length || legLength(pack, k + 1) < 300)) continue;
      const withAudio = pack.asides.filter((a) => a.audio);
      const asides = [...withAudio.filter((a) => a.seg === k + 1), ...withAudio.filter((a) => a.seg !== k + 1)];
      if (asides.length === 0) continue;
      return { stop: k, cue, asides };
    }
  }
  return null;
}

/** The nav states the steps show, made by hand like the Demo screen does. */
export interface PracticeStates {
  before: NavState;
  atStop: NavState;
  after: NavState;
}

export function practiceStates(pack: Pack, pick: PracticePick): PracticeStates {
  const proj = makeProjection(pack.stops[0]!.at);
  const pts = pack.segments.map((line) => line.map((p) => project(proj, p)));
  const lens = pts.map((l) => { const c = cumulative(l); return c.length ? c[c.length - 1]! : 0; });
  const total = lens.reduce((a, b) => a + b, 0);
  const k = pick.stop;
  const doneBefore = (seg: number): number => lens.slice(0, seg).reduce((a, b) => a + b, 0);
  const fixAt = (p: XY, heading: number | null, speed: number) => { const g = unproject(proj, p); return { lng: g[0], lat: g[1], accuracy: 8, heading, speed, time: Date.now() }; };
  const arrived = (upTo: number): number[] => Array.from({ length: upTo + 1 }, (_, i) => i);

  const cum = cumulative(pts[k]!);
  const cueAt = cum[Math.min(pick.cue.i, cum.length - 1)] ?? 0;
  const along = Math.max(0, cueAt - APPROACH_M);
  const here = pointAlong(pts[k]!, along, cum);
  const before: NavState = {
    ...IDLE_NAV, status: "riding", fix: fixAt(here.point, here.bearing, 4.5), snapped: unproject(proj, here.point), seg: k, alongSeg: along,
    toStop: lens[k]! - along, distanceDone: doneBefore(k) + along, distanceLeft: total - doneBefore(k) - along, routeBearing: here.bearing,
    nextCue: pick.cue, toCue: cueAt - along, currentCue: null, arrived: k > 0 ? arrived(k - 1) : [], speedAvg: 4.5,
  };
  const stopAt = pack.stops[k]!.at;
  const stopXY = project(proj, stopAt);
  const atStop: NavState = {
    ...IDLE_NAV, status: "at_stop", fix: fixAt(stopXY, null, 0), snapped: stopAt, seg: k, alongSeg: lens[k]!, toStop: 0,
    distanceDone: doneBefore(k) + lens[k]!, distanceLeft: total - doneBefore(k) - lens[k]!, arrived: arrived(k), speedAvg: 4.5,
  };
  const next = Math.min(k + 1, pts.length - 1);
  const nCum = cumulative(pts[next]!);
  const nAlong = Math.min(60, lens[next]! * 0.1);
  const out = pointAlong(pts[next]!, nAlong, nCum);
  const after: NavState = {
    ...IDLE_NAV, status: "riding", fix: fixAt(out.point, out.bearing, 4.5), snapped: unproject(proj, out.point), seg: next, alongSeg: nAlong,
    toStop: lens[next]! - nAlong, distanceDone: doneBefore(next) + nAlong, distanceLeft: total - doneBefore(next) - nAlong, routeBearing: out.bearing,
    nextCue: null, toCue: null, currentCue: null, arrived: arrived(k), speedAvg: 4.5,
  };
  return { before, atStop, after };
}

