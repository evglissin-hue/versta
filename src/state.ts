/** App-wide state as signals. Modules read and write through here; components subscribe by reading `.value`. */
import { signal } from "@preact/signals";
import { DEFAULT_SETTINGS, type DirectorLogEntry, type GpsError, type NavState, type NowPlaying, type Pack, type PackIndexEntry, type Settings } from "./types";

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
export function packBase(id: string): string {
  return `${import.meta.env.BASE_URL}packs/${id}/`;
}
