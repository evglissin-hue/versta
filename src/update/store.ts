/**
 * The app update store (iteration 7, task 35): keeps the app's own web code up to date on the Android app without a
 * reinstall. It reads the site's app/manifest.json, downloads a newer bundle between rides (by itself on Wi-Fi, with
 * a tap otherwise) into app/<version>/ in the data folder, only the files that differ from the APK's own, checks
 * every one, and stages it with the native plugin for the next start. Never during a ride: a ride takes the staged
 * version off, and its end puts it back. Nothing half-downloaded is ever staged: bundle.json goes in last.
 *
 * Storage: app/<version>/<path> (files), app/<version>/bundle.json (its manifest), localStorage versta:app-bundles
 * ({ [version]: { builtAt, native } }, the bundles downloaded whole).
 */
import type { AppUpdateState, Transfer } from "../types";
import { b64ToBytes, b64ToText, sha256Hex, textToB64, type Device } from "../routes/files";
import { filesToFetch, keepFolders, planApp, runningVersion, type AppManifest, type AppPlan, type BundleRecord } from "./plan";
import type { UpdaterApi, UpdaterInfo } from "./native";

const RECORD_KEY = "versta:app-bundles";
const CHECK_EVERY_MS = 60_000;
const MANIFEST_TIMEOUT_MS = 15_000;
const ID = /^[0-9a-f]{16}$/;

export interface AppStoreDeps {
  device: Device;
  /** The native plugin, or null in an APK built before it: then the store only reports what runs. */
  plugin: UpdaterApi | null;
  siteUrl: string;
  /** The APK's own app/manifest.json. No bundle carries app/, so this is always the APK's. */
  ownManifest(): Promise<AppManifest | null>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now(): number;
  /** On Wi-Fi or ethernet and data saver is off. */
  wifi(): boolean;
  /** A ride is running. */
  riding(): boolean;
  publish(state: AppUpdateState): void;
}

export interface AppStore {
  /** Read what is on the phone, clean up, publish, then look at the site. Safe to call twice. */
  start(): Promise<void>;
  /** Read the site's manifest (at most once a minute unless `force`) and act on it. */
  check(force?: boolean): Promise<void>;
  /** A tap: download the new version now, on any connection. */
  fetch(): Promise<void>;
  /** Switch to the staged version now (Home only). Does nothing during a ride. */
  restart(): Promise<void>;
  /** Back to the APK's own code, now. */
  useInstalled(): Promise<void>;
  /** A ride started or ended: take the staged version off, or put it back and carry on. */
  rideStarted(): Promise<void>;
  rideEnded(): Promise<void>;
  /** The last decision, for tests. */
  current(): AppPlan;
}

const safePath = (p: string): boolean => p.length > 0 && !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === "");
const encodePath = (p: string): string => p.split("/").map(encodeURIComponent).join("/");

/** A manifest that is what tools/app_manifest.mjs writes, or null. */
export function validManifest(j: unknown): AppManifest | null {
  const m = j as AppManifest | null;
  if (!m || typeof m !== "object" || typeof m.version !== "string" || !ID.test(m.version)) return null;
  if (typeof m.builtAt !== "string" || typeof m.native !== "number" || !Array.isArray(m.files)) return null;
  if (m.files.some((f) => !f || typeof f.path !== "string" || !safePath(f.path) || typeof f.sha256 !== "string" || typeof f.bytes !== "number")) return null;
  if (!m.files.some((f) => f.path === "index.html")) return null;
  return m;
}

