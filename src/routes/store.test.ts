import { describe, expect, it } from "vitest";
import type { PackIndexEntry, RouteStatus } from "../types";
import { memoryDevice, sha256Hex, textToB64, b64ToText, type MemoryDevice } from "./files";
import { createRouteStore, type RouteStore, type StoreDeps } from "./store";

const SITE = "https://site.test/";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Route { entry: PackIndexEntry; manifest: object; files: Record<string, string> }

/** A route as tools/pack_manifest.py would write it. */
async function route(id: string, files: Record<string, string>, updated: string, opts: { format?: number; stops?: string[] } = {}): Promise<Route> {
  const all: Record<string, string> = {
    "pack.json": JSON.stringify({ id, stops: (opts.stops ?? ["s1", "s2"]).map((s) => ({ id: s, ambience: "water", stories: [{ mood: "bright" }] })) }),
    ...files,
  };
  const list = [];
  for (const [path, text] of Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1))) {
    list.push({ path, bytes: enc(text).length, sha256: await sha256Hex(enc(text)) });
  }
  const version = (await sha256Hex(enc(list.map((f) => `${f.path}:${f.sha256}`).join("\n")))).slice(0, 16);
  const format = opts.format ?? 1;
  return {
    entry: { id, name: id, mode: "walking", km: 1, stops: 2, hero: `packs/${id}/hero.jpg`, blurb: "", version, bytes: list.reduce((n, f) => n + f.bytes, 0), updated, format },
    manifest: { id, version, format, files: list },
    files: all,
  };
}

function putSite(dev: MemoryDevice, r: Route): void {
  const id = r.entry.id;
  dev.site.set(`${SITE}packs/${id}/manifest.json`, textToB64(JSON.stringify(r.manifest)));
  for (const [p, t] of Object.entries(r.files)) dev.site.set(`${SITE}packs/${id}/${p}`, textToB64(t));
}
function putOwn(dev: MemoryDevice, r: Route): void {
  const id = r.entry.id;
  dev.own.set(`app://packs/${id}/manifest.json`, textToB64(JSON.stringify(r.manifest)));
  for (const [p, t] of Object.entries(r.files)) dev.own.set(`app://packs/${id}/${p}`, textToB64(t));
}
const putIndex = (dev: MemoryDevice, routes: Route[]): void => { dev.site.set(`${SITE}packs/index.json`, textToB64(JSON.stringify({ packs: routes.map((r) => r.entry) }))); };

interface Rig {
  dev: MemoryDevice; store: RouteStore; ctl: { wifi: boolean; riding: string | null; saved: string | null; clock: number };
  storage: Map<string, string>; cache: Map<string, Response>; status(): Record<string, RouteStatus>; index(): PackIndexEntry[];
}

function rig(opts: { builtIn?: Route[]; dev?: MemoryDevice; storage?: Map<string, string>; cache?: Map<string, Response> } = {}): Rig {
  const dev = opts.dev ?? memoryDevice();
  const storage = opts.storage ?? new Map<string, string>();
  const cache = opts.cache ?? new Map<string, Response>();
  const ctl = { wifi: true, riding: null as string | null, saved: null as string | null, clock: Date.parse("2026-01-01T00:00:00Z") };
  const builtIn = opts.builtIn ?? [];
  for (const r of builtIn) putOwn(dev, r);
  const out = { status: {} as Record<string, RouteStatus>, index: [] as PackIndexEntry[] };
  const deps: StoreDeps = {
    device: dev,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: (k) => { storage.delete(k); } },
    openCache: async () => ({ match: async (u) => cache.get(u), put: async (u, res) => { cache.set(u, res); } }),
    siteUrl: SITE,
    appFormat: 1,
    ownUrl: (p) => `app://${p}`,
    soundKey: (n) => `app://sounds/${n}.mp3`,
    loadBuiltIn: async () => builtIn.map((r) => r.entry),
    now: () => ctl.clock,
    wifi: () => ctl.wifi,
    riding: () => ctl.riding,
    savedRideId: () => ctl.saved,
    isBundled: (n) => n !== "music/bright",
    publish: (s, i) => { out.status = s; out.index = i; },
    setResolver: () => {},
  };
  return { dev, store: createRouteStore(deps), ctl, storage, cache, status: () => out.status, index: () => out.index };
}

