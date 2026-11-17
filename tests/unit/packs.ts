/**
 * Every route pack listed in public/packs/index.json, for the tests that must hold for each one: integrity, whole
 * simulated rides and the way-back search. A new pack is covered as soon as it is built and listed.
 */
import index from "../../public/packs/index.json";
import { cumulative, makeProjection, nearestOnPolyline, pointAlong, project, type XY } from "../../src/geo";
import type { Pack, PackIndexEntry, RouteGraph } from "../../src/types";

export type IndexEntry = PackIndexEntry & { stories?: number; asides?: number; minutes?: number };

const packFiles = import.meta.glob<Pack>("../../public/packs/*/pack.json", { eager: true, import: "default" });
const graphFiles = import.meta.glob<RouteGraph>("../../public/packs/*/graph.json", { eager: true, import: "default" });
/** Every file under public/packs/<id>/ that the app fetches, as "<pack id>/<path in the pack>". Listed, never loaded. */
const assetPaths = Object.keys(import.meta.glob("../../public/packs/*/**/*.{mp3,jpg,jpeg,png,webp,json}"))
  .map((k) => k.replace("../../public/packs/", ""));

export const ENTRIES: IndexEntry[] = (index as { packs: IndexEntry[] }).packs;

export interface PackUnderTest { entry: IndexEntry; pack: Pack | undefined; graph: RouteGraph | undefined }

export const PACKS: PackUnderTest[] = ENTRIES.map((entry) => ({
  entry,
  pack: packFiles[`../../public/packs/${entry.id}/pack.json`],
  graph: graphFiles[`../../public/packs/${entry.id}/graph.json`],
}));

const assets = new Set(assetPaths);
/** True when the pack folder holds this file (path relative to the pack folder). */
export function hasFile(packId: string, rel: string): boolean {
  return assets.has(`${packId}/${rel}`);
}

/** The pack, or a thrown error naming the pack that is listed but not built. */
export function loaded(p: PackUnderTest): Pack {
  if (!p.pack) throw new Error(`${p.entry.id} is in index.json but public/packs/${p.entry.id}/pack.json is missing`);
  return p.pack;
}

/**
 * Which way to stray from segment `seg` at `along` metres: the heading in radians (clockwise from north) of the side
 * whose point `metres` away is farthest from every part of the route, or null when neither side has `room` metres
 * clear. Where the line doubles back close by, straying only lands the rider on the route again.
 */
export function straySide(pack: Pack, seg: number, along: number, metres: number, room: number): number | null {
  const proj = makeProjection(pack.stops[0]!.at);
  const lines = pack.segments.filter((s) => s.length > 1).map((s) => s.map((q) => project(proj, q)));
  const pts = pack.segments[seg]!.map((q) => project(proj, q));
  const a = pointAlong(pts, along, cumulative(pts));
  const sides = [90, -90].map((turn) => {
    const rad = ((a.bearing + turn) * Math.PI) / 180;
    const q: XY = [a.point[0] + Math.sin(rad) * metres, a.point[1] - Math.cos(rad) * metres] as XY;
    return { rad, clear: Math.min(...lines.map((l) => nearestOnPolyline(l, q).dist)) };
  }).sort((x, y) => y.clear - x.clear);
  return sides[0]!.clear >= room ? sides[0]!.rad : null;
}

/** Length in metres of segment `seg`, and whether it is a ridden line (more than two points). */
export function segInfo(pack: Pack, seg: number): { length: number; ridden: boolean } {
  const proj = makeProjection(pack.stops[0]!.at);
  const pts = pack.segments[seg]!.map((q) => project(proj, q));
  return { length: pts.length > 1 ? cumulative(pts).at(-1)! : 0, ridden: pts.length > 2 };
}
