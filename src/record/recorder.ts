/**
 * The ride recorder: builds a RideRecording in memory while a real ride runs and saves it to the device every 30 s
 * and at the end, keeping the last 10 rides. It never throws into the ride: every storage error is swallowed.
 */
import type { DirectorLogEntry, Fix, NavEvent, RideRecording } from "../types";
import { KEEP_RIDES, currentStorage } from "./store";

export interface RecordingMeta { packId: string; version: string | null; startAt: number; app: string }

export interface RideRecorder {
  /** Every fix the ride sees, as it arrives. */
  fix(f: Fix): void;
  /** The nav events one fix produced, with that fix's time. Empty lists are ignored. */
  events(at: number, evs: readonly NavEvent[]): void;
  /** Every director log entry. */
  log(entry: DirectorLogEntry): void;
  /** A rider tap that changes the ride: "skip", "pause", "end", "choose_stop". */
  tap(what: string, arg?: string | number): void;
  /** The ride is over: stop the timer and save. Safe to call twice. */
  end(): void;
  /** The recording as it stands. */
  readonly recording: RideRecording;
}

export const SAVE_EVERY_MS = 30_000;

export function beginRecording(meta: RecordingMeta): RideRecorder {
  const recording: RideRecording = { startedAt: Date.now(), packId: meta.packId, version: meta.version, startAt: meta.startAt, app: meta.app, fixes: [], events: [], log: [], taps: [], endedAt: null };
  let chain: Promise<void> = Promise.resolve();
  let ended = false;
  let dirty = true;

  const save = (): void => {
    if (!dirty) return;
    dirty = false;
    chain = chain.then(async () => {
      try {
        const s = currentStorage();
        await s.put(recording);
        const all = await s.all();
        const old = all.map((r) => r.startedAt).sort((a, b) => b - a).slice(KEEP_RIDES);
        for (const id of old) await s.remove(id);
      } catch { /* a full or missing store must not touch the ride */ }
    });
  };
  const timer = setInterval(save, SAVE_EVERY_MS);
  save();

  const mark = <T,>(list: T[], item: T): void => { if (!ended) { list.push(item); dirty = true; } };
  return {
    recording,
    fix: (f) => mark(recording.fixes, f),
    events: (at, evs) => { for (const event of evs) mark(recording.events, { at, event }); },
    log: (entry) => mark(recording.log, entry),
    tap: (what, arg) => mark(recording.taps, arg === undefined ? { at: Date.now(), what } : { at: Date.now(), what, arg }),
    end: () => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      recording.endedAt = Date.now();
      dirty = true;
      save();
    },
  };
}
