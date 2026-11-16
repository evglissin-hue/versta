import { gpsError, nav, pack, simulated } from "../state";
import type { GpsError } from "../types";
import { fmtDist, pad2, turnAngle, turnWord } from "./format";

const GPS_TEXT: Record<GpsError, { title: string; fix: string }> = {
  denied: { title: "Location is blocked", fix: "Allow location for this site in your browser settings, then end the ride and start again." },
  unavailable: { title: "No position found", fix: "Turn on GPS or location services on your phone. Indoors it can take a while." },
  timeout: { title: "Still no GPS signal", fix: "Move to open sky. The ride carries on as soon as a position arrives." },
  unsupported: { title: "No location in this browser", fix: "Open Versta in Chrome or Safari on your phone." },
};

export function Arrow({ angle }: { angle: number }) {
  return (
    <svg class="arrow" viewBox="0 0 48 48" aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }}>
      <path d="M24 4 L40 22 H30 V44 H18 V22 H8 Z" fill="currentColor" />
    </svg>
  );
}

export function Banner() {
  const n = nav.value;
  const p = pack.value;
  const err = gpsError.value;
  const stop = p?.stops[n.seg];
  const tag = simulated.value ? <span class="sim-tag">Simulated</span> : null;

  let tone = "";
  let body;
  if (err && (n.status === "locating" || !n.fix)) {
    const t = GPS_TEXT[err];
    tone = "warn";
    body = <div class="b-text"><div class="b-label">{t.title}</div><div class="b-fix">{t.fix}</div></div>;
  } else if (n.status === "locating" || n.status === "idle") {
    body = <div class="b-text"><div class="b-big">Finding you</div><div class="b-sub">Waiting for a GPS position.</div></div>;
  } else if (n.status === "finished") {
    body = <div class="b-text"><div class="b-big">Route complete</div><div class="b-sub">{p ? `You have reached ${p.stops[p.stops.length - 1]?.name}.` : ""}</div></div>;
  } else if (n.status === "at_stop") {
    body = <div class="b-text"><div class="b-label">You have arrived</div><div class="b-big">At {pad2(n.seg + 1)} {stop?.name}</div></div>;
  } else if (n.offRoute) {
    tone = "warn";
    body = (
      <div class="b-text">
        <div class="b-big">Off the route by {fmtDist(n.offBy)}</div>
        <div class="b-sub">Head back to the line on the map.</div>
      </div>
    );
  } else if (n.status === "to_start") {
    body = (
      <div class="b-text">
        <div class="b-label">Head to the start</div>
        <div class="b-big">{stop?.name}</div>
        <div class="b-sub">{fmtDist(n.toStop)} away</div>
      </div>
    );
  } else if (n.nextCue) {
    const c = n.nextCue;
    body = (
      <>
        <Arrow angle={turnAngle(c.turn)} />
        <div class="b-text">
          <div class="b-label">{turnWord(c.turn)} in</div>
          <div class="b-dist">{n.toCue === null ? "" : fmtDist(n.toCue, 20)}</div>
          <div class="b-street">{c.name}</div>
          {n.currentCue ? <div class="b-sub">Now on {n.currentCue.name}</div> : null}
        </div>
      </>
    );
  } else {
    body = (
      <div class="b-text">
        <div class="b-label">Next stop</div>
        <div class="b-big">{pad2(n.seg + 1)} {stop?.name}</div>
        <div class="b-sub">{fmtDist(n.toStop)} to go{n.currentCue ? `, on ${n.currentCue.name}` : ""}</div>
      </div>
    );
  }

  return (
    <div class={`banner ${tone}`} role="status" aria-live="polite" data-testid="banner">
      {body}
      {tag}
    </div>
  );
}
