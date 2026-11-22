import { gpsError, nav, pack, simulated } from "../state";
import type { GpsError } from "../types";
import { fmtDist, pad2, thenText, turnAngle, turnLabel } from "./format";
import { peekAt } from "./uistate";

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
  let peekable = false;
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
    const named = `${pad2(n.seg + 1)} ${stop?.name ?? ""}`;
    body = (
      <div class="b-text">
        <div class="b-big">{n.seg === 0 ? `Head for the start, ${named}` : `Head for ${named}`}, {fmtDist(n.toStop, 20)}</div>
      </div>
    );
  } else if (n.wrongWay && n.status === "riding") {
    tone = "warn";
    body = (
      <div class="b-text">
        <div class="b-warn">You are riding against the route</div>
        <div class="b-sub">Turn around when you can</div>
      </div>
    );
  } else if (n.nextCue) {
    const c = n.nextCue;
    peekable = n.status === "riding";
    const then = n.thenCue ?? null;
    const dist = n.toCue === null ? "" : fmtDist(n.toCue, 20);
    const label = <div class="b-label">{turnLabel(c.turn, n.toCue)}</div>;
    body = (
      <>
        <Arrow angle={turnAngle(c.turn)} />
        <div class="b-text">
          {c.turn === "straight" ? <><div class="b-dist">{dist}</div>{label}</> : <>{label}<div class="b-dist">{dist}</div></>}
          <div class="b-street">{c.name}</div>
          {then ? <div class="b-then" data-testid="banner-then"><Arrow angle={turnAngle(then.turn)} /><span>{thenText(then.turn, then.name)}</span></div> : null}
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
    <div
      class={`banner ${tone} ${peekable ? "peekable" : ""}`} role="status" aria-live="polite" data-testid="banner"
      tabIndex={peekable ? 0 : undefined}
      onClick={peekable && n.nextCue ? () => peekAt(n.nextCue!.at) : undefined}
      onKeyDown={peekable && n.nextCue ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); peekAt(n.nextCue!.at); } } : undefined}
    >
      {body}
      {tag}
    </div>
  );
}
