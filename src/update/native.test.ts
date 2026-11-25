/**
 * Everything native, fingerprinted. A downloaded bundle runs on the APK the phone already has, so web code must never
 * reach a phone whose native side it does not match. When any of these files change, raise "level" in
 * src/update/native-api.json and NATIVE_LEVEL in AppUpdatePlugin.java together, and record the new fingerprint: the
 * phone then says a one-time install is needed instead of running code its APK cannot serve.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import api from "./native-api.json";

const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function nativeFingerprint(): string {
  const files = [
    ...walk(join(ROOT, "android/app/src/main/java")),
    ...walk(join(ROOT, "android/app/src/main/res")),
    "android/app/src/main/AndroidManifest.xml", "android/app/build.gradle", "android/build.gradle", "android/variables.gradle",
    "android/app/capacitor.build.gradle", "android/capacitor.settings.gradle", "capacitor.config.ts",
  ].map((p) => (p.startsWith("/") ? relative(ROOT, p) : p)).sort();
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\n`).update(readFileSync(join(ROOT, f))).update("\n");
  // the native code of every Capacitor plugin, by its locked version
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> };
  for (const [k, v] of Object.entries(lock.packages).filter(([k]) => /^node_modules\/@capacitor(-community)?\//.test(k)).sort()) h.update(`${k}@${v.version}\n`);
  return h.digest("hex").slice(0, 16);
}

describe("native code and the web code's native level", () => {
  it("the fingerprint of the native side is the one recorded with the level", () => {
    const now = nativeFingerprint();
    expect(now, `Native code, plugins or capacitor.config.ts changed. Raise "level" in src/update/native-api.json and NATIVE_LEVEL in AppUpdatePlugin.java together, then set "fingerprint" to ${now}.`).toBe(api.fingerprint);
  });

  it("the Java side's NATIVE_LEVEL equals the level in native-api.json", () => {
    const java = readFileSync(join(ROOT, "android/app/src/main/java/app/versta/ride/AppUpdatePlugin.java"), "utf8");
    const m = /NATIVE_LEVEL\s*=\s*(\d+)/.exec(java);
    expect(Number(m?.[1])).toBe(api.level);
  });
});
