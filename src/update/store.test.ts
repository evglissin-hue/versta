import { describe, expect, it } from "vitest";
import type { AppUpdateState } from "../types";
import { memoryDevice, sha256Hex, textToB64, b64ToText, type MemoryDevice } from "../routes/files";
import { filesToFetch, planApp, type AppManifest, type AppPlanInput } from "./plan";
import { createAppStore, validManifest, type AppStoreDeps } from "./store";
import type { UpdaterApi, UpdaterInfo } from "./native";

const SITE = "https://site.test/";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Bundle { manifest: AppManifest; files: Record<string, string> }

/** A bundle as tools/app_manifest.mjs would describe it. */
async function bundle(files: Record<string, string>, builtAt: string, native = 1): Promise<Bundle> {
  const list = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) list.push({ path, bytes: enc(text).length, sha256: await sha256Hex(enc(text)) });
  const version = (await sha256Hex(enc(list.map((f) => `${f.path}:${f.sha256}`).join("\n")))).slice(0, 16);
  return { manifest: { version, builtAt, native, commit: null, files: list }, files };
}

function putSite(dev: MemoryDevice, b: Bundle): void {
  dev.site.set(`${SITE}app/manifest.json`, textToB64(JSON.stringify(b.manifest)));
  for (const [p, t] of Object.entries(b.files)) dev.site.set(p === "index.html" ? `${SITE}app/index.html` : `${SITE}${p}`, textToB64(t));
}

/** The native plugin as the Java side behaves: it checks a staged folder has bundle.json and is not bad. */
function fakePlugin(dev: MemoryDevice, level = 1): UpdaterApi & { info0: UpdaterInfo; calls: string[] } {
  const info0: UpdaterInfo = { level, versionCode: 13, versionName: "0.2.13", current: null, next: null, previous: null, trial: false, bad: [] };
  const calls: string[] = [];
  return {
    info0, calls,
    info: async () => ({ ...info0, bad: [...info0.bad] }),
    stage: async ({ id }) => {
      calls.push(`stage ${id}`);
      if (info0.bad.includes(id) || !dev.files.has(`app/${id}/bundle.json`)) throw new Error("That bundle cannot be used.");
      info0.next = id;
    },
    unstage: async () => { calls.push("unstage"); info0.next = null; },
    ready: async () => { calls.push("ready"); info0.trial = false; },
    restart: async () => { calls.push("restart"); if (!info0.next) throw new Error("Nothing is staged."); info0.previous = info0.current; info0.current = info0.next; info0.next = null; info0.trial = true; },
    reset: async () => { calls.push("reset"); if (info0.current) info0.bad.push(info0.current); info0.current = null; info0.next = null; info0.previous = null; },
  };
}

interface Rig { dev: MemoryDevice; plugin: ReturnType<typeof fakePlugin>; ctl: { wifi: boolean; riding: boolean; clock: number }; states: AppUpdateState[]; store: ReturnType<typeof createAppStore>; storage: Map<string, string> }

function rig(builtIn: Bundle, opts: { dev?: MemoryDevice; plugin?: ReturnType<typeof fakePlugin>; storage?: Map<string, string> } = {}): Rig {
  const dev = opts.dev ?? memoryDevice();
  const plugin = opts.plugin ?? fakePlugin(dev);
  const storage = opts.storage ?? new Map<string, string>();
  const ctl = { wifi: true, riding: false, clock: Date.parse("2026-11-26T10:00:00Z") };
  const states: AppUpdateState[] = [];
  const deps: AppStoreDeps = {
    device: dev, plugin, siteUrl: SITE,
    ownManifest: async () => builtIn.manifest,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: (k) => { storage.delete(k); } },
    now: () => ctl.clock, wifi: () => ctl.wifi, riding: () => ctl.riding,
    publish: (s) => { states.push(s); },
  };
  return { dev, plugin, ctl, states, store: createAppStore(deps), storage };
}

const APK = (): Promise<Bundle> => bundle({ "index.html": "<html>v1</html>", "assets/app-1.js": "code one", "sounds/a.mp3": "AAAA" }, "2026-11-25T16:00:00Z");
const NEXT = (): Promise<Bundle> => bundle({ "index.html": "<html>v2</html>", "assets/app-2.js": "code two", "sounds/a.mp3": "AAAA" }, "2026-11-26T09:00:00Z");
const last = (r: Rig): AppUpdateState => r.states[r.states.length - 1]!;

