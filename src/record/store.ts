/**
 * Where ride recordings live: IndexedDB database "versta-rides", one record per ride keyed by startedAt.
 * The storage sits behind a small interface so unit tests use an in-memory one (no IndexedDB package is allowed).
 */
import { geoDistance } from "../geo";
import { isNative } from "../native/platform";
import type { RideRecording } from "../types";

export interface RecordingStorage {
  put(r: RideRecording): Promise<void>;
  get(id: number): Promise<RideRecording | undefined>;
  remove(id: number): Promise<void>;
  all(): Promise<RideRecording[]>;
}

/** A store that keeps everything in memory. For tests. `failWith` makes every call reject. */
export function memoryStorage(failWith?: Error): RecordingStorage & { rows: Map<number, RideRecording> } {
  const rows = new Map<number, RideRecording>();
  const guard = <T,>(f: () => T): Promise<T> => (failWith ? Promise.reject(failWith) : Promise.resolve(f()));
  return {
    rows,
    put: (r) => guard(() => { rows.set(r.startedAt, structuredClone(r)); }),
    get: (id) => guard(() => { const r = rows.get(id); return r ? structuredClone(r) : undefined; }),
    remove: (id) => guard(() => { rows.delete(id); }),
    all: () => guard(() => [...rows.values()].map((r) => structuredClone(r))),
  };
}

const DB = "versta-rides";
const TABLE = "rides";

/** The device's IndexedDB. Opened on first use; every call rejects when the browser has none. */
export function idbStorage(): RecordingStorage {
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(TABLE, { keyPath: "startedAt" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    });
    opened.catch(() => { opened = null; });
    return opened;
  };
  const run = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(TABLE, mode);
      const req = f(tx.objectStore(TABLE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
    });
  };
  return {
    put: async (r) => { await run("readwrite", (s) => s.put(r)); },
    get: (id) => run<RideRecording | undefined>("readonly", (s) => s.get(id)),
    remove: async (id) => { await run("readwrite", (s) => s.delete(id)); },
    all: () => run<RideRecording[]>("readonly", (s) => s.getAll()),
  };
}

let storage: RecordingStorage | null = null;
/** The storage in use. The app gets IndexedDB; tests swap in memoryStorage(). */
export function useStorage(s: RecordingStorage | null): void { storage = s; }
export function currentStorage(): RecordingStorage { storage ??= idbStorage(); return storage; }

/** How many rides are kept. */
export const KEEP_RIDES = 10;

export interface RecordingSummary {
  startedAt: number;
  packId: string;
  endedAt: number | null;
  fixes: number;
  /** Kilometres between consecutive fixes. */
  km: number;
  /** From the start to the end, or to the last fix when the ride was never ended. Milliseconds. */
  durationMs: number;
}

export function summarise(r: RideRecording): RecordingSummary {
  let m = 0;
  for (let i = 1; i < r.fixes.length; i++) {
    const a = r.fixes[i - 1]!, b = r.fixes[i]!;
    m += geoDistance([a.lng, a.lat], [b.lng, b.lat]);
  }
  const last = r.fixes.at(-1)?.time ?? r.startedAt;
  return { startedAt: r.startedAt, packId: r.packId, endedAt: r.endedAt, fixes: r.fixes.length, km: m / 1000, durationMs: Math.max(0, (r.endedAt ?? last) - r.startedAt) };
}

/** Recorded rides, newest first. Empty when storage fails. */
export async function listRecordings(): Promise<RecordingSummary[]> {
  try { return (await currentStorage().all()).map(summarise).sort((a, b) => b.startedAt - a.startedAt); } catch { return []; }
}
export async function getRecording(id: number): Promise<RideRecording | null> {
  try { return (await currentStorage().get(id)) ?? null; } catch { return null; }
}
export async function deleteRecording(id: number): Promise<void> {
  try { await currentStorage().remove(id); } catch { /* nothing to do */ }
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** The JSON file a rider can send: "versta-ride-<pack>-<yyyy-mm-dd-hhmm>.json", in the phone's local time. */
export function recordingFile(r: RideRecording): { name: string; text: string } {
  const d = new Date(r.startedAt);
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return { name: `versta-ride-${r.packId}-${when}.json`, text: JSON.stringify(r) };
}

/** Android app: hand the file to the system share sheet. The master fills this in. */
/**
 * The Android app: write the file to the app's cache and hand it to the share sheet, so the rider can send it by
 * mail or a chat app. @capacitor/share is the only way to give a file to another app on Android.
 */
export async function exportRecordingNative(file: { name: string; text: string }): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const written = await Filesystem.writeFile({ path: `rides/${file.name}`, data: file.text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  await Share.share({ title: "Versta ride recording", files: [written.uri], dialogTitle: "Send the ride recording" });
}

/** Save the recording as a file: a download on the web, the share sheet in the Android app. */
export async function saveRecordingFile(r: RideRecording): Promise<void> {
  const file = recordingFile(r);
  if (isNative()) { await exportRecordingNative(file); return; }
  const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
