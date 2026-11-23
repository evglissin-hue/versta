import { useState } from "preact/hooks";
import { endRide, currentDirector } from "../ride";
import { nav, nowPlaying, pack } from "../state";
import { fmtDistTime, pad2 } from "./format";
import { canRewind, sceneOpen, soundOpen, stopsOpen } from "./uistate";

export function Dock() {
  const [confirm, setConfirm] = useState(false);
  const n = nav.value;
  const p = pack.value;
  const np = nowPlaying.value;
  if (!p) return null;

  const last = p.stops.length - 1;
  const waiting = n.status === "at_stop" || n.status === "finished";
  const target = waiting ? Math.min(n.seg + 1, last) : n.seg;
  const stop = p.stops[target];
  const total = n.distanceDone + n.distanceLeft;
  const pct = total > 0 ? Math.min(100, Math.max(0, (n.distanceDone / total) * 100)) : 0;
  const showTo = !waiting && n.status === "riding";

  return (
    <section class="dock" aria-label="Ride controls">
      {np?.kind === "story" && !sceneOpen.value ? (
        <div class="mini" data-testid="mini-bar">
          <div class="mini-title"><span class="label">Story playing</span><strong>{np.story.title}</strong></div>
          <div class="mini-btns">
            {canRewind(np.manual, currentDirector()) ? <button type="button" class="btn small ghost" data-testid="mini-back" onClick={() => currentDirector()?.rewind?.(15)}>Back 15 s</button> : null}
            <button type="button" class="btn small" onClick={() => (np.manual ? currentDirector()?.nextParagraph() : currentDirector()?.togglePause())}>
              {np.manual ? "Next" : np.paused ? "Resume" : "Pause"}
            </button>
            <button type="button" class="btn small ghost" data-testid="mini-stop" onClick={() => { const d = currentDirector(); if (d) d.stopAll(); else nowPlaying.value = null; }}>Stop</button>
            <button type="button" class="btn small play" onClick={() => { sceneOpen.value = true; }}>Open</button>
          </div>
        </div>
      ) : null}
      <div class="dock-label">
        <div class="dock-name">
          <span class="label">{n.status === "finished" ? "Last stop" : waiting ? "Next stop" : "Heading for"}</span>
          <strong>{n.status === "finished" ? "Done" : `${pad2(target + 1)} ${stop?.name ?? ""}`}</strong>
          {showTo ? <span class="dock-dist" data-testid="dock-dist">{fmtDistTime(n.toStop, n.speedAvg)}</span> : null}
        </div>
      </div>
      <div class="progress" role="progressbar" aria-label="Route progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {confirm ? (
        <div class="confirm">
          <span class="confirm-q">End the ride?</span>
          <button type="button" class="btn ghost" onClick={() => setConfirm(false)}>Keep riding</button>
          <button type="button" class="btn danger" onClick={() => endRide()}>End ride</button>
        </div>
      ) : (
        <div class="dock-btns">
          <button type="button" class="btn ghost" onClick={() => { stopsOpen.value = true; }}>Stops {new Set(n.arrived).size}/{p.stops.length}</button>
          <button type="button" class="btn ghost" onClick={() => { soundOpen.value = true; }}>Sound</button>
          <button type="button" class="btn ghost" onClick={() => setConfirm(true)}>End ride</button>
        </div>
      )}
    </section>
  );
}
