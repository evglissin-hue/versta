import { currentDirector } from "../ride";
import { nav, openStop, pack } from "../state";
import { fmtDist, fmtEta, pad2, segmentLengths } from "./format";
import { Sheet } from "./Sheet";
import { demoRide, stopsOpen } from "./uistate";

export function StopsList() {
  const p = pack.value;
  if (!p) return null;
  const n = nav.value;
  const heard = currentDirector()?.heard ?? new Set(demoRide.value?.heard ?? []);
  const lens = segmentLengths(p);
  // metres along the route from the start to each stop
  const fromStart: number[] = [];
  lens.reduce((sum, l, i) => { const t = i === 0 ? 0 : sum + l; fromStart[i] = t; return t; }, 0);
  const toStop = (k: number): number => {
    let m = n.toStop;
    for (let j = n.seg + 1; j <= k; j++) m += lens[j] ?? 0;
    return m;
  };
  const live = n.status === "riding" || n.status === "at_stop" || n.status === "to_start";
  const ahead = (k: number): boolean => live && !n.arrived.includes(k) && k >= n.seg;
  return (
    <Sheet kicker={`${p.stops.length} stops`} title="Stops" onClose={() => { stopsOpen.value = false; }} testid="stops-list">
      <ol class="stoplist">
        {p.stops.map((s, i) => {
          const done = n.arrived.includes(i);
          const status = done ? "Arrived" : i < n.seg ? "Passed" : "";
          return (
            <li key={s.id}>
              <button type="button" class={`stoprow ${done ? "done" : ""} ${i === n.seg ? "next" : ""}`}
                onClick={() => { stopsOpen.value = false; openStop.value = i; }}>
                <span class="dot">{pad2(i + 1)}</span>
                <span class="sbox">
                  <span class="sname">{s.name}{s.pint ? <em class="chip pint">Pint stop</em> : null}</span>
                  <span class="smeta">
                    <span>{i === 0 ? "Start" : `${fmtDist(fromStart[i] ?? 0)} from start`}</span>
                    <span class="sdots" role="img" aria-label={`${s.stories.filter((x) => heard.has(x.id)).length} of ${s.stories.length} stories heard`}>
                      {s.stories.map((x) => <i key={x.id} class={heard.has(x.id) ? "on" : ""} />)}
                    </span>
                  </span>
                </span>
                <span class="sdist" data-testid={ahead(i) ? "stop-eta" : undefined}>
                  {ahead(i) ? <><span>{fmtDist(toStop(i))}</span><span class="seta">{fmtEta(toStop(i), n.speedAvg)}</span></> : status}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
