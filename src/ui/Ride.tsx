import { useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { MapView } from "../map/MapView";
import { nav, nowPlaying, openStop, pack, startChoice } from "../state";
import { AsideCard } from "./AsideCard";
import { Banner } from "./Banner";
import { Dock } from "./Dock";
import { Finish } from "./Finish";
import { MapControls } from "./MapControls";
import { Scene } from "./Scene";
import { SoundSheet } from "./SoundSheet";
import { StartChoice } from "./StartChoice";
import { StopSheet } from "./StopSheet";
import { StopsList } from "./StopsList";
import { finishOpen, finishedAt, following, resumeFollow, sceneOpen, soundOpen, stopsOpen } from "./uistate";

let lastStory = "";
let lastStatus = "";

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
  // Riding away from a stop with a story still playing puts the map and the turn banner back; the mini bar keeps the story one tap away.
  // The finish logbook comes back at each finish.
  useSignalEffect(() => {
    const status = nav.value.status;
    if (lastStatus === "at_stop" && status === "riding" && nowPlaying.peek()?.kind === "story") sceneOpen.value = false;
    if (status === "finished" && lastStatus !== "finished") { finishOpen.value = true; finishedAt.value = Date.now(); }
    lastStatus = status;
  });
  // A new ride starts by following the rider, whatever the last one ended on.
  useEffect(() => resumeFollow, []);
  // Keep the map credit clear of whatever sits at the bottom: a bottom sheet when one is open, else the dock (and the passing-by card when it shows).
  const root = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sheetUp = openStop.value !== null || (nav.value.status === "finished" && np === null && finishOpen.value && !stopsOpen.value && !soundOpen.value);
  useEffect(() => {
    const r = root.current;
    const b = r?.querySelector<HTMLElement>(".sheet.bottom") ?? bottom.current;
    if (!r || !b) return;
    const apply = (): void => { r.style.setProperty("--map-attrib-bottom", `${b.offsetHeight + 8}px`); };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(b);
    return () => ro.disconnect();
  }, [p?.id, sheetUp]);
  if (!p) return null;
  const stop = openStop.value;
  // The logbook takes the place of the last stop's sheet, which the arrival opened.
  const logbook = nav.value.status === "finished" && np === null && finishOpen.value && !stopsOpen.value && !soundOpen.value;
  return (
    <div class="ride" data-testid="ride" ref={root}>
      <div class="map-layer">
        <MapView pack={p} follow={following.value} onFollowChange={(f) => { following.value = f; }} onStopTap={(i) => { openStop.value = i; }} onMapTap={() => { openStop.value = null; }} />
      </div>
      {logbook ? null : <Banner />}
      {logbook ? null : <MapControls />}
      <div class="ride-bottom" ref={bottom}>
        {np?.kind === "aside" ? <AsideCard aside={np.aside} /> : null}
        <Dock />
      </div>
      {stopsOpen.value ? <StopsList /> : null}
      {stop !== null && !logbook ? <StopSheet index={stop} /> : null}
      {soundOpen.value ? <SoundSheet /> : null}
      {logbook ? <Finish /> : null}
      {startChoice.value ? <StartChoice /> : null}
      {np?.kind === "story" && sceneOpen.value ? <Scene np={np} /> : null}
    </div>
  );
}
