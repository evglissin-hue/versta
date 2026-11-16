/** What the Android back button closes, top-most first. Returns true when something was closed. */
import { nowPlaying, openStop } from "../state";
import { sceneOpen, soundOpen, stopsOpen } from "./uistate";

export function closeTopOverlay(): boolean {
  if (nowPlaying.value?.kind === "story" && sceneOpen.value) { sceneOpen.value = false; return true; }
  if (soundOpen.value) { soundOpen.value = false; return true; }
  if (stopsOpen.value) { stopsOpen.value = false; return true; }
  if (openStop.value !== null) { openStop.value = null; return true; }
  return false;
}
