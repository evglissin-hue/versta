import type { FixSource, Pack } from "../types";

/** STUB. The navigation executor replaces this file. */
export function createGpsSource(): FixSource { throw new Error("createGpsSource is not implemented yet"); }

/** speed in metres per second of simulated time; scale is how many simulated seconds pass per real second; from is the stop to start at. */
export function createSimSource(_pack: Pack, _opts: { speed: number; scale: number; from: number }): FixSource {
  throw new Error("createSimSource is not implemented yet");
}
