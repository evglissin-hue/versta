import type { ComponentChildren } from "preact";
import { isNative } from "../native/platform";
import { savedRide } from "../ride";
import { packIndex } from "../state";
import { startTutorial, tutorialSeen } from "../tour";
import { Chevron, InfoIcon, PinIcon, PlayIcon, SlidersIcon, Squiggle } from "./icons";
import { ride, requestRide, useReachedLine } from "./Routes";
import { nearbyOpen, openPage, startFailure, startPhase } from "./uistate";

function Row({ icon, title, line, extra, onClick, testid }: { icon: ComponentChildren; title: string; line: string; extra?: ComponentChildren; onClick: () => void; testid: string }) {
  return (
    <button type="button" class="menu-row" data-testid={testid} onClick={onClick}>
      <span class="menu-icon">{icon}</span>
      <span class="menu-words"><b>{title}</b><small>{line}</small></span>
      {extra ? <span class="menu-extra">{extra}</span> : null}
      <span class="menu-chev"><Chevron /></span>
    </button>
  );
}

/** Continue ride: only with a saved ride. The route and Start again stay on the route card. */
function ContinueCard({ saved }: { saved: NonNullable<ReturnType<typeof savedRide>> }) {
  const entry = packIndex.value.find((e) => e.id === saved.packId);
  const line = useReachedLine(saved.packId, saved.arrived, entry?.stops ?? null);
  const phase = startPhase.value?.id === saved.packId ? startPhase.value.phase : null;
  const busy = startPhase.value !== null;
  const failure = startFailure.value?.id === saved.packId ? startFailure.value : null;
  const label = phase === "loading" ? "Loading the route" : "Starting the ride";
  return (
    <div class="continue" data-testid="menu-continue">
      <button type="button" class="btn play big" disabled={busy} onClick={() => requestRide(saved.packId, saved)}>{busy ? label : "Continue ride"}</button>
      <p class="continue-line">{entry ? `${entry.name}. ${line}.` : `${line}.`}</p>
      {failure ? (
        <div class="failure" role="alert" data-testid="load-failure">
          <p class="warn-note">{failure.kind === "load" ? "Could not load the route. Check your connection and try again." : "Could not start the ride. Try again."}</p>
          <button type="button" class="btn" disabled={busy} onClick={() => void ride(failure.id, failure.resume)}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}

export function Menu() {
  const saved = savedRide();
  const count = packIndex.value.length;
  return (
    <main class="home" data-testid="menu">
      <header class="home-top">
        <h1>Versta</h1>
        <p>Rides and walks that tell you their stories as you pass.</p>
      </header>
      {saved ? <ContinueCard saved={saved} /> : null}
      <nav class="menu-list" aria-label="Menu">
        <Row testid="menu-routes" icon={<Squiggle size={32} />} title="Routes" line="Bike rides and walks, with their stories." extra={count > 0 ? <span class="menu-count">{count}</span> : null} onClick={() => openPage("routes")} />
        <Row testid="menu-nearby" icon={<PinIcon />} title="Nearby places" line="Stories of the places around you, off any route." onClick={() => { nearbyOpen.value = true; }} />
        <Row testid="menu-settings" icon={<SlidersIcon />} title="Settings" line="Voices, soundscape, map and riding." onClick={() => openPage("settings")} />
        <Row
          testid="menu-tutorial" icon={<PlayIcon />} title="Tutorial" line="A practice ride with sound, step by step."
          extra={<>{tutorialSeen.value ? null : <i class="menu-dot" data-testid="menu-dot" />}<span class="menu-count">2 min</span></>}
          onClick={() => startTutorial()}
        />
        <Row testid="menu-about" icon={<InfoIcon />} title="About" line={isNative() ? "Credits and privacy." : "Credits, privacy and the Android app."} onClick={() => openPage("about")} />
      </nav>
    </main>
  );
}
