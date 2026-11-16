import type { Pack } from "./types";

export interface OfflineStatus { saved: boolean; bytes: number; savedAt: number | null }

/** STUB. The app shell executor replaces this file. */
export async function savePackOffline(_pack: Pack, _onProgress: (done: number, total: number) => void): Promise<void> {
  throw new Error("savePackOffline is not implemented yet");
}
export async function offlineStatus(_packId: string): Promise<OfflineStatus> { return { saved: false, bytes: 0, savedAt: null }; }
export async function removePackOffline(_packId: string): Promise<void> {}
/** Vector tile URL template to give MapLibre. Uses the one saved with an offline pack when the network is unreachable. */
export async function tileTemplate(): Promise<string> { throw new Error("tileTemplate is not implemented yet"); }
