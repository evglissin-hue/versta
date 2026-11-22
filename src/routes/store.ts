/**
 * The route store: the Android app's copy of the routes. It keeps the routes built into the APK and the ones
 * downloaded from the site, decides (with `plan.ts`) what to fetch, switch in or delete, and publishes `routeStatus`,
 * `packIndex` and the pack base resolver. Nothing half-downloaded is ever used: a version is written to its own
 * folder, every file verified, and only then does the record name it.
 *
 * Storage (spec: docs/build/it6-00-overview.md section 2):
 *   packs/<id>/<version>/<path>     files, under the app's data folder
 *   localStorage versta:routes          { [id]: { version, updated, entry } }  copies in use
 *   localStorage versta:routes-next     the same plus { bytes, stopsChanged }  updates downloaded, waiting
 *   localStorage versta:routes-removed  [id]                                    routes the rider removed
 *   localStorage versta:site-credits    the site's sounds/credits.json
 */
import { packSounds } from "../offline";
import type { Pack, PackIndexEntry, PackManifest, RouteStatus, Transfer } from "../types";
import { PACK_FORMAT, SITE_URL, packIndex, routeStatus, setPackBaseResolver } from "../state";
import { b64ToBytes, b64ToText, sha256Hex, type Device } from "./files";
import { chooseCopy, plan, type DownloadedCopy, type Plan, type StagedCopy } from "./plan";

const RECORD_KEY = "versta:routes";
const NEXT_KEY = "versta:routes-next";
const REMOVED_KEY = "versta:routes-removed";
const CREDITS_KEY = "versta:site-credits";
const SOUND_CACHE = "versta-sounds";
const CHECK_EVERY_MS = 60_000;
const INDEX_TIMEOUT_MS = 10_000;

interface CacheLike {
  match(url: string): Promise<unknown>;
  put(url: string, res: Response): Promise<void>;
}

export interface StoreDeps {
  device: Device;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** The Cache API, or null where there is none. */
  openCache: ((name: string) => Promise<CacheLike>) | null;
  siteUrl: string;
  appFormat: number;
  /** The URL of one of the app's own files, for example `packs/index.json`. */
  ownUrl(path: string): string;
  /** The key the loop library asks the cache for: the app's own URL of `sounds/<name>.mp3`. */
  soundKey(name: string): string;
  /** The routes built into the APK. */
  loadBuiltIn(): Promise<PackIndexEntry[]>;
  now(): number;
  /** On Wi-Fi or ethernet and data saver is off. */
  wifi(): boolean;
  /** The route being ridden, "" when a ride runs on an unknown route, null with no ride running. */
  riding(): string | null;
  savedRideId(): string | null;
  /** The APK ships this sound (path under sounds/ without ".mp3"). */
  isBundled(name: string): boolean;
  /** Receives what the store decided, for the app's signals. */
  publish(status: Record<string, RouteStatus>, index: PackIndexEntry[]): void;
  setResolver(fn: ((id: string) => string | null) | null): void;
}

export interface RouteStore {
  /** Clean up, read what is on the phone, publish, then look at the site. Safe to call twice. */
  start(): Promise<void>;
  /** Read the site's index (at most once a minute unless `force`) and act on it. */
  check(force?: boolean): Promise<void>;
  /** A tap: download or update now, on any connection. Clears "removed". Resolves when the transfer ends. */
  fetch(id: string): Promise<void>;
  /** Delete a downloaded copy (and any waiting update). Returns false when there was nothing to delete. */
  remove(id: string): Promise<boolean>;
  /** A ride ended: resume transfers and switch in what was held. */
  rideEnded(): Promise<void>;
  /** The last decision, for tests and readers outside the signals. */
  current(): Plan;
  /** The folder of a downloaded route (with a trailing slash), or null when its own copy is used. */
  baseFor(id: string): string | null;
}

function readJson<T>(storage: StoreDeps["storage"], key: string, fallback: T): T {
  try { const raw = storage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeJson(storage: StoreDeps["storage"], key: string, value: unknown): void {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: the files stay, the record is rebuilt next start */ }
}

const encodePath = (p: string): string => p.split("/").map(encodeURIComponent).join("/");
const safePath = (p: string): boolean => p.length > 0 && !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === "");
const stopIds = (packJsonB64: string | null): string[] | null => {
  if (!packJsonB64) return null;
  try { return (JSON.parse(b64ToText(packJsonB64)) as Pack).stops.map((s) => s.id); } catch { return null; }
};

