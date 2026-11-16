import { nav, openStop, pack } from "../state";
import { fmtDist, pad2, segmentLengths } from "./format";
import { Sheet } from "./Sheet";
import { stopsOpen } from "./uistate";

export function StopsList() {
  const p = pack.value;
  if (!p) return null;
  const n = nav.value;
  const lens = segmentLengths(p);
  const toStop = (k: number): number => {
    let m = n.toStop;
    for (let j = n.seg + 1; j <= k; j++) m += lens[j] ?? 0;
    return m;
  };
  const state = (k: number): string => {
    if (n.arrived.includes(k)) return "Arrived";
    if (k < n.seg) return "Passed";
    if (n.status === "idle" || n.status === "locating") return "";
    return fmtDist(toStop(k));
  };
  return (
    <Sheet kicker={`${p.stops.length} stops`} title="Stops" onClose={() => { stopsOpen.value = false; }} testid="stops-list">
      <ol class="stoplist">
        {p.stops.map((s, i) => (
          <li key={s.id}>
            <button type="button" class={`stoprow ${n.arrived.includes(i) ? "done" : ""} ${i === n.seg ? "next" : ""}`}
              onClick={() => { stopsOpen.value = false; openStop.value = i; }}>
              <span class="dot">{pad2(i + 1)}</span>
              <span class="sname">{s.name}{s.pint ? <em> pint stop</em> : null}</span>
              <span class="sdist">{state(i)}</span>
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
