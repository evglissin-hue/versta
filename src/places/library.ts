/** Where the Nearby screen gets its places: the site's places.json, with the phone's last good copy behind it. */
import { isNative } from "../native/platform";
import { SITE_URL } from "../state";
import type { PlacesFile } from "../types";

const KEY = "versta:places";
const TIMEOUT_MS = 10_000;

const valid = (j: unknown): j is PlacesFile =>
  !!j && typeof j === "object" && Array.isArray((j as PlacesFile).places) && typeof (j as PlacesFile).version === "string";

async function getJson(url: string, timeoutMs?: number): Promise<unknown> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl && timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error(`places ${r.status}`);
    return await r.json();
  } finally { if (timer) clearTimeout(timer); }
}

/** Web: the site's own copy. Android app: the site's copy when reachable (kept), else the last kept copy, else the one inside the app. */
export async function loadPlaces(): Promise<PlacesFile> {
  const own = `${import.meta.env.BASE_URL}places.json`;
  if (!isNative()) {
    const j = await getJson(own);
    if (!valid(j)) throw new Error("places.json is not valid");
    return j;
  }
  try {
    const j = await getJson(`${SITE_URL}places.json`, TIMEOUT_MS);
    if (valid(j)) {
      try { localStorage.setItem(KEY, JSON.stringify(j)); } catch { /* storage full: next start fetches again */ }
      return j;
    }
  } catch { /* offline or slow: use what the phone has */ }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const j: unknown = JSON.parse(raw); if (valid(j)) return j; }
  } catch { /* unreadable copy: ignore */ }
  const j = await getJson(own);
  if (!valid(j)) throw new Error("places.json is not valid");
  return j;
}