export function createRouteStore(deps: StoreDeps): RouteStore {
  const dev = deps.device;
  let builtIn: PackIndexEntry[] = [];
  let record: Record<string, DownloadedCopy> = {};
  let staged: Record<string, StagedCopy> = {};
  let removed = new Set<string>();
  let site: PackIndexEntry[] | null = null;
  const transfers: Record<string, Transfer> = {};
  const costs: Record<string, { version: string; bytes: number }> = {};
  const wanted = new Set<string>();
  let last: Plan = { status: {}, index: [], action: { kind: "none" } };
  let started = false;
  let lastOkCheck = -Infinity;
  let checking: Promise<void> | null = null;
  let pumping: Promise<void> | null = null;
  let waiters: (() => void)[] = [];

  const saveRecord = (): void => writeJson(deps.storage, RECORD_KEY, record);
  const saveNext = (): void => writeJson(deps.storage, NEXT_KEY, staged);
  const saveRemoved = (): void => writeJson(deps.storage, REMOVED_KEY, [...removed]);
  const folder = (id: string, version: string): string => `packs/${id}/${version}`;

  function compute(): Plan {
    return plan({
      builtIn, record, staged, site, riding: deps.riding(), savedRideId: deps.savedRideId(), wifi: deps.wifi(),
      removed: [...removed], transfers, wanted: [...wanted], costs, appFormat: deps.appFormat,
    });
  }

  function publish(): Plan {
    last = compute();
    deps.publish(last.status, last.index);
    return last;
  }

  function baseFor(id: string): string | null {
    const st = last.status[id];
    const rec = record[id];
    return st?.kind === "on-phone" && st.source === "downloaded" && rec ? `${dev.uri(folder(id, rec.version))}/` : null;
  }

  /** Wait while a ride runs. A ride starting lets the current file finish, then transfers wait here. */
  async function gate(): Promise<void> {
    while (deps.riding() !== null) await new Promise<void>((resolve) => { waiters.push(resolve); });
  }

  /* ---------------------------------------------------------------- the copy a download starts from */

  async function currentManifest(id: string): Promise<{ sha: Map<string, string>; downloaded: DownloadedCopy | null }> {
    const chosen = chooseCopy(builtIn.find((e) => e.id === id), record[id]);
    const sha = new Map<string, string>();
    let downloaded: DownloadedCopy | null = null;
    try {
      let text: string | null = null;
      if (chosen?.source === "downloaded") {
        downloaded = record[id] ?? null;
        const b = await dev.read(`${folder(id, chosen.version)}/manifest.json`);
        text = b ? b64ToText(b) : null;
      } else if (chosen) {
        const r = await dev.getOwn(deps.ownUrl(`packs/${id}/manifest.json`));
        text = r.status === 200 ? b64ToText(r.data) : null;
      }
      if (text) for (const f of (JSON.parse(text) as PackManifest).files) sha.set(f.path, f.sha256);
    } catch { sha.clear(); }
    return { sha, downloaded };
  }

  /** The site's manifest of a route, checked against the index entry; null when it cannot be read or does not match. */
  async function siteManifest(id: string, version: string | undefined): Promise<PackManifest | null> {
    try {
      const res = await dev.get(`${deps.siteUrl}packs/${encodeURIComponent(id)}/manifest.json`, 15_000);
      if (res.status !== 200) return null;
      const m = JSON.parse(b64ToText(res.data)) as PackManifest;
      return m.id === id && m.version === version && Array.isArray(m.files) ? m : null;
    } catch { return null; }
  }

  /**
   * What each update of a route on the phone would download: the files whose checksum differs from the copy on the
   * phone. Worked out as soon as the update is seen, so a card on mobile data shows the real cost before a tap.
   */
  async function estimateCosts(): Promise<void> {
    for (const e of site ?? []) {
      if (!e.version || costs[e.id]?.version === e.version || (e.format ?? 1) > deps.appFormat) continue;
      const chosen = chooseCopy(builtIn.find((b) => b.id === e.id), record[e.id]);
      if (!chosen || chosen.source === "drop" || chosen.version === e.version) continue;
      const m = await siteManifest(e.id, e.version);
      if (!m) continue;
      const cur = await currentManifest(e.id);
      costs[e.id] = { version: m.version, bytes: m.files.filter((f) => cur.sha.get(f.path) !== f.sha256).reduce((n, f) => n + f.bytes, 0) };
    }
  }

  async function currentStopIds(id: string): Promise<string[] | null> {
    const chosen = chooseCopy(builtIn.find((e) => e.id === id), record[id]);
    try {
      if (chosen?.source === "downloaded") return stopIds(await dev.read(`${folder(id, chosen.version)}/pack.json`));
      if (chosen) {
        const r = await dev.getOwn(deps.ownUrl(`packs/${id}/pack.json`));
        return r.status === 200 ? stopIds(r.data) : null;
      }
    } catch { /* unknown */ }
    return null;
  }

  /* ---------------------------------------------------------------- download */

  async function download(id: string): Promise<void> {
    const entry = site?.find((e) => e.id === id);
    if (!entry) return;
    const t: Transfer = { state: "downloading", done: 0, total: 0 };
    transfers[id] = t;
    publish();
    let dest = "";
    try {
      const base = `${deps.siteUrl}packs/${encodeURIComponent(id)}/`;
      const mres = await dev.get(`${base}manifest.json`, 15_000);
      if (mres.status !== 200) throw new Error(`manifest ${mres.status}`);
      const manifest = JSON.parse(b64ToText(mres.data)) as PackManifest;
      if (manifest.id !== id || manifest.version !== entry.version || !Array.isArray(manifest.files)) throw new Error("manifest does not match the index");
      if (manifest.format > deps.appFormat) throw new Error("needs a newer app");
      if (manifest.files.some((f) => !safePath(f.path) || f.path === "manifest.json")) throw new Error("manifest has a bad path");

      const cur = await currentManifest(id);
      const reuse = (path: string, sha: string): boolean => cur.sha.get(path) === sha;
      t.total = manifest.files.filter((f) => !reuse(f.path, f.sha256)).reduce((n, f) => n + f.bytes, 0);
      costs[id] = { version: manifest.version, bytes: t.total };
      publish();

      dest = folder(id, manifest.version);
      await dev.remove(dest);
      const fromCopy = cur.downloaded ? folder(id, cur.downloaded.version) : null;

      for (const f of manifest.files) {
        await gate();
        let done = false;
        if (reuse(f.path, f.sha256)) {
          try {
            if (fromCopy) {
              await dev.copy(`${fromCopy}/${f.path}`, `${dest}/${f.path}`);
              done = true;
            } else {
              const own = await dev.getOwn(deps.ownUrl(`packs/${id}/${f.path}`));
              if (own.status === 200) {
                const bytes = b64ToBytes(own.data);
                if (bytes.length === f.bytes && (await sha256Hex(bytes)) === f.sha256) { await dev.write(`${dest}/${f.path}`, own.data); done = true; }
              }
            }
          } catch { done = false; }
          if (!done) t.total += f.bytes; // the copy failed: this file is downloaded after all
        }
        if (!done) {
          const res = await dev.get(`${base}${encodePath(f.path)}`);
          if (res.status !== 200) throw new Error(`${f.path} answered ${res.status}`);
          const bytes = b64ToBytes(res.data);
          if (bytes.length !== f.bytes) throw new Error(`${f.path} has the wrong size`);
          if ((await sha256Hex(bytes)) !== f.sha256) throw new Error(`${f.path} does not match its checksum`);
          await dev.write(`${dest}/${f.path}`, res.data);
          t.done += f.bytes;
          publish();
        }
      }
      // The manifest goes in last: a folder with a manifest is a complete one.
      await dev.write(`${dest}/manifest.json`, mres.data);

      const now = stopIds(await dev.read(`${dest}/pack.json`));
      const before = await currentStopIds(id);
      const stopsChanged = !now || !before || now.length !== before.length || now.some((s, i) => s !== before[i]);
      staged[id] = { version: manifest.version, updated: entry.updated ?? new Date(deps.now()).toISOString(), entry, bytes: t.total, stopsChanged };
      saveNext();
      delete transfers[id];
    } catch {
      transfers[id] = { state: "failed", done: t.done, total: t.total };
      if (dest) { try { await dev.remove(dest); } catch { /* cleaned at the next start */ } }
    }
  }

  /* ---------------------------------------------------------------- sounds */

  async function syncSounds(id: string): Promise<void> {
    try {
      const rec = record[id];
      if (!rec || !deps.openCache) return;
      const raw = await dev.read(`${folder(id, rec.version)}/pack.json`);
      if (!raw) return;
      const names = packSounds(JSON.parse(b64ToText(raw)) as Pack).filter((n) => !deps.isBundled(n));
      if (names.length === 0) return;
      const cache = await deps.openCache(SOUND_CACHE);
      let fetched = 0;
      for (const name of names) {
        const key = deps.soundKey(name);
        try {
          if (await cache.match(key)) continue;
          await gate();
          const res = await dev.get(`${deps.siteUrl}sounds/${name}.mp3`);
          if (res.status !== 200 || !res.data) continue; // a sound the site lacks is silence, not an error
          await cache.put(key, new Response(b64ToBytes(res.data) as BufferSource, { headers: { "content-type": "audio/mpeg" } }));
          fetched++;
        } catch { /* silence */ }
      }
      let have = false;
      try { have = deps.storage.getItem(CREDITS_KEY) !== null; } catch { /* none */ }
      if (fetched > 0 || !have) {
        const res = await dev.get(`${deps.siteUrl}sounds/credits.json`);
        if (res.status === 200) { try { deps.storage.setItem(CREDITS_KEY, b64ToText(res.data)); } catch { /* none */ } }
      }
    } catch { /* sounds are never an error */ }
  }

  /* ---------------------------------------------------------------- acting on the plan */

  async function act(a: Plan["action"]): Promise<boolean> {
    switch (a.kind) {
      case "none": return false;
      case "drop": {
        const rec = record[a.id];
        delete record[a.id];
        saveRecord();
        if (rec) await dev.remove(folder(a.id, rec.version)).catch(() => {});
        return true;
      }
      case "drop-next": {
        const st = staged[a.id];
        delete staged[a.id];
        saveNext();
        if (st) await dev.remove(folder(a.id, st.version)).catch(() => {});
        return true;
      }
      case "switch": {
        const st = staged[a.id];
        if (!st) return true;
        const old = record[a.id];
        record[a.id] = { version: st.version, updated: st.updated, entry: st.entry };
        saveRecord();
        delete staged[a.id];
        saveNext();
        publish();
        if (old && old.version !== st.version) await dev.remove(folder(a.id, old.version)).catch(() => {});
        await syncSounds(a.id);
        return true;
      }
      case "download": {
        wanted.delete(a.id);
        await download(a.id);
        return true;
      }
    }
  }

  function pump(): Promise<void> {
    if (!pumping) {
      pumping = (async () => {
        try {
          for (;;) {
            const p = publish();
            if (!(await act(p.action))) break;
          }
        } finally { pumping = null; }
      })();
    }
    return pumping;
  }

  /* ---------------------------------------------------------------- the site */

  async function readSite(): Promise<void> {
    try {
      const res = await dev.get(`${deps.siteUrl}packs/index.json`, INDEX_TIMEOUT_MS);
      if (res.status !== 200) return;
      const json = JSON.parse(b64ToText(res.data)) as { packs?: PackIndexEntry[] };
      if (!Array.isArray(json.packs)) return;
      site = json.packs;
      lastOkCheck = deps.now();
    } catch { /* unreachable: the phone keeps what it has */ }
  }

  function check(force = false): Promise<void> {
    if (!started) return Promise.resolve();
    if (!force && deps.now() - lastOkCheck < CHECK_EVERY_MS) return pump();
    if (!checking) checking = readSite().then(estimateCosts).finally(() => { checking = null; });
    return checking.then(() => pump());
  }

  /** Delete every folder the records do not name (a download cut off), and records whose files are gone. */
  async function cleanFolders(): Promise<void> {
    try {
      for (const [id, rec] of Object.entries(record)) {
        const files = await dev.list(folder(id, rec.version));
        if (!files.includes("manifest.json")) delete record[id];
      }
      for (const [id, st] of Object.entries(staged)) {
        const files = await dev.list(folder(id, st.version));
        if (!files.includes("manifest.json")) delete staged[id];
      }
      saveRecord();
      saveNext();
      for (const id of await dev.list("packs")) {
        const keep = new Set([record[id]?.version, staged[id]?.version].filter((v): v is string => !!v));
        const versions = await dev.list(`packs/${id}`);
        for (const v of versions) if (!keep.has(v)) await dev.remove(folder(id, v));
        if (keep.size === 0) await dev.remove(`packs/${id}`);
      }
    } catch { /* a folder we could not clean is tried again next start */ }
  }

  return {
    async start() {
      if (started) return;
      started = true;
      record = readJson(deps.storage, RECORD_KEY, {});
      staged = readJson(deps.storage, NEXT_KEY, {});
      removed = new Set(readJson<string[]>(deps.storage, REMOVED_KEY, []));
      try { builtIn = await deps.loadBuiltIn(); } catch { builtIn = []; }
      await cleanFolders();
      deps.setResolver(baseFor);
      publish();
      await check(true);
      // Routes already on the phone may use sounds the site has gained since: on Wi-Fi, between rides.
      if (site && deps.wifi() && deps.riding() === null) {
        for (const id of Object.keys(record)) await syncSounds(id);
      }
    },
    check,
    async fetch(id) {
      removed.delete(id);
      saveRemoved();
      delete transfers[id];
      wanted.add(id);
      if (!site) await check(true);
      await pump();
    },
    async remove(id) {
      if (deps.riding() === id) return false;
      const rec = record[id];
      const st = staged[id];
      if (!rec && !st) return false;
      delete record[id];
      delete staged[id];
      delete transfers[id];
      wanted.delete(id);
      saveRecord();
      saveNext();
      // A route the rider removed does not come back by itself, built-in update or not.
      removed.add(id);
      saveRemoved();
      publish();
      if (rec) await dev.remove(folder(id, rec.version)).catch(() => {});
      if (st) await dev.remove(folder(id, st.version)).catch(() => {});
      await pump();
      return true;
    },
    async rideEnded() {
      const w = waiters;
      waiters = [];
      for (const r of w) r();
      await pump();
    },
    current: () => last,
    baseFor,
  };
}

