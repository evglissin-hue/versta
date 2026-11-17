/* Throwaway harness for the map. Served by `npx vite --port 5181`, open /src/map/dev/index.html.
   Query: ?state=overview|riding|stop|off  and  &seg=4  and  &along=300  and  &pack=<id> (default thames-loop) */
import { render } from "preact";
import "@fontsource/barlow-condensed/600.css";
import "../../styles/tokens.css";
import { nav, settings } from "../../state";
import type { Cue, Fix, NavState, Pack } from "../../types";
import { IDLE_NAV } from "../../state";
import { MapView } from "../MapView";

const q = new URLSearchParams(location.search);

function bearing(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

async function main(): Promise<void> {
  const pack = (await (await fetch(`/packs/${q.get("pack") ?? "thames-loop"}/pack.json`)).json()) as Pack;
  const seg = Number(q.get("seg") ?? 4);
  const state = q.get("state") ?? "overview";
  settings.value = { ...settings.value, courseUp: q.get("courseUp") !== "0" };
  const line = pack.segments[seg] ?? [];
  const idx = Math.floor(line.length * 0.4);
  const here = line[idx] ?? pack.stops[0]!.at;
  const ahead = line[idx + 1] ?? here;
  const cue: Cue | undefined = pack.cues.find((c) => c.seg === seg && c.at !== undefined && line.indexOf(c.at) !== 0 && c.i > idx) ?? pack.cues.find((c) => c.seg === seg);
  const base = (over: Partial<NavState>): NavState => ({ ...IDLE_NAV, ...over });
  const fixAt = (p: [number, number], heading: number | null, accuracy: number): Fix => ({ lng: p[0], lat: p[1], accuracy, heading, speed: 4, time: 0 });
  const along = Number(q.get("along") ?? 250);

  if (state === "riding") {
    nav.value = base({ status: "riding", seg, alongSeg: along, snapped: here, fix: fixAt(here, bearing(here, ahead), 12), routeBearing: bearing(here, ahead), nextCue: cue ? { ...cue, at: line[idx + 5] ?? cue.at } : null, toCue: 120, arrived: Array.from({ length: seg }, (_, i) => i) });
  } else if (state === "stop") {
    const s = pack.stops[seg]!;
    nav.value = base({ status: "at_stop", seg, alongSeg: 1e6, snapped: s.at, fix: fixAt(s.at, 90, 8), routeBearing: 90, arrived: Array.from({ length: seg + 1 }, (_, i) => i) });
  } else if (state === "off") {
    const off: [number, number] = [here[0] + 0.0007, here[1] + 0.0004];
    nav.value = base({ status: "riding", seg, alongSeg: along, snapped: here, offRoute: true, offBy: 140, fix: fixAt(off, 200, 25), routeBearing: bearing(here, ahead), arrived: Array.from({ length: seg }, (_, i) => i) });
  } else if (state === "tostart") {
    nav.value = base({ status: "to_start", fix: fixAt([pack.stops[0]!.at[0] - 0.012, pack.stops[0]!.at[1] + 0.006], null, 20) });
  } else nav.value = IDLE_NAV;

  let follow = q.get("follow") !== "0";
  const App = (): preact.JSX.Element => <MapView pack={pack} follow={follow} onFollowChange={(f) => { follow = f; (window as unknown as { __follow: boolean }).__follow = f; }} onStopTap={(i) => { (window as unknown as { __tap: number }).__tap = i; }} />;
  const root = document.getElementById("app")!;
  render(<App />, root);
  (window as unknown as { __dev: unknown }).__dev = { unmount: () => render(null, root), mount: () => render(<App />, root) };
}
void main();
