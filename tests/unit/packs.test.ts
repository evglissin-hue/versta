/**
 * Integrity of every route pack in public/packs/index.json: the index entry matches the pack, the line passes every
 * stop, and every file the app would play or show is there. A missing file here is a silence or a broken picture on
 * the road.
 */
import { describe, expect, it } from "vitest";
import { RECIPES } from "../../src/audio/soundscapes";
import { packFiles } from "../../src/offline";
import { cumulative, geoDistance, makeProjection, nearestOnPolyline, project } from "../../src/geo";
import type { Pack } from "../../src/types";
import { ENTRIES, PACKS, hasFile, loaded } from "./packs";

/** Every piece of text a rider reads or hears in a pack. */
function texts(p: Pack): string[] {
  return [
    p.name, p.blurb, p.hero.caption, ...p.legs.map((l) => l.name),
    ...p.stops.flatMap((s) => [s.name, s.note, ...s.stories.flatMap((st) => [st.title, ...st.paras, st.pic?.caption ?? ""])]),
    ...p.cues.flatMap((c) => [c.name, c.say]),
    ...p.asides.flatMap((a) => [a.title, a.text]),
  ];
}

/** Clip lengths from the pause finder, for the aside clips (a pack records no length for them). */
const BREAK_FILES = import.meta.glob<Record<string, { dur: number }>>("../../tools/content/*.breaks.json", { eager: true, import: "default" });

describe("the route index", () => {
  it("lists at least one pack, each id once", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    expect(new Set(ENTRIES.map((e) => e.id)).size).toBe(ENTRIES.length);
  });
});

