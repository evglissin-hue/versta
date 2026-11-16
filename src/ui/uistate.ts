import { signal } from "@preact/signals";

/** Whether the full-screen story scene is showing. A story can keep playing with the scene hidden. */
export const sceneOpen = signal(true);
export const stopsOpen = signal(false);
export const soundOpen = signal(false);
/** Map camera follows the rider. */
export const following = signal(true);
