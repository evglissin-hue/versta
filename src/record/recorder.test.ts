import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fix, NavEvent } from "../types";
import { SAVE_EVERY_MS, beginRecording } from "./recorder";
import { KEEP_RIDES, deleteRecording, getRecording, listRecordings, memoryStorage, recordingFile, useStorage } from "./store";

const META = { packId: "thames-loop", version: "1", startAt: 0, app: "test" };
const fix = (i: number): Fix => ({ lng: 0.01 + i * 0.0001, lat: 51.5, accuracy: 5, heading: 90, speed: 5, time: Date.now() + i * 1000 });
const arrive: NavEvent = { type: "arrive", stop: 1 };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 5, 7, 9, 5)); });
afterEach(() => { vi.useRealTimers(); useStorage(null); });

describe("ride recorder", () => {
  it("keeps every fix, event, log entry and tap, and saves on its timer and at the end", async () => {
    const store = memoryStorage();
    useStorage(store);
    const rec = beginRecording(META);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.rows.size).toBe(1);
    for (let i = 0; i < 5; i++) rec.fix(fix(i));
    rec.events(1000, [arrive]);
    rec.events(2000, []);
    rec.log({ at: 1000, what: "arrive", id: "1" });
    rec.tap("skip", 2);
    rec.tap("pause");
    // nothing new is on the device until the timer fires
    expect(store.rows.get(rec.recording.startedAt)!.fixes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_EVERY_MS);
    const saved = store.rows.get(rec.recording.startedAt)!;
    expect(saved.fixes).toHaveLength(5);
    expect(saved.events).toEqual([{ at: 1000, event: arrive }]);
    expect(saved.log).toHaveLength(1);
    expect(saved.taps.map((t) => t.what)).toEqual(["skip", "pause"]);
    expect(saved.taps[0]!.arg).toBe(2);
    expect(saved.endedAt).toBeNull();
    rec.fix(fix(5));
    rec.end();
    await vi.advanceTimersByTimeAsync(0);
    const done = store.rows.get(rec.recording.startedAt)!;
    expect(done.fixes).toHaveLength(6);
    expect(done.endedAt).not.toBeNull();
    // after the end nothing more is added, and ending twice is harmless
    rec.fix(fix(6)); rec.end();
    expect(rec.recording.fixes).toHaveLength(6);
  });

  it("keeps only the last 10 rides", async () => {
    const store = memoryStorage();
    useStorage(store);
    for (let i = 0; i < 13; i++) {
      vi.setSystemTime(new Date(2026, 5, 1 + i, 9, 0));
      const rec = beginRecording(META);
      rec.fix(fix(0));
      rec.end();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(store.rows.size).toBe(KEEP_RIDES);
    const list = await listRecordings();
    expect(list).toHaveLength(10);
    expect(list[0]!.startedAt).toBeGreaterThan(list[9]!.startedAt);
    expect(list[0]!.startedAt).toBe(new Date(2026, 5, 13, 9, 0).getTime());
  });

  it("survives a store that throws", async () => {
    useStorage(memoryStorage(new Error("quota")));
    const rec = beginRecording(META);
    rec.fix(fix(0));
    rec.events(0, [arrive]);
    await vi.advanceTimersByTimeAsync(SAVE_EVERY_MS * 2);
    expect(() => rec.end()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.recording.fixes).toHaveLength(1);
    expect(await listRecordings()).toEqual([]);
    expect(await getRecording(1)).toBeNull();
    await expect(deleteRecording(1)).resolves.toBeUndefined();
  });

  it("lists with km and duration, and names the file", async () => {
    useStorage(memoryStorage());
    const rec = beginRecording(META);
    for (let i = 0; i < 11; i++) rec.fix(fix(i));
    vi.setSystemTime(Date.now() + 600_000);
    rec.end();
    await vi.advanceTimersByTimeAsync(0);
    const [row] = await listRecordings();
    expect(row!.fixes).toBe(11);
    expect(row!.km).toBeGreaterThan(0.05);
    expect(row!.durationMs).toBe(600_000);
    const file = recordingFile(rec.recording);
    expect(file.name).toBe("versta-ride-thames-loop-2026-06-07-0905.json");
    expect(JSON.parse(file.text).packId).toBe("thames-loop");
  });
});
