import { useSignalEffect } from "@preact/signals";
import { MapView } from "../map/MapView";
import { nowPlaying, openStop, pack } from "../state";
import { AsideCard } from "./AsideCard";
import { Banner } from "./Banner";
import { Dock } from "./Dock";
import { Scene } from "./Scene";
import { SoundSheet } from "./SoundSheet";
import { StopSheet } from "./StopSheet";
import { StopsList } from "./StopsList";
import { following, sceneOpen, soundOpen, stopsOpen } from "./uistate";

let lastStory = "";

export function Ride() {
  const p = pack.value;
  const np = nowPlaying.value;
  // A new story opens the scene; hiding it keeps the same story playing without it coming back.
  useSignalEffect(() => {
    const now = nowPlaying.value;
    const id = now?.kind === "story" ? now.story.id : "";
    if (id && id !== lastStory) sceneOpen.value = true;
    lastStory = id;
  });
  if (!p) return null;
  const stop = openStop.value;
  return (
    <div class="ride" data-testid="ride">
      <div class="map-layer">
        <MapView pack={p} follow={following.value} onFollowChange={(f) => { following.value = f; }} onStopTap={(i) => { openStop.value = i; }} />
      </div>
      <Banner />
      <div class="ride-bottom">
        {np?.kind === "aside" ? <AsideCard aside={np.aside} /> : null}
        <Dock />
      </div>
      {stopsOpen.value ? <StopsList /> : null}
      {stop !== null ? <StopSheet index={stop} /> : null}
      {soundOpen.value ? <SoundSheet /> : null}
      {np?.kind === "story" && sceneOpen.value ? <Scene np={np} /> : null}
    </div>
  );
}