const A_V1 = (): Promise<Route> => route("alpha", { "audio/a.mp3": "aaaa", "pic.jpg": "pppp" }, "2026-01-01T00:00:00Z");
const B_V1 = (): Promise<Route> => route("bravo", { "audio/b.mp3": "bbbbbbbb" }, "2026-02-01T00:00:00Z");

describe("route store", () => {
  it("1. first start with no network: the built-in routes are on the phone, nothing else", async () => {
    const a = await A_V1();
    const r = rig({ builtIn: [a] });
    await r.store.start();
    expect(Object.keys(r.status())).toEqual(["alpha"]);
    expect(r.status().alpha).toMatchObject({ kind: "on-phone", source: "built-in", update: null });
    expect(r.index().map((e) => e.id)).toEqual(["alpha"]);
    expect(r.store.baseFor("alpha")).toBeNull();
  });

  it("2. a new route on the site, on Wi-Fi, downloads and is used from its folder", async () => {
    const a = await A_V1(), b = await B_V1();
    const r = rig({ builtIn: [a] });
    putIndex(r.dev, [a, b]); putSite(r.dev, b);
    await r.store.start();
    expect(r.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded", version: b.entry.version });
    expect(r.store.baseFor("bravo")).toBe(`mem://packs/bravo/${b.entry.version}/`);
    expect(b64ToText(r.dev.files.get(`packs/bravo/${b.entry.version}/audio/b.mp3`)!)).toBe("bbbbbbbb");
    expect(JSON.parse(r.storage.get("versta:routes")!).bravo.version).toBe(b.entry.version);
    expect(r.index().map((e) => e.id)).toEqual(["alpha", "bravo"]);
  });

  it("3. on mobile data the route waits on the site, and a tap downloads it", async () => {
    const b = await B_V1();
    const r = rig();
    r.ctl.wifi = false;
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    expect(r.status().bravo).toEqual({ kind: "on-site", bytes: b.entry.bytes, transfer: null, removed: false });
    expect(r.dev.requests.some((u) => u.endsWith("audio/b.mp3"))).toBe(false);
    await r.store.fetch("bravo");
    expect(r.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded" });
  });

  it("4. a download cut off half way leaves the old copy, and the next start cleans and restarts", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp", "extra.txt": "xx" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    let writes = 0;
    r.dev.beforeWrite = () => { if (++writes === 2) throw new Error("cut off"); };
    await r.store.start();
    const st = r.status().alpha as Extract<RouteStatus, { kind: "on-phone" }>;
    expect(st.source).toBe("built-in");
    expect(st.update?.transfer?.state).toBe("failed");
    expect([...r.dev.files.keys()].filter((k) => k.startsWith("packs/alpha/"))).toEqual([]);

    // The cut-off leaves a partial folder (a crash rather than a throw): the next start removes it.
    r.dev.files.set(`packs/alpha/${a2.entry.version}/pack.json`, "x");
    r.dev.beforeWrite = undefined;
    const again = rig({ builtIn: [a1], dev: r.dev, storage: r.storage });
    putIndex(again.dev, [a2]);
    await again.store.start();
    expect(again.status().alpha).toMatchObject({ kind: "on-phone", source: "downloaded", version: a2.entry.version });
    expect(again.dev.files.has(`packs/alpha/${a2.entry.version}/manifest.json`)).toBe(true);
  });

  it("5. an update arriving while that route is ridden is downloaded, held, and switched in when the ride ends", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    // The ride starts while the last file is being written: that file finishes, nothing is left to wait for.
    r.dev.afterWrite = (p) => { if (p.endsWith("pic.jpg")) r.ctl.riding = "alpha"; };
    await r.store.start();
    const held = r.status().alpha as Extract<RouteStatus, { kind: "on-phone" }>;
    expect(held.source).toBe("built-in");
    expect(held.update).toMatchObject({ ready: true, held: "riding" });
    expect(r.store.baseFor("alpha")).toBeNull();
    r.ctl.riding = null;
    await r.store.rideEnded();
    expect(r.status().alpha).toMatchObject({ kind: "on-phone", source: "downloaded", version: a2.entry.version, update: null });
  });

  it("5b. transfers wait while any ride runs, and resume when it ends", async () => {
    const b = await B_V1();
    const r = rig();
    r.ctl.riding = "other";
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    expect(r.status().bravo).toMatchObject({ kind: "on-site", transfer: null });
    expect(r.dev.requests.some((u) => u.includes("bravo/audio"))).toBe(false);
    r.ctl.riding = null;
    await r.store.rideEnded();
    expect(r.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded" });
  });

  it("6. changed stops with a saved ride are held until the saved ride is gone; the same stops switch at once", async () => {
    const a1 = await A_V1();
    const same = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const changed = await route("alpha", { "audio/a.mp3": "AAAA3", "pic.jpg": "pppp" }, "2026-03-02T00:00:00Z", { stops: ["s1", "s3"] });

    const r1 = rig({ builtIn: [a1] });
    r1.ctl.saved = "alpha";
    putIndex(r1.dev, [same]); putSite(r1.dev, same);
    await r1.store.start();
    expect(r1.status().alpha).toMatchObject({ source: "downloaded", update: null });

    const r2 = rig({ builtIn: [a1] });
    r2.ctl.saved = "alpha";
    putIndex(r2.dev, [changed]); putSite(r2.dev, changed);
    await r2.store.start();
    expect(r2.status().alpha).toMatchObject({ source: "built-in", update: { ready: true, held: "saved-ride" } });
    r2.ctl.saved = null;
    await r2.store.check();
    expect(r2.status().alpha).toMatchObject({ source: "downloaded", update: null });
  });

  it("7. a site route in a newer format needs the app and is never downloaded", async () => {
    const f2 = await route("future", { "a.mp3": "zz" }, "2026-02-01T00:00:00Z", { format: 2 });
    const r = rig();
    putIndex(r.dev, [f2]); putSite(r.dev, f2);
    await r.store.start();
    await r.store.fetch("future");
    expect(r.status().future).toEqual({ kind: "needs-app" });
    expect(r.dev.requests.some((u) => u.includes("future/"))).toBe(false);
  });

  it("7b. a newer-format update of a route on the phone is held needs-app and not downloaded", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "a.mp3": "zz" }, "2026-03-01T00:00:00Z", { format: 2 });
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    await r.store.start();
    await r.store.fetch("alpha");
    expect(r.status().alpha).toMatchObject({ source: "built-in", update: { held: "needs-app", ready: false } });
    expect(r.dev.requests.some((u) => u.includes("alpha/"))).toBe(false);
  });

  it("8. a removed route is not downloaded again by itself, and a tap brings it back", async () => {
    const b = await B_V1();
    const r = rig();
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    expect(await r.store.remove("bravo")).toBe(true);
    expect(r.status().bravo).toMatchObject({ kind: "on-site", removed: true });
    expect([...r.dev.files.keys()].filter((k) => k.startsWith("packs/"))).toEqual([]);
    await r.store.check(true);
    expect(r.status().bravo).toMatchObject({ kind: "on-site", removed: true });
    const again = rig({ dev: r.dev, storage: r.storage });
    await again.store.start();
    expect(again.status().bravo).toMatchObject({ kind: "on-site", removed: true });
    await again.store.fetch("bravo");
    expect(again.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded" });
    expect(JSON.parse(again.storage.get("versta:routes-removed")!)).toEqual([]);
  });

  it("9. a built-in copy newer than the downloaded one deletes the downloaded folder", async () => {
    const b1 = await route("bravo", { "audio/b.mp3": "old" }, "2026-02-01T00:00:00Z");
    const b2 = await route("bravo", { "audio/b.mp3": "new" }, "2026-06-01T00:00:00Z");
    const r = rig();
    putIndex(r.dev, [b1]); putSite(r.dev, b1);
    await r.store.start();
    expect(r.store.baseFor("bravo")).not.toBeNull();
    const apk = rig({ builtIn: [b2], dev: r.dev, storage: r.storage });
    await apk.store.start();
    expect(apk.status().bravo).toMatchObject({ source: "built-in", version: b2.entry.version });
    expect(apk.store.baseFor("bravo")).toBeNull();
    expect([...apk.dev.files.keys()].filter((k) => k.startsWith("packs/"))).toEqual([]);
    expect(JSON.parse(apk.storage.get("versta:routes")!)).toEqual({});
  });

  it("10. an unreachable site, or one answering 500, changes nothing", async () => {
    const a = await A_V1(), b = await B_V1();
    const r = rig({ builtIn: [a] });
    putIndex(r.dev, [a, b]); putSite(r.dev, b);
    await r.store.start();
    const before = JSON.stringify(r.status());
    r.dev.site.set(`${SITE}packs/index.json`, () => { throw new Error("offline"); });
    r.ctl.clock += 120_000;
    await r.store.check();
    expect(JSON.stringify(r.status())).toBe(before);
    r.dev.site.set(`${SITE}packs/index.json`, { status: 500 });
    r.ctl.clock += 120_000;
    await r.store.check();
    expect(JSON.stringify(r.status())).toBe(before);

    const cold = rig({ builtIn: [a] });
    cold.dev.site.set(`${SITE}packs/index.json`, { status: 500 });
    await cold.store.start();
    expect(Object.keys(cold.status())).toEqual(["alpha"]);
  });

  it("10b. the site is read at most once a minute, unless forced", async () => {
    const a = await A_V1();
    const r = rig({ builtIn: [a] });
    putIndex(r.dev, [a]);
    await r.store.start();
    const reads = (): number => r.dev.requests.filter((u) => u.endsWith("packs/index.json")).length;
    await r.store.check();
    r.ctl.clock += 30_000;
    await r.store.check();
    expect(reads()).toBe(1);
    r.ctl.clock += 31_000;
    await r.store.check();
    expect(reads()).toBe(2);
  });

  it("11. a file whose checksum does not match fails the transfer, keeps the old copy and cleans the folder", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    r.dev.site.set(`${SITE}packs/alpha/audio/a.mp3`, textToB64("AAAA9")); // same length, other bytes
    await r.store.start();
    const st = r.status().alpha as Extract<RouteStatus, { kind: "on-phone" }>;
    expect(st.source).toBe("built-in");
    expect(st.update?.transfer?.state).toBe("failed");
    expect([...r.dev.files.keys()].filter((k) => k.startsWith("packs/"))).toEqual([]);
    expect(r.storage.get("versta:routes")).toBe("{}");
  });

  it("12. a sound the APK lacks lands in the versta-sounds cache under the app's own URL", async () => {
    const b = await B_V1();
    const r = rig();
    putIndex(r.dev, [b]); putSite(r.dev, b);
    r.dev.site.set(`${SITE}sounds/music/bright.mp3`, textToB64("MP3DATA"));
    r.dev.site.set(`${SITE}sounds/credits.json`, textToB64("[{\"file\":\"sounds/music/bright.mp3\"}]"));
    await r.store.start();
    const hit = r.cache.get("app://sounds/music/bright.mp3");
    expect(hit).toBeDefined();
    expect(await hit!.text()).toBe("MP3DATA");
    expect(hit!.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.cache.size).toBe(1);
    expect(r.storage.get("versta:site-credits")).toContain("music/bright.mp3");
  });

  it("12b. a missing sound is silence, not a failure", async () => {
    const b = await B_V1();
    const r = rig();
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    expect(r.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded" });
    expect(r.cache.size).toBe(0);
  });

  it("13. an update costs only the changed files' bytes, from a downloaded copy and from the built-in one", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    await r.store.start();
    // pack.json is the same text; only audio/a.mp3 changed
    const fetched = r.dev.requests.filter((u) => u.includes("packs/alpha/") && !u.endsWith("manifest.json"));
    expect(fetched).toEqual([`${SITE}packs/alpha/audio/a.mp3`]);
    expect(r.storage.get("versta:routes")).toContain(a2.entry.version);
    expect(b64ToText(r.dev.files.get(`packs/alpha/${a2.entry.version}/pic.jpg`)!)).toBe("pppp");

    // A third version on top of the downloaded copy: unchanged files are copied on the phone.
    const a3 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "PPPPPP" }, "2026-04-01T00:00:00Z");
    putIndex(r.dev, [a3]); putSite(r.dev, a3);
    r.dev.requests.length = 0;
    r.ctl.clock += 120_000;
    await r.store.check();
    const fetched3 = r.dev.requests.filter((u) => u.includes("packs/alpha/") && !u.endsWith("manifest.json"));
    expect(fetched3).toEqual([`${SITE}packs/alpha/pic.jpg`]);
    expect(r.status().alpha).toMatchObject({ source: "downloaded", version: a3.entry.version, update: null });
    expect([...r.dev.files.keys()].filter((k) => k.startsWith(`packs/alpha/${a2.entry.version}/`))).toEqual([]);
  });

  it("13b. the update's cost and Transfer.total count only the changed files' bytes", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    r.ctl.wifi = false;
    await r.store.start();
    // only audio/a.mp3 changed: 5 bytes, the unchanged picture is copied, not downloaded
    expect(r.status().alpha).toMatchObject({ update: { bytes: 5, held: "not-wifi" } });
    const seen: { done: number; total: number }[] = [];
    r.dev.afterWrite = () => {
      const st = r.status().alpha;
      const t = st?.kind === "on-phone" ? st.update?.transfer : null;
      if (t) seen.push({ done: t.done, total: t.total });
    };
    await r.store.fetch("alpha");
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) expect(t.total).toBe(5);
    expect(JSON.parse(r.storage.get("versta:routes")!).alpha.version).toBe(a2.entry.version);
  });

  it("on mobile data an update waits with held not-wifi and its cost, then a tap downloads it", async () => {
    const a1 = await A_V1();
    const a2 = await route("alpha", { "audio/a.mp3": "AAAA2", "pic.jpg": "pppp" }, "2026-03-01T00:00:00Z");
    const r = rig({ builtIn: [a1] });
    r.ctl.wifi = false;
    putIndex(r.dev, [a2]); putSite(r.dev, a2);
    await r.store.start();
    expect(r.status().alpha).toMatchObject({ source: "built-in", update: { held: "not-wifi", ready: false, transfer: null } });
    await r.store.fetch("alpha");
    expect(r.status().alpha).toMatchObject({ source: "downloaded", update: null });
  });

  it("a ridden route cannot be removed", async () => {
    const b = await B_V1();
    const r = rig();
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    r.ctl.riding = "bravo";
    expect(await r.store.remove("bravo")).toBe(false);
    expect(r.status().bravo).toMatchObject({ kind: "on-phone", source: "downloaded" });
  });

  it("a record whose files are gone is forgotten at start", async () => {
    const b = await B_V1();
    const r = rig();
    putIndex(r.dev, [b]); putSite(r.dev, b);
    await r.store.start();
    r.dev.files.clear();
    const again = rig({ dev: r.dev, storage: r.storage });
    again.ctl.wifi = false;
    await again.store.start();
    expect(again.status().bravo).toMatchObject({ kind: "on-site" });
  });
});