describe("app update store", () => {
  it("1. nothing newer on the site: up to date, the installed version runs", async () => {
    const apk = await APK();
    const r = rig(apk);
    putSite(r.dev, apk);
    await r.store.start();
    expect(last(r)).toEqual({ running: { version: apk.manifest.version, builtAt: apk.manifest.builtAt, source: "installed" }, status: { kind: "none" } });
    expect(r.plugin.calls).toEqual([]);
  });

  it("2. a newer version on Wi-Fi downloads only the files that differ from the APK, checks them and is staged", async () => {
    const apk = await APK(), next = await NEXT();
    const r = rig(apk);
    putSite(r.dev, next);
    await r.store.start();
    const v = next.manifest.version;
    expect(last(r).status).toEqual({ kind: "ready" });
    expect(r.plugin.calls).toEqual([`stage ${v}`]);
    // the unchanged sound is served from the APK: never downloaded, never stored
    expect(r.dev.requests.filter((u) => u.endsWith(".mp3"))).toEqual([]);
    expect([...r.dev.files.keys()].sort()).toEqual([`app/${v}/assets/app-2.js`, `app/${v}/bundle.json`, `app/${v}/index.html`]);
    expect(b64ToText(r.dev.files.get(`app/${v}/index.html`)!)).toBe("<html>v2</html>");
    expect(JSON.parse(r.storage.get("versta:app-bundles")!)[v]).toEqual({ builtAt: next.manifest.builtAt, native: 1 });
  });

  it("3. on mobile data it waits with its size, and a tap downloads it", async () => {
    const apk = await APK(), next = await NEXT();
    const r = rig(apk);
    r.ctl.wifi = false;
    putSite(r.dev, next);
    await r.store.start();
    const bytes = filesToFetch(next.manifest, apk.manifest).reduce((n, f) => n + f.bytes, 0);
    expect(last(r).status).toEqual({ kind: "available", bytes, held: "not-wifi" });
    expect(r.dev.requests.some((u) => u.endsWith(".js"))).toBe(false);
    await r.store.fetch();
    expect(last(r).status).toEqual({ kind: "ready" });
  });

  it("4. a file that does not match its checksum fails the download and leaves nothing staged", async () => {
    const apk = await APK(), next = await NEXT();
    const r = rig(apk);
    putSite(r.dev, next);
    r.dev.site.set(`${SITE}assets/app-2.js`, textToB64("code twx"));
    await r.store.start();
    expect(last(r).status.kind).toBe("failed");
    expect(r.plugin.calls).toEqual([]);
    expect([...r.dev.files.keys()].filter((k) => k.startsWith("app/"))).toEqual([]);
    // fixed on the site, Try again gets it
    r.dev.site.set(`${SITE}assets/app-2.js`, textToB64("code two"));
    await r.store.fetch();
    expect(last(r).status).toEqual({ kind: "ready" });
  });

  it("5. never during a ride: no download starts, a staged version is taken off, and it comes back when the ride ends", async () => {
    const apk = await APK(), next = await NEXT();
    const r = rig(apk);
    r.ctl.riding = true;
    putSite(r.dev, next);
    await r.store.start();
    expect(r.dev.requests.some((u) => u.endsWith(".js"))).toBe(false);
    expect(last(r).status).toMatchObject({ kind: "available", held: "riding" });
    r.ctl.riding = false;
    await r.store.rideEnded();
    expect(r.plugin.info0.next).toBe(next.manifest.version);
    // a ride starts with the version staged: it is taken off, so a restart of the app mid-ride keeps the code in use
    r.ctl.riding = true;
    await r.store.rideStarted();
    expect(r.plugin.info0.next).toBeNull();
    await r.store.restart();
    expect(r.plugin.calls.includes("restart")).toBe(false);
    r.ctl.riding = false;
    await r.store.rideEnded();
    expect(r.plugin.info0.next).toBe(next.manifest.version);
    expect(last(r).status).toEqual({ kind: "ready" });
  });

  it("6. a version that needs newer native code is never downloaded: a one-time install", async () => {
    const apk = await APK();
    const future = await bundle({ "index.html": "<html>v3</html>", "assets/app-3.js": "needs more" }, "2026-11-27T09:00:00Z", 2);
    const r = rig(apk);
    putSite(r.dev, future);
    await r.store.start();
    expect(last(r).status).toEqual({ kind: "needs-app" });
    expect(r.dev.requests.some((u) => u.endsWith(".js"))).toBe(false);
  });

  it("7. the next version copies files it shares with the one in use instead of downloading them", async () => {
    const apk = await APK(), next = await NEXT();
    const third = await bundle({ "index.html": "<html>v3</html>", "assets/app-2.js": "code two", "sounds/a.mp3": "AAAA" }, "2026-11-27T09:00:00Z");
    const dev = memoryDevice();
    const plugin = fakePlugin(dev);
    const storage = new Map<string, string>();
    const first = rig(apk, { dev, plugin, storage });
    putSite(dev, next);
    await first.store.start();
    await plugin.restart(); // the rider tapped Restart now: next is in use
    // a new session (the page reloaded) finds a third version on the site
    putSite(dev, third);
    dev.requests.length = 0;
    const second = rig(apk, { dev, plugin, storage });
    await second.store.start();
    expect(last(second).running).toMatchObject({ version: next.manifest.version, source: "downloaded", builtAt: next.manifest.builtAt });
    expect(last(second).status).toEqual({ kind: "ready" });
    expect(dev.requests.filter((u) => u.endsWith(".js"))).toEqual([]);
    expect(b64ToText(dev.files.get(`app/${third.manifest.version}/assets/app-2.js`)!)).toBe("code two");
    // the bundle in use and the new one are kept; nothing else is lying about
    expect(new Set([...dev.files.keys()].map((k) => k.split("/")[1]))).toEqual(new Set([next.manifest.version, third.manifest.version]));
  });

  it("8. Use the installed version marks the downloaded one bad, so it is not offered again", async () => {
    const apk = await APK(), next = await NEXT();
    const dev = memoryDevice();
    const plugin = fakePlugin(dev);
    const r = rig(apk, { dev, plugin });
    putSite(dev, next);
    await r.store.start();
    await plugin.restart();
    await r.store.useInstalled();
    expect(plugin.info0.current).toBeNull();
    expect(plugin.info0.bad).toEqual([next.manifest.version]);
    const again = rig(apk, { dev, plugin });
    await again.store.start();
    expect(last(again).status).toEqual({ kind: "none" });
    expect(plugin.calls.filter((c) => c.startsWith("stage")).length).toBe(1);
  });

  it("9. an APK without the plugin only reports what runs", async () => {
    const apk = await APK(), next = await NEXT();
    const dev = memoryDevice();
    putSite(dev, next);
    const states: AppUpdateState[] = [];
    const store = createAppStore({
      device: dev, plugin: null, siteUrl: SITE, ownManifest: async () => apk.manifest,
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, now: () => 0, wifi: () => true, riding: () => false,
      publish: (s) => { states.push(s); },
    });
    await store.start();
    expect(states.at(-1)!.status).toEqual({ kind: "none" });
    expect(dev.requests.some((u) => u.endsWith(".js"))).toBe(false);
  });

  it("10. a manifest that is not what the build writes is ignored", () => {
    expect(validManifest(null)).toBeNull();
    expect(validManifest({ version: "x", builtAt: "", native: 1, files: [] })).toBeNull();
    expect(validManifest({ version: "0123456789abcdef", builtAt: "2026-01-01T00:00:00Z", native: 1, files: [{ path: "../etc", bytes: 1, sha256: "x" }, { path: "index.html", bytes: 1, sha256: "x" }] })).toBeNull();
    expect(validManifest({ version: "0123456789abcdef", builtAt: "2026-01-01T00:00:00Z", native: 1, files: [{ path: "assets/a.js", bytes: 1, sha256: "x" }] })).toBeNull();
  });
});

