import { gpsError, nav, pack, simulated } from "../state";
import type { GpsError } from "../types";
import { fmtDist, pad2, turnAngle, turnLabel } from "./format";
import { joinChoice, joinTarget } from "./uistate";

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
  let cls = "";
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
  } else if (n.offRoute && n.detour) {
    const d = n.detour;
    tone = "warn";
    body = d.next ? (
      <>
        <Arrow angle={turnAngle(d.next.turn)} />
        <div class="b-text">
          <div class="b-label">Way back, {turnLabel(d.next.turn, d.next.dist).toLowerCase()}</div>
          <div class="b-dist">{fmtDist(d.next.dist, 20)}</div>
          {d.next.name ? <div class="b-street">{d.next.name}</div> : null}
          <div class="b-sub">Back on the route in {fmtDist(d.toRejoin, 20)}</div>
        </div>
      </>
    ) : (
      <div class="b-text">
        <div class="b-label">Way back</div>
        <div class="b-big">Follow the dashed line, {fmtDist(d.toRejoin, 20)}</div>
      </div>
    );
  } else if (n.offRoute) {
    tone = "warn";
    body = (
      <div class="b-text">
        <div class="b-big">Off the route by {fmtDist(n.offBy)}</div>
        <div class="b-sub">Head back to the line on the map.</div>
      </div>
    );
  } else if (n.status === "to_start") {
    const j = p ? joinChoice(n, p) : null;
    const toRoute = j?.chosen === "route" && j.routeDist !== null;
    const dist = toRoute && j?.routeDist != null ? j.routeDist : n.toStop;
    cls = "join";
    body = (
      <div class="b-text">
        <div class="b-label">{toRoute ? "Joining part way" : "From the beginning"}</div>
        <div class="b-big">{toRoute ? "Head for the route" : "Head for the start"}, {fmtDist(dist, 20)}</div>
        <div class="b-sub">{toRoute ? "The ride picks up where you meet the line." : stop?.name ?? ""}</div>
        {j && j.routeDist !== null ? (
          <div class="b-choices" role="group" aria-label="Where to join">
            <button type="button" class="choice" aria-pressed={!toRoute} onClick={() => { joinTarget.value = "start"; }}>
              <b>To the start</b><span>{fmtDist(j.startDist, 20)}</span>
            </button>
            <button type="button" class="choice" aria-pressed={toRoute} onClick={() => { joinTarget.value = "route"; }}>
              <b>Join nearby</b><span>{fmtDist(j.routeDist, 20)}</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  } else if (n.nextCue) {
    const c = n.nextCue;
    const dist = n.toCue === null ? "" : fmtDist(n.toCue, 20);
    const label = <div class="b-label">{turnLabel(c.turn, n.toCue)}</div>;
    body = (
      <>
        <Arrow angle={turnAngle(c.turn)} />
        <div class="b-text">
          {c.turn === "straight" ? <><div class="b-dist">{dist}</div>{label}</> : <>{label}<div class="b-dist">{dist}</div></>}
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
    <div class={`banner ${tone} ${cls}`} role="status" aria-live="polite" data-testid="banner">
      {body}
      {tag}
    </div>
  );
}
