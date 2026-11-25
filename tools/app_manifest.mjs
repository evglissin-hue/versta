// Writes the Android web bundle's manifest at the end of every build (docs/build/it7-35-app-updates.md):
//   dist/app/index.html     the Android index.html: the service worker registration removed
//   dist/app/manifest.json  { version, builtAt, native, commit, files: [{ path, bytes, sha256 }] }
// The files are every file of dist that the Android app is built from (android:sync), except the routes (packs/,
// kept up to date by the route store), places.json (read from the site), app/ itself, the service worker files and
// source maps. index.html is listed with the Android variant's bytes. version is the first 16 hex of the sha256 of
// the sorted "path:sha256" lines, so it changes when any file does.
// Usage: node tools/app_manifest.mjs [dist directory, default dist]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, "dist");

/** The Android index.html: the same transformation android:sync used to make with sed. */
export function androidIndex(html) {
  return html.replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, "");
}

/** Files of dist that are not part of the Android web bundle. */
export function excluded(path) {
  return path.startsWith("packs/") || path.startsWith("app/") || path === "places.json" || path === "sw.js"
    || path === "registerSW.js" || /^workbox-[^/]*\.js$/.test(path) || path.endsWith(".map");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function commitOf() {
  const env = process.env.GITHUB_SHA || process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (env) return env;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null; } catch { return null; }
}

export function buildManifest(dist, native, builtAt = new Date().toISOString().replace(/\.\d+Z$/, "Z"), commit = commitOf()) {
  const index = androidIndex(readFileSync(join(dist, "index.html"), "utf8"));
  const files = [];
  for (const abs of walk(dist)) {
    const path = relative(dist, abs).split(sep).join("/");
    if (excluded(path)) continue;
    const buf = path === "index.html" ? Buffer.from(index, "utf8") : readFileSync(abs);
    files.push({ path, bytes: buf.length, sha256: sha(buf) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const version = sha(files.map((f) => `${f.path}:${f.sha256}`).join("\n")).slice(0, 16);
  return { manifest: { version, builtAt, native, commit, files }, index };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const api = JSON.parse(readFileSync(join(ROOT, "src", "update", "native-api.json"), "utf8"));
  const { manifest, index } = buildManifest(DIST, api.level);
  mkdirSync(join(DIST, "app"), { recursive: true });
  writeFileSync(join(DIST, "app", "index.html"), index);
  writeFileSync(join(DIST, "app", "manifest.json"), JSON.stringify(manifest));
  const kb = Math.round(manifest.files.reduce((n, f) => n + f.bytes, 0) / 1024);
  console.log(`app bundle ${manifest.version}: ${manifest.files.length} files, ${kb} KB, native ${manifest.native}`);
}
