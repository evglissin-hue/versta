import { packBase } from "./state";
import type { LngLat, Pack } from "./types";

export interface OfflineStatus { saved: boolean; bytes: number; savedAt: number | null }
interface OfflineMeta { savedAt: number; bytes: number; tileTemplate: string }

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const GLYPH_BASE = "https://tiles.openfreemap.org/fonts";
const FONT_STACKS = ["Noto Sans Regular", "Noto Sans Bold", "Noto Sans Italic"];
const GLYPH_RANGES = ["0-255", "256-511"];
const PACK_CACHE = "versta-packs";
const TILE_CACHE = "versta-tiles";
const TEMPLATE_KEY = "versta:tileTemplate";
const META_PREFIX = "versta:offline:";
const MIN_ZOOM = 11;
const MAX_ZOOM = 16;
const TILE_BUFFER_M = 400;
const CONCURRENCY = 6;

function readMeta(packId: string): OfflineMeta | null {
  try {
    const raw = localStorage.getItem(META_PREFIX + packId);
    return raw ? (JSON.parse(raw) as OfflineMeta) : null;
  } catch { return null; }
}

function savedMetas(): OfflineMeta[] {
  const out: OfflineMeta[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(META_PREFIX)) {
        const meta = readMeta(key.slice(META_PREFIX.length));
        if (meta) out.push(meta);
      }
    }
  } catch {}
  return out;
}

interface TileJson { template: string; maxzoom: number }

async function fetchTileJson(): Promise<TileJson> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(TILEJSON_URL, { signal: ctl.signal });
    if (!res.ok) throw new Error(`Tile index answered ${res.status}`);
    const json = (await res.json()) as { tiles?: string[]; maxzoom?: number };
    const template = json.tiles?.[0];
    if (!template) throw new Error("Tile index has no tile address");
    try { localStorage.setItem(TEMPLATE_KEY, template); } catch {}
    return { template, maxzoom: typeof json.maxzoom === "number" ? json.maxzoom : 14 };
  } finally { clearTimeout(timer); }
}

/** Vector tile URL template to give MapLibre. Uses the one saved with an offline pack when the network is unreachable. */
export async function tileTemplate(): Promise<string> {
  try {
    return (await fetchTileJson()).template;
  } catch (err) {
    const fromPack = savedMetas().find((m) => m.tileTemplate)?.tileTemplate;
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(TEMPLATE_KEY); } catch {}
    const found = fromPack ?? remembered;
    if (found) return found;
    throw err instanceof Error ? err : new Error("No map tiles available");
  }
}

/* ------------------------------------------------------------------ tile maths */

function lngToX(lng: number, z: number): number { return ((lng + 180) / 360) * 2 ** z; }
function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