export function createAppStore(deps: AppStoreDeps): AppStore {
  const dev = deps.device;
  let started = false;
  let builtIn: AppManifest | null = null;
  let info: UpdaterInfo | null = null;
  let record: Record<string, BundleRecord> = {};
  let site: AppManifest | null = null;
  /** The manifest of the bundle in use, to copy unchanged files from. */
  let curManifest: AppManifest | null = null;
  let transfer: Transfer | null = null;
  /** The version `transfer` is about, kept after it fails; and the version being downloaded right now. */
  let transferOf: string | null = null;
  let downloading: string | null = null;
  let wanted = false;
  let cost: { version: string; bytes: number } | null = null;
  let lastOkCheck = -Infinity;
  let checking: Promise<void> | null = null;
  let pumping: Promise<void> | null = null;
  let last: AppPlan = { running: null, status: { kind: "none" }, action: { kind: "none" } };

  const saveRecord = (): void => { try { deps.storage.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* storage full: rebuilt from the folders next start */ } };

  function compute(): AppPlan {
    return planApp({
      builtIn, info, record, site, riding: deps.riding(), wifi: deps.wifi(), wanted,
      transfer: transfer && transferOf === site?.version ? transfer : null,
      cost: cost && cost.version === site?.version ? cost.bytes : null,
    });
  }
  function publish(): AppPlan {
    last = compute();
    deps.publish({ running: last.running, status: last.status });
    return last;
  }

  async function refreshInfo(): Promise<void> {
    if (!deps.plugin) return;
    try { info = await deps.plugin.info(); } catch { /* keep what we knew */ }
  }

  async function readBundle(id: string): Promise<AppManifest | null> {
    try {
      const raw = await dev.read(`app/${id}/bundle.json`);
      return raw ? validManifest(JSON.parse(b64ToText(raw))) : null;
    } catch { return null; }
  }

  /** The file at `path` is exactly what the manifest says. */
  async function matches(path: string, f: AppManifest["files"][number]): Promise<boolean> {
    const raw = await dev.read(path);
    if (raw === null) return false;
    const bytes = b64ToBytes(raw);
    return bytes.length === f.bytes && (await sha256Hex(bytes)) === f.sha256;
  }

  /** Forget records whose folders are gone, learn bundles the records missed, and delete folders nobody needs. */
  async function reconcile(): Promise<void> {
    try {
      const folders = await dev.list("app");
      for (const id of Object.keys(record)) {
        if (!folders.includes(id) || !(await readBundle(id))) delete record[id];
      }
      for (const id of [info?.current, info?.next, info?.previous]) {
        if (!id || record[id]) continue;
        const m = await readBundle(id);
        if (m) record[id] = { builtAt: m.builtAt, native: m.native };
      }
      saveRecord();
      const keep = keepFolders(info, downloading);
      const run = runningVersion(builtIn, info, record);
      const runAt = run ? Date.parse(run.builtAt) || 0 : 0;
      for (const id of folders) {
        if (keep.has(id)) continue;
        // a complete bundle newer than what runs stays to be staged (a ride took it off); anything else goes
        if (record[id] && (Date.parse(record[id].builtAt) || 0) > runAt) continue;
        await dev.remove(`app/${id}`);
        delete record[id];
      }
      saveRecord();
    } catch { /* tried again next start */ }
  }

  /** What downloading the site's version costs: the files that differ from the APK and cannot be copied from the bundle in use. */
  function workOutCost(): void {
    if (!site) return;
    const fromCur = new Map((curManifest?.files ?? []).map((f) => [f.path, f.sha256]));
    const bytes = filesToFetch(site, builtIn).filter((f) => fromCur.get(f.path) !== f.sha256).reduce((n, f) => n + f.bytes, 0);
    cost = { version: site.version, bytes };
  }

  async function download(version: string): Promise<void> {
    const m = site;
    if (!m || m.version !== version) return;
    wanted = false;
    downloading = version;
    transferOf = version;
    const dest = `app/${version}`;
    const curId = info?.current ?? null;
    const fromCur = new Map((curManifest?.files ?? []).map((f) => [f.path, f.sha256]));
    const todo = filesToFetch(m, builtIn);
    const total = todo.filter((f) => !curId || fromCur.get(f.path) !== f.sha256).reduce((n, f) => n + f.bytes, 0);
    transfer = { state: "downloading", done: 0, total };
    publish();
    try {
      await dev.remove(dest);
      for (const f of todo) {
        // a ride starting stops the download; it starts again, from the top, when the ride ends
        if (deps.riding()) throw new Error("a ride started");
        const at = `${dest}/${f.path}`;
        if (curId && fromCur.get(f.path) === f.sha256) {
          let copied = false;
          try { await dev.copy(`app/${curId}/${f.path}`, at); copied = await matches(at, f); } catch { copied = false; }
          if (copied) continue;
          transfer.total += f.bytes; // the copy failed: download it after all
        }
        const url = f.path === "index.html" ? `${deps.siteUrl}app/index.html` : `${deps.siteUrl}${encodePath(f.path)}`;
        await dev.download(url, at);
        if (!(await matches(at, f))) throw new Error(`${f.path} does not match its checksum`);
        transfer.done += f.bytes;
        publish();
      }
      // the manifest goes in last: a folder with bundle.json is a complete one
      await dev.write(`${dest}/bundle.json`, textToB64(JSON.stringify(m)));
      record[version] = { builtAt: m.builtAt, native: m.native };
      saveRecord();
      transfer = null;
    } catch {
      transfer = { state: "failed", done: transfer?.done ?? 0, total: transfer?.total ?? total };
      try { await dev.remove(dest); } catch { /* cleaned at the next start */ }
    } finally {
      downloading = null;
    }
  }

  async function act(a: AppPlan["action"]): Promise<boolean> {
    if (!deps.plugin) return false;
    switch (a.kind) {
      case "none": return false;
      case "download": await download(a.version); return transfer?.state !== "failed";
      case "stage":
        try { await deps.plugin.stage({ id: a.version }); } catch {
          // the native side refused it (a folder it cannot use): forget it, so it is downloaded again
          delete record[a.version]; saveRecord();
          await dev.remove(`app/${a.version}`).catch(() => {});
        }
        await refreshInfo();
        return true;
      case "unstage":
        try { await deps.plugin.unstage(); } catch { /* nothing staged */ }
        await refreshInfo();
        return info?.next ? false : true;
    }
  }

  function pump(): Promise<void> {
    if (!pumping) {
      pumping = (async () => {
        try {
          for (let i = 0; i < 6; i++) {
            const p = publish();
            if (!(await act(p.action))) break;
          }
          publish();
        } finally { pumping = null; }
      })();
    }
    return pumping;
  }

  async function readSite(): Promise<void> {
    try {
      const res = await dev.getText(`${deps.siteUrl}app/manifest.json`, MANIFEST_TIMEOUT_MS);
      if (res.status !== 200) return;
      const m = validManifest(JSON.parse(res.text));
      if (!m) return;
      site = m;
      lastOkCheck = deps.now();
      workOutCost();
    } catch { /* unreachable: the phone keeps the code it has */ }
  }

  function check(force = false): Promise<void> {
    if (!started) return Promise.resolve();
    if (!force && deps.now() - lastOkCheck < CHECK_EVERY_MS) return pump();
    checking ??= readSite().finally(() => { checking = null; });
    return checking.then(() => pump());
  }

  return {
    async start() {
      if (started) return;
      started = true;
      try { record = JSON.parse(deps.storage.getItem(RECORD_KEY) ?? "{}") as Record<string, BundleRecord>; } catch { record = {}; }
      try { builtIn = validManifest(await deps.ownManifest()); } catch { builtIn = null; }
      await refreshInfo();
      if (info?.current) curManifest = await readBundle(info.current);
      await reconcile();
      publish();
      await check(true);
    },
    check,
    async fetch() {
      wanted = true;
      if (transfer?.state === "failed") transfer = null;
      if (!site) await check(true);
      await pump();
    },
    async restart() {
      if (deps.riding() || !deps.plugin) return;
      await deps.plugin.restart();
    },
    async useInstalled() {
      if (!deps.plugin) return;
      await deps.plugin.reset();
    },
    async rideStarted() { await pump(); },
    async rideEnded() { await pump(); },
    current: () => last,
  };
}