/* ------------------------------------------------------------------ the app's store */

let real: RouteStore | null = null;
let starting: Promise<void> | null = null;

async function realDeps(): Promise<StoreDeps> {
  const [{ capacitorDevice }, { savedRide, rideStartedAt }, { pack }, { bundledSounds }] = await Promise.all([
    import("./files"), import("../ride"), import("../state"), import("../audio/library"),
  ]);
  const device = await capacitorDevice();
  const bundled = bundledSounds();
  const base = import.meta.env.BASE_URL;
  return {
    device,
    storage: localStorage,
    openCache: typeof caches !== "undefined" ? (name) => caches.open(name) as Promise<CacheLike> : null,
    siteUrl: SITE_URL,
    appFormat: PACK_FORMAT,
    ownUrl: (p) => new URL(`${base}${p}`, location.href).href,
    soundKey: (n) => new URL(`${base}sounds/${n}.mp3`, location.href).href,
    loadBuiltIn: async () => ((await (await fetch(`${base}packs/index.json`)).json()) as { packs: PackIndexEntry[] }).packs,
    now: () => Date.now(),
    wifi: () => {
      const c = (navigator as { connection?: { type?: string; saveData?: boolean } }).connection;
      return !!c && !c.saveData && (c.type === "wifi" || c.type === "ethernet");
    },
    riding: () => (rideStartedAt() === null ? null : (pack.value?.id ?? "")),
    savedRideId: () => savedRide()?.packId ?? null,
    isBundled: (n) => bundled.has(n),
    publish: (status, index) => { routeStatus.value = status; packIndex.value = index; },
    setResolver: setPackBaseResolver,
  };
}

/** The app's store. Call `start()` once on the Android app; the other calls do nothing before it. */
export const routeStore = {
  start(): Promise<void> {
    starting ??= (async () => {
      real = createRouteStore(await realDeps());
      const on = (): void => { void real?.check(); };
      window.addEventListener("online", on);
      (navigator as { connection?: EventTarget }).connection?.addEventListener("change", on);
      await real.start();
    })();
    return starting;
  },
  check: (): Promise<void> => real?.check() ?? Promise.resolve(),
  fetch: (id: string): Promise<void> => real?.fetch(id) ?? Promise.resolve(),
  remove: (id: string): Promise<boolean> => real?.remove(id) ?? Promise.resolve(false),
  rideEnded: (): Promise<void> => real?.rideEnded() ?? Promise.resolve(),
};