function metresBetween(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Points along the route no more than `step` metres apart. */
function densify(pack: Pack, step: number): LngLat[] {
  const out: LngLat[] = [];
  for (const seg of pack.segments) {
    for (let i = 0; i < seg.length; i++) {
      const b = seg[i]!;
      out.push(b);
      const a = seg[i - 1];
      if (!a) continue;
      const n = Math.floor(metresBetween(a, b) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out;
}

/** Every tile (as "z/x/y") that lies within 400 m of the route line, for zooms minZ to maxZ. */
export function routeTiles(pack: Pack, minZ: number, maxZ: number): string[] {
  const pts = densify(pack, 150);
  const set = new Set<string>();
  for (const [lng, lat] of pts) {
    const dLat = TILE_BUFFER_M / 111320;
    const dLng = TILE_BUFFER_M / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let z = minZ; z <= maxZ; z++) {
      const max = 2 ** z - 1;
      const x0 = Math.max(0, Math.floor(lngToX(lng - dLng, z))), x1 = Math.min(max, Math.floor(lngToX(lng + dLng, z)));
      const y0 = Math.max(0, Math.floor(latToY(lat + dLat, z))), y1 = Math.min(max, Math.floor(latToY(lat - dLat, z)));
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(`${z}/${x}/${y}`);
    }
  }
  return [...set];
}

/** Every file of a pack that lives under its folder, as paths relative to that folder. */
export function packFiles(pack: Pack): string[] {
  const files = new Set<string>(["pack.json", pack.hero.src]);
  for (const stop of pack.stops) {
    for (const story of stop.stories) {
      if (story.audio) files.add(story.audio.src);
      if (story.pic) files.add(story.pic.src);
    }
  }
  for (const a of pack.asides) files.add(a.audio);
  for (const c of pack.cues) files.add(c.audio);
  for (const s of pack.system.arrive) files.add(s);
  files.add(pack.system.offRoute);
  files.add(pack.system.backOnRoute);
  return [...files].filter(Boolean);
}

/* ------------------------------------------------------------------ saving */

interface Job { url: string; cache: string; tile: boolean }

async function runJob(job: Job, caches_: { [name: string]: Cache }): Promise<number> {
  const res = await fetch(job.url);
  if (!res.ok) throw new Error(`${job.url} answered ${res.status}`);
  const blob = await res.clone().blob();
  // Empty tiles are normal over water and outside the data; keep them out of the cache.
  if (job.tile && blob.size === 0) return 0;
  await caches_[job.cache]!.put(job.url, res);
  return blob.size;
}

export async function savePackOffline(pack: Pack, onProgress: (done: number, total: number) => void): Promise<void> {
  if (!("caches" in globalThis)) throw new Error("This browser cannot save routes for offline use");
  const base = new URL(packBase(pack.id), location.href).href;
  const info = await fetchTileJson();
  const maxZ = Math.min(MAX_ZOOM, info.maxzoom);

  const jobs: Job[] = packFiles(pack).map((f) => ({ url: new URL(f, base).href, cache: PACK_CACHE, tile: false }));
  for (const t of routeTiles(pack, MIN_ZOOM, maxZ)) {
    const [z, x, y] = t.split("/");
    jobs.push({ url: info.template.replace("{z}", z!).replace("{x}", x!).replace("{y}", y!), cache: TILE_CACHE, tile: true });
  }
  for (const stack of FONT_STACKS) for (const range of GLYPH_RANGES) {
    jobs.push({ url: `${GLYPH_BASE}/${encodeURIComponent(stack)}/${range}.pbf`, cache: TILE_CACHE, tile: false });
  }

  const open = { [PACK_CACHE]: await caches.open(PACK_CACHE), [TILE_CACHE]: await caches.open(TILE_CACHE) };
  let done = 0, bytes = 0, failed = 0, next = 0;
  onProgress(0, jobs.length);

  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      let size = -1;
      for (let attempt = 0; attempt < 2 && size < 0; attempt++) {
        try { size = await runJob(job, open); } catch { /* retried once, then counted */ }
      }
      if (size < 0) failed++; else bytes += size;
      done++;
      onProgress(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed > 0) throw new Error(`${failed} of ${jobs.length} files could not be saved`);
  const meta: OfflineMeta = { savedAt: Date.now(), bytes, tileTemplate: info.template };
  localStorage.setItem(META_PREFIX + pack.id, JSON.stringify(meta));
}

export async function offlineStatus(packId: string): Promise<OfflineStatus> {
  const meta = readMeta(packId);
  if (!meta) return { saved: false, bytes: 0, savedAt: null };
  try {
    // The browser may have cleared its caches since: only report saved if the pack file is still there.
    const base = new URL(packBase(packId), location.href).href;
    const hit = await caches.open(PACK_CACHE).then((c) => c.match(new URL("pack.json", base).href));
    if (!hit) return { saved: false, bytes: 0, savedAt: null };
  } catch { return { saved: false, bytes: 0, savedAt: null }; }
  return { saved: true, bytes: meta.bytes, savedAt: meta.savedAt };
}

export async function removePackOffline(packId: string): Promise<void> {
  try { localStorage.removeItem(META_PREFIX + packId); } catch {}
  if (!("caches" in globalThis)) return;
  const cache = await caches.open(PACK_CACHE);
  const folder = new URL(packBase(packId), location.href).href;
  for (const req of await cache.keys()) if (req.url.startsWith(folder)) await cache.delete(req);
  // Tiles are shared between packs: drop them only when no other pack is saved.
  if (savedMetas().length === 0) await caches.delete(TILE_CACHE);
}
