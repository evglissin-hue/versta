import { currentDirector, endRide, rideStartedAt } from "../ride";
import { nav, openStop, pack } from "../state";
import { avgKmh, fmtDuration, pad2 } from "./format";
import { demoRide, finishOpen, finishedAt, sceneOpen } from "./uistate";

/** The logbook shown over the map when the route is done and nothing is playing. */
export function Finish() {
  const p = pack.value;
  if (!p) return null;
  const d = currentDirector();
  const demo = demoRide.value;
  const n = nav.value;
  const heard = d ? d.heard : new Set(demo?.heard ?? []);
  const all = p.stops.flatMap((s, i) => s.stories.map((st) => ({ stop: i, name: s.name, story: st })));
  const heardCount = all.filter((x) => heard.has(x.story.id)).length;
  const missed = all.filter((x) => x.story.kind === "optional" && !heard.has(x.story.id));
  const started = rideStartedAt() ?? demo?.startedAt ?? null;
  const ended = finishedAt.value ?? demo?.finishedAt ?? null;
  const asidesHeard = p.asides.filter((a) => heard.has(a.id)).length;
  const km = n.distanceDone > 0 ? n.distanceDone / 1000 : p.km;

  const avg = started !== null && ended !== null ? avgKmh(km, ended - started) : null;
  return (
    <div class="sheet-layer">
      <div class="sheet bottom finish" role="dialog" aria-label="Ride logbook" data-testid="finish">
        <div class="sheet-in">
          <div class="sheet-top">
            <div><span class="label">Ride complete</span><h2>{p.name}</h2></div>
          </div>
          <div class="stats three">
            <div><b>{km.toFixed(1)}</b><span>km ridden</span></div>
            <div><b>{started !== null && ended !== null ? fmtDuration(ended - started) : "-"}</b><span>time</span></div>
            <div><b>{heardCount}/{all.length}</b><span>stories heard</span></div>
          </div>
          <div class="stats two">
            <div><b data-testid="avg-speed">{avg !== null ? avg.toFixed(1) : "-"}</b><span>km/h average</span></div>
            <div><b data-testid="asides-heard">{asidesHeard}/{p.asides.length}</b><span>passing-by stories</span></div>
          </div>
          {missed.length > 0 ? (
            <>
              <div class="label">Stories you did not hear</div>
              <ul class="missed">
                {missed.map((x) => (
                  <li key={x.story.id}>
                    <div class="missed-words"><span class="label">{pad2(x.stop + 1)} {x.name}</span><span class="missed-title">{x.story.title}</span></div>
                    <button type="button" class="btn play small" onClick={() => { sceneOpen.value = true; d?.playStory(x.stop, x.story.id); }}>Play</button>
                  </li>
                ))}
              </ul>
            </>
          ) : <p class="note">You heard every story on this route.</p>}
          <div class="acts">
            <button type="button" class="btn" onClick={() => { finishOpen.value = false; openStop.value = null; }}>Back to map</button>
            <button type="button" class="btn ghost" onClick={() => endRide()}>End ride</button>
          </div>
        </div>
      </div>
    </div>
  );
}
