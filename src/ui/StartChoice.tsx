import { chooseStart, endRide } from "../ride";
import { pack, startChoice } from "../state";
import { fmtDist, pad2 } from "./format";

/**
 * Asked once when a ride begins far from stop 1: start there, or at the nearest stop. "Back to the routes" (and Back)
 * ends the ride before anything started, for a rider who opened the wrong route.
 */
export function StartChoice() {
  const c = startChoice.value;
  const p = pack.value;
  if (!c || !p) return null;
  const nearest = p.stops[c.nearest];
  const first = p.stops[0];
  if (!nearest || !first) return null;
  return (
    <div class="sheet-layer modal" data-testid="start-choice">
      <div class="scrim" />
      <div class="sheet bottom" role="dialog" aria-modal="true" aria-label="Where do you start?">
        <div class="sheet-in">
          <div class="sheet-top"><h2>Where do you start?</h2></div>
          <div class="start-opts">
            <button type="button" class="start-opt primary" onClick={() => chooseStart(c.nearest)}>
              <b>Start at {pad2(c.nearest + 1)} {nearest.name}</b>
              <span>{fmtDist(c.toNearest)} away, the nearest stop</span>
            </button>
            <button type="button" class="start-opt" onClick={() => chooseStart(0)}>
              <b>Start at {pad2(1)} {first.name}</b>
              <span>{fmtDist(c.toFirst)} away, the start of the route</span>
            </button>
          </div>
          <button type="button" class="btn ghost start-back" onClick={() => endRide(false)}>Back to the routes</button>
        </div>
      </div>
    </div>
  );
}
