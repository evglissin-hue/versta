/** What the Android back button closes, top-most first. Returns true when something was closed. */
import { endRide } from "../ride";
import { nowPlaying, openStop, startChoice } from "../state";
import { firstRideSheet, recordingsOpen, sceneOpen, soundCheckOpen, soundOpen, stopsOpen } from "./uistate";

export function closeTopOverlay(): boolean {
  // the start choice: nothing has started yet, so Back goes back to the routes
  if (startChoice.value) { endRide(false); return true; }
  if (firstRideSheet.value) { firstRideSheet.value = null; return true; }
  if (nowPlaying.value?.kind === "story" && sceneOpen.value) { sceneOpen.value = false; return true; }
  if (recordingsOpen.value) { recordingsOpen.value = false; return true; }
  if (soundCheckOpen.value) { soundCheckOpen.value = false; return true; }
  if (soundOpen.value) { soundOpen.value = false; return true; }
  if (stopsOpen.value) { stopsOpen.value = false; return true; }
  if (openStop.value !== null) { openStop.value = null; return true; }
  return false;
}
