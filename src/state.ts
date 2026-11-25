/** App-wide state as signals. Modules read and write through here; components subscribe by reading `.value`. */
import { signal } from "@preact/signals";
import { DEFAULT_SETTINGS, type DirectorLogEntry, type GpsError, type NavState, type NowPlaying, type Pack, type PackIndexEntry, type RouteStatus, type Settings, type StartChoice, type UpdateCheck, type AppUpdateState } from "./types";

export const IDLE_NAV: NavState = {
  status: "idle", fix: null, snapped: null, seg: 0, alongSeg: 0, toStop: 0, distanceDone: 0, distanceLeft: 0,
  routeBearing: null, offRoute: false, offBy: 0, nextCue: null, toCue: null, currentCue: null, arrived: [],
};

function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("versta:settings") ?? "{}") }; } catch { return { ...DEFAULT_SETTINGS }; }
}

export const packIndex = signal<PackIndexEntry[]>([]);
export const pack = signal<Pack | null>(null);
export const screen = signal<"home" | "ride">("home");
export const nav = signal<NavState>(IDLE_NAV);
export const nowPlaying = signal<NowPlaying>(null);
export const gpsError = signal<GpsError | null>(null);
export const settings = signal<Settings>(loadSettings());
export const directorLog = signal<DirectorLogEntry[]>([]);
/** Stop whose sheet is open, or null. */
export const openStop = signal<number | null>(null);
/** True when the ride is driven by the built-in simulator instead of the device GPS. */
export const simulated = signal(false);

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  try { localStorage.setItem("versta:settings", JSON.stringify(settings.value)); } catch {}
}

/** Base URL of a pack's folder, with a trailing slash. Pack-relative paths (audio, pictures) resolve against it. */
/** The site the Android app downloads routes, places and sounds from. VITE_SITE_URL overrides it (tests). */
export const SITE_URL: string = (import.meta.env?.VITE_SITE_URL as string | undefined) ?? "https://versta.evglissin.workers.dev/";
/** The newest pack format this app reads (PackIndexEntry.format). Raise it when the app learns a new one. */
export const PACK_FORMAT = 1;

/** A ride waiting for the rider to choose where to start (task 25 shows it), or null. */
export const startChoice = signal<StartChoice | null>(null);

/** What the Android app has of each route (task 22 keeps it, task 23 shows it). Empty on the web. */
export const routeStatus = signal<Record<string, RouteStatus>>({});

/** The route store's last look at the site (Android app), for the Updates panel on Home. */
export const updateCheck = signal<UpdateCheck>({ checking: false, at: null, ok: null });

/** The app's own code on the Android app: what runs, and what newer version there is (src/update). */
export const appUpdate = signal<AppUpdateState>({ running: null, status: { kind: "none" } });

let baseResolver: ((id: string) => string | null) | null = null;
/** The route store sets this on the Android app: the folder of a downloaded route, or null for the app's own. */
export function setPackBaseResolver(fn: ((id: string) => string | null) | null): void { baseResolver = fn; }

/** The folder (with a trailing slash) a route's files are read from. Every reader of pack files goes through here. */
export function packBase(id: string): string {
  const own = baseResolver?.(id);
  if (own) return own;
  return `${import.meta.env.BASE_URL}packs/${id}/`;
}

/**
 * The picture of a route card. `entry.hero` is relative to the site root ("packs/<id>/img/x.jpg"). A route on the
 * phone reads it from its own folder; a route only on the site (Android) reads it from the site.
 */
export function heroSrc(entry: PackIndexEntry): string {
  const st = routeStatus.value[entry.id];
  const prefix = `packs/${entry.id}/`;
  if (st && st.kind !== "on-phone") return `${SITE_URL}${entry.hero}`;
  return entry.hero.startsWith(prefix) ? `${packBase(entry.id)}${entry.hero.slice(prefix.length)}` : `${import.meta.env.BASE_URL}${entry.hero}`;
}