describe.each(PACKS.map((p) => [p.entry.id, p] as const))("pack %s", (id, p) => {
  it("is built, and its index entry matches the pack", () => {
    const pack = loaded(p);
    const e = p.entry;
    expect(pack.id).toBe(id);
    expect(pack.format).toBe(1);
    expect(e.name).toBe(pack.name);
    expect(e.mode).toBe(pack.mode);
    expect(e.km).toBe(pack.km);
    expect(e.stops).toBe(pack.stops.length);
    expect(e.hero).toBe(`packs/${id}/${pack.hero.src}`);
    expect(e.blurb.length).toBeGreaterThan(20);
    if (e.stories !== undefined) expect(e.stories).toBe(pack.stops.reduce((n, s) => n + s.stories.length, 0));
    if (e.asides !== undefined) expect(e.asides).toBe(pack.asides.length);
  });

  it("has one segment per stop, continuous, and the line passes within 60 m of every stop", () => {
    const pack = loaded(p);
    expect(pack.stops.length).toBeGreaterThanOrEqual(2);
    expect(pack.segments.length).toBe(pack.stops.length);
    expect(pack.segments[0]).toEqual([]);
    const proj = makeProjection(pack.stops[0]!.at);
    const far: string[] = [];
    const gaps: string[] = [];
    for (let i = 1; i < pack.segments.length; i++) {
      const seg = pack.segments[i]!;
      expect(seg.length, `segment ${i} has a line`).toBeGreaterThanOrEqual(2);
      if (i > 1) {
        const gap = geoDistance(pack.segments[i - 1]!.at(-1)!, seg[0]!);
        if (gap > 30) gaps.push(`segment ${i} starts ${Math.round(gap)} m from where segment ${i - 1} ends`);
      }
      const stop = pack.stops[i]!;
      const pts = seg.map((q) => project(proj, q));
      const d = nearestOnPolyline(pts, project(proj, stop.at), cumulative(pts)).dist;
      // the engine also counts a stop as reached at the end of its segment, so 60 m is enough; new lines aim for 30 m
      if (d > 60) far.push(`${stop.id} is ${Math.round(d)} m from segment ${i}`);
    }
    expect(gaps).toEqual([]);
    expect(far).toEqual([]);
    const first = geoDistance(pack.segments[1]![0]!, pack.stops[0]!.at);
    expect(first, "segment 1 starts at the first stop").toBeLessThanOrEqual(pack.stops[0]!.arriveRadius);
  });

  it("has legs that cover the stops in order", () => {
    const pack = loaded(p);
    expect(pack.legs.length).toBeGreaterThan(0);
    let next = 0;
    for (const l of pack.legs) {
      expect(l.from, `leg ${l.name} starts where the last one ended`).toBe(next);
      expect(l.to).toBeGreaterThanOrEqual(l.from);
      next = l.to + 1;
    }
    expect(next).toBe(pack.stops.length);
  });

  it("has unique ids for stops, stories, cues and asides", () => {
    const pack = loaded(p);
    for (const list of [pack.stops.map((s) => s.id), pack.stops.flatMap((s) => s.stories.map((x) => x.id)), pack.cues.map((c) => c.id), pack.asides.map((a) => a.id)]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("gives every story recorded audio with one mark per paragraph, a known soundscape, and pictures that exist", () => {
    const pack = loaded(p);
    const problems: string[] = [];
    if (!hasFile(id, pack.hero.src)) problems.push(`hero ${pack.hero.src} missing`);
    for (const s of pack.stops) {
      if (!(s.ambience in RECIPES)) problems.push(`${s.id}: unknown soundscape ${s.ambience}`);
      if (s.stories.length === 0) problems.push(`${s.id} has no story`);
      for (const st of s.stories) {
        if (st.ambience && !(st.ambience in RECIPES)) problems.push(`${st.id}: unknown soundscape ${st.ambience}`);
        if (st.paras.length === 0) problems.push(`${st.id} has no paragraphs`);
        if (!st.audio) { problems.push(`${st.id} has no audio`); continue; }
        if (!hasFile(id, st.audio.src)) problems.push(`${st.id}: ${st.audio.src} missing`);
        if (st.audio.marks.length !== st.paras.length) problems.push(`${st.id}: ${st.audio.marks.length} marks for ${st.paras.length} paragraphs`);
        const ordered = st.audio.marks.every((m, i, a) => i === 0 || m > a[i - 1]!);
        if (!ordered || (st.audio.marks.at(-1) ?? 0) >= st.audio.dur) problems.push(`${st.id}: marks out of order or past the end`);
        if (st.pic && !hasFile(id, st.pic.src)) problems.push(`${st.id}: picture ${st.pic.src} missing`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has a file for every spoken cue, every passing-by story and every system clip", () => {
    const pack = loaded(p);
    const missing: string[] = [];
    for (const c of pack.cues) {
      expect(c.seg).toBeGreaterThanOrEqual(1);
      expect(c.seg).toBeLessThan(pack.segments.length);
      expect(c.i).toBeLessThan(pack.segments[c.seg]!.length);
      if (!c.quiet && !hasFile(id, c.audio)) missing.push(`cue ${c.id}: ${c.audio}`);
    }
    for (let seg = 1; seg < pack.segments.length; seg++) {
      expect(pack.cues.some((c) => c.seg === seg), `segment ${seg} has a cue`).toBe(true);
    }
    for (const a of pack.asides) {
      expect(a.seg).toBeGreaterThanOrEqual(1);
      expect(a.seg).toBeLessThan(pack.segments.length);
      if (!hasFile(id, a.audio)) missing.push(`aside ${a.id}: ${a.audio}`);
    }
    const sys = pack.system;
    expect(sys.arrive.length).toBe(pack.stops.length);
    const clips = [...sys.arrive, sys.offRoute, sys.backOnRoute, sys.rerouting, sys.wrongWay, ...Object.values(sys.turns ?? {}), ...Object.values(sys.distances ?? {})];
    for (const f of clips) if (f && !hasFile(id, f)) missing.push(`system ${f}`);
    expect(missing).toEqual([]);
  });

  it("has every file that saving for offline asks for", () => {
    const pack = loaded(p);
    expect(packFiles(pack).filter((f) => !hasFile(id, f))).toEqual([]);
  });

  it("has phrase breaks for every story and aside clip, ascending, inside the clip, at every paragraph mark", () => {
    const pack = loaded(p);
    const bad: string[] = [];
    let seconds = 0;
    let count = 0;
    const check = (label: string, breaks: number[] | undefined, dur: number, marks: number[]) => {
      if (!breaks || breaks.length === 0) { bad.push(`${label} has no breaks`); return; }
      seconds += dur;
      count += breaks.length;
      for (let i = 0; i < breaks.length; i++) {
        const b = breaks[i]!;
        if (b < 0 || b >= dur) bad.push(`${label}: break ${b} is outside the clip (${dur} s)`);
        if (i > 0 && b <= breaks[i - 1]!) bad.push(`${label}: breaks are not ascending at ${b}`);
      }
      for (const m of marks) {
        if (!breaks.some((b) => Math.abs(b - m) <= 0.15)) bad.push(`${label}: paragraph mark ${m} has no break within 0.15 s`);
      }
    };
    for (const s of pack.stops) for (const st of s.stories) if (st.audio) check(`story ${st.id}`, st.audio.breaks, st.audio.dur, st.audio.marks);
    for (const a of pack.asides) {
      const dur = BREAK_FILES[`../../tools/content/${id}.breaks.json`]?.[a.audio]?.dur;
      if (dur === undefined) bad.push(`aside ${a.id}: no clip length for ${a.audio} in ${id}.breaks.json`);
      else check(`aside ${a.id}`, a.breaks, dur, []);
    }
    expect(bad).toEqual([]);
    expect(count).toBeGreaterThanOrEqual(seconds / 12);
  });

  it("has a corridor graph", () => {
    expect(p.graph, `public/packs/${id}/graph.json`).toBeDefined();
    expect(p.graph!.nodes.length).toBeGreaterThan(100);
    expect(p.graph!.edges.length).toBeGreaterThan(100);
  });

  it("uses no dashes and no exclamation marks in any text", () => {
    const bad = texts(loaded(p)).filter((t) => /[\u2013\u2014!]/.test(t));
    expect(bad).toEqual([]);
  });
});