describe("app update plan", () => {
  const info = (o: Partial<UpdaterInfo> = {}): UpdaterInfo => ({ level: 1, versionCode: 1, versionName: "0.2.1", current: null, next: null, previous: null, trial: false, bad: [], ...o });
  const m = (version: string, builtAt: string, native = 1): AppManifest => ({ version, builtAt, native, commit: null, files: [{ path: "index.html", bytes: 10, sha256: "s" }] });
  const base = (o: Partial<AppPlanInput> = {}): AppPlanInput => ({
    builtIn: { version: "aaaaaaaaaaaaaaaa", builtAt: "2026-11-25T10:00:00Z" }, info: info(), record: {}, site: null,
    riding: false, wifi: true, wanted: false, transfer: null, cost: null, ...o,
  });

  it("an older site version is never taken, even when different", () => {
    const p = planApp(base({ site: m("bbbbbbbbbbbbbbbb", "2026-11-24T10:00:00Z") }));
    expect(p.status).toEqual({ kind: "none" });
    expect(p.action).toEqual({ kind: "none" });
  });

  it("a bad version is never taken again", () => {
    const p = planApp(base({ site: m("bbbbbbbbbbbbbbbb", "2026-11-26T10:00:00Z"), info: info({ bad: ["bbbbbbbbbbbbbbbb"] }) }));
    expect(p.status).toEqual({ kind: "none" });
  });

  it("a staged version still starts next time when the site cannot be read", () => {
    const p = planApp(base({ info: info({ next: "cccccccccccccccc" }), record: { cccccccccccccccc: { builtAt: "2026-11-26T10:00:00Z", native: 1 } } }));
    expect(p.status).toEqual({ kind: "ready" });
  });

  it("the running version is the downloaded one the plugin names", () => {
    const p = planApp(base({ info: info({ current: "cccccccccccccccc" }), record: { cccccccccccccccc: { builtAt: "2026-11-26T10:00:00Z", native: 1 } } }));
    expect(p.running).toEqual({ version: "cccccccccccccccc", builtAt: "2026-11-26T10:00:00Z", source: "downloaded" });
  });
});
