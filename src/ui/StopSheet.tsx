import { currentDirector, jumpToStop } from "../ride";
import { nav, openStop, pack, packBase } from "../state";
import { minutesOf, pad2 } from "./format";
import { Sheet } from "./Sheet";
import { sceneOpen } from "./uistate";

export function StopSheet({ index }: { index: number }) {
  const p = pack.value;
  const stop = p?.stops[index];
  if (!p || !stop) return null;
  const d = currentDirector();
  const n = nav.value;
  const close = () => { openStop.value = null; };
  // The stop the rider is at, and the one they are heading for, get a status in place of "Ride to this stop".
  const here = (n.status === "at_stop" || n.status === "finished") && n.seg === index;
  const heading = ((n.status === "riding" || n.status === "to_start") && n.seg === index) || (n.status === "at_stop" && n.seg + 1 === index);
  const canRide = !here && !heading;

  return (
    <Sheet bottom kicker={`Stop ${pad2(index + 1)} of ${pad2(p.stops.length)}`} title={stop.name} onClose={close} testid="stop-sheet">
      <p class="note">{stop.note}</p>
      {stop.pint ? <div><span class="chip pint">Pint stop</span></div> : null}
      <div class="stories">
        {stop.stories.map((s) => {
          const heard = d?.heard.has(s.id) ?? false;
          return (
            <div class={`story ${s.pic ? "" : "nopic"}`} key={s.id}>
              {s.pic ? <img class="thumb" src={`${packBase(p.id)}${s.pic.src}`} alt="" loading="lazy" /> : null}
              <div class="sbody">
                <div class="shead">
                  <span class={`chip ${s.kind}`}>{s.kind === "core" ? "Core" : "Optional"}</span>
                  {s.tags.map((t) => <span class="chip tag" key={t}>{t}</span>)}
                  <span class="mins">{minutesOf(s)} min{heard ? ", heard" : ""}</span>
                </div>
                <h4>{s.title}</h4>
                <button type="button" class="btn play" onClick={() => { sceneOpen.value = true; d?.playStory(index, s.id); }}>{heard ? "Play again" : "Play"}</button>
              </div>
            </div>
          );
        })}
      </div>
      <div class="acts">
        {stop.stories.length > 1 ? <button type="button" class="btn" onClick={() => { sceneOpen.value = true; d?.playStop(index); }}>Play all</button> : null}
        {here ? <span class="here">You are here</span> : null}
        {heading ? <span class="here">Next stop</span> : null}
        {canRide ? <button type="button" class="btn" onClick={() => { jumpToStop(index); close(); }}>Ride to this stop</button> : null}
        <button type="button" class="btn ghost" onClick={close}>Close</button>
      </div>
    </Sheet>
  );
}