/* ------------------------------------------------------------------ the app's store */

let real: AppStore | null = null;
let starting: Promise<void> | null = null;

async function realDeps(): Promise<AppStoreDeps> {
  const [{ capacitorDevice }, { loadUpdater }, { rideStartedAt }, { SITE_URL, appUpdate }] = await Promise.all([
    import("../routes/files"), import("./native"), import("../ride"), import("../state"),
  ]);
  const base = import.meta.env.BASE_URL;
  return {
    device: await capacitorDevice(),
    plugin: await loadUpdater(),
    siteUrl: SITE_URL,
    ownManifest: async () => {
      try { const r = await fetch(`${base}app/manifest.json`); return r.ok ? ((await r.json()) as AppManifest) : null; } catch { return null; }
    },
    storage: localStorage,
    now: () => Date.now(),
    wifi: () => {
      const c = (navigator as { connection?: { type?: string; saveData?: boolean } }).connection;
      return !!c && !c.saveData && (c.type === "wifi" || c.type === "ethernet");
    },
    riding: () => rideStartedAt() !== null,
    publish: (s) => { appUpdate.value = s; },
  };
}

/** The app's store. `start()` once on the Android app; the other calls do nothing before it. */
export const appStore = {
  start(): Promise<void> {
    starting ??= (async () => {
      real = createAppStore(await realDeps());
      const on = (): void => { void real?.check(); };
      window.addEventListener("online", on);
      (navigator as { connection?: EventTarget }).connection?.addEventListener("change", on);
      await real.start();
    })().catch(() => { /* no plugin, no device: the app runs as installed */ });
    return starting;
  },
  check: (force = false): Promise<void> => real?.check(force) ?? Promise.resolve(),
  fetch: (): Promise<void> => real?.fetch() ?? Promise.resolve(),
  restart: (): Promise<void> => real?.restart() ?? Promise.resolve(),
  useInstalled: (): Promise<void> => real?.useInstalled() ?? Promise.resolve(),
  rideStarted: (): Promise<void> => real?.rideStarted() ?? Promise.resolve(),
  rideEnded: (): Promise<void> => real?.rideEnded() ?? Promise.resolve(),
};
