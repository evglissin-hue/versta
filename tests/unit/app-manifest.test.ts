import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain ES module from tools/, without types
import { androidIndex, buildManifest, excluded } from "../../tools/app_manifest.mjs";

interface Built { manifest: { version: string; builtAt: string; native: number; commit: string | null; files: { path: string; bytes: number; sha256: string }[] }; index: string }

const INDEX = '<html><head><script id="vite-plugin-pwa:register-sw" src="./registerSW.js"></script><script src="./assets/a.js"></script></head></html>';

function dist(): string {
  const d = mkdtempSync(join(tmpdir(), "versta-dist-"));
  const put = (p: string, t: string): void => { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), t); };
  put("index.html", INDEX);
  put("assets/a.js", "console.log(1)");
  put("assets/a.js.map", "{}");
  put("sounds/fx/gull.mp3", "MP3");
  put("packs/x/pack.json", "{}");
  put("app/manifest.json", "{}");
  put("places.json", "{}");
  put("sw.js", "sw");
  put("workbox-1234.js", "wb");
  put("registerSW.js", "reg");
  return d;
}

describe("the app bundle manifest (tools/app_manifest.mjs)", () => {
  it("lists the Android bundle: no routes, places, service worker, maps or app folder; index.html as Android has it", () => {
    const { manifest, index } = buildManifest(dist(), 1, "2026-11-25T16:00:00Z", "abc") as Built;
    expect(manifest.files.map((f) => f.path)).toEqual(["assets/a.js", "index.html", "sounds/fx/gull.mp3"]);
    expect(index).not.toContain("register-sw");
    const idx = manifest.files.find((f) => f.path === "index.html")!;
    expect(idx.sha256).toBe(createHash("sha256").update(index).digest("hex"));
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest).toMatchObject({ builtAt: "2026-11-25T16:00:00Z", native: 1, commit: "abc" });
  });

  it("the version changes when any file does, and only then", () => {
    const a = (buildManifest(dist(), 1, "t1", null) as Built).manifest.version;
    const b = (buildManifest(dist(), 1, "t2", "other") as Built).manifest.version;
    expect(a).toBe(b);
    const d = dist();
    writeFileSync(join(d, "assets/a.js"), "console.log(2)");
    expect((buildManifest(d, 1, "t1", null) as Built).manifest.version).not.toBe(a);
  });

  it("androidIndex makes what android:sync's sed made, and excluded() keeps routes out", () => {
    expect(androidIndex(INDEX)).toBe('<html><head><script src="./assets/a.js"></script></head></html>');
    expect(excluded("packs/thames-loop/pack.json")).toBe(true);
    expect(excluded("sounds/x.mp3")).toBe(false);
  });
});
