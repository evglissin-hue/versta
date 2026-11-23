/** What the Android back button closes, top-most first. Returns true when something was closed or stopped. */
import { currentDirector, endRide } from "../ride";
import { nav, nowPlaying, openStop, screen, startChoice } from "../state";
import { endTutorial, tourActive } from "../tour";
import { nearbyControls, nearbyPlaying } from "./Nearby";
import { backPage, finishOpen, firstRideSheet, nearbyOpen, pages, recordingsOpen, sceneOpen, soundCheckOpen, soundOpen, stopsOpen } from "./uistate";

/** Stops whatever story or passing-by story is playing. The preview has no director, so it clears the state itself. */
function stopPlaying(): void {
  const d = currentDirector();
  if (d) d.stopAll(); else nowPlaying.value = null;
}

export function closeTopOverlay(): boolean {
  if (tourActive.value) { endTutorial(); return true; }
  // the start choice: nothing has started yet, so Back goes back to the routes
  if (startChoice.value) { endRide(false); return true; }
  if (firstRideSheet.value) { firstRideSheet.value = null; return true; }
  if (recordingsOpen.value) { recordingsOpen.value = false; return true; }
  if (soundCheckOpen.value) { soundCheckOpen.value = false; return true; }
  // Back stops a story; the Map button is what keeps it playing over the map
  if (nowPlaying.value?.kind === "story" && sceneOpen.value) { stopPlaying(); return true; }
  if (nearbyOpen.value && nearbyPlaying.value) { nearbyControls.stop?.(); return true; }
  if (nearbyOpen.value) { nearbyOpen.value = false; return true; }
  // the finish logbook: the same condition as Ride.tsx
  if (nav.value.status === "finished" && nowPlaying.value === null && finishOpen.value && !stopsOpen.value && !soundOpen.value) { finishOpen.value = false; return true; }
  if (soundOpen.value) { soundOpen.value = false; return true; }
  if (stopsOpen.value) { stopsOpen.value = false; return true; }
  if (openStop.value !== null) { openStop.value = null; return true; }
  // a story with the scene hidden, or a passing-by story, still playing
  if (nowPlaying.value) { stopPlaying(); return true; }
  if (screen.value === "home" && pages.value.length > 1) return backPage();
  return false;
}
