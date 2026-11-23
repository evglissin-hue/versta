/**
 * The tutorial: a spotlight tour of a practice ride (task 34). This file is the interface the rest of the app uses;
 * task 34 fills it in. Until then it does nothing.
 */
import { signal } from "@preact/signals";

const SEEN_KEY = "versta:tutorial";
function seenBefore(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

/** True once this device has opened the tutorial. Until then the menu's Tutorial row has a pulsing dot. */
export const tutorialSeen = signal(seenBefore());

/** True while the tour is on screen (its intro card, a step, or its end card). */
export const tourActive = signal(false);

/** Open the tutorial from a tap on the menu: the intro card first, then the practice ride. */
export function startTutorial(): void {
  /* task 34 */
}

/** Close the tour from anywhere (its Close button, the phone's Back): ends the practice ride and stops every sound. */
export function endTutorial(): void {
  /* task 34 */
}
