import { useEffect } from "preact/hooks";
import { IDLE_NAV, gpsError, nav, nowPlaying, openStop, pack, packIndex, screen, simulated } from "../state";
import type { NavState, Pack } from "../types";
import { following, sceneOpen, soundOpen, stopsOpen } from "./uistate";

/** Preview route /?demo=ride&step=N: the ride screen driven by hand-made state. No GPS, no audio, no ride controller. */
export const DEMO_STEPS = ["locating", "to-start", "riding", "off-route", "at-stop", "story", "aside", "gps-denied", "stops-list", "sound", "recentre"] as const;

function demoState(p: Pack, step: string): void {
  const fix = { lng: -0.0536, lat: 51.5018, accuracy: 8, heading: 90, speed: 4, time: 0 };
  const base: NavState = { ...IDLE_NAV, status: "riding", fix, snapped: fix ? [fix.lng, fix.lat] : null, seg: 2, alongSeg: 400, toStop: 840, distanceDone: 3100, distanceLeft: 18900, nextCue: p.cues.find((c) => c.turn === "left") ?? null, toCue: 120, currentCue: p.cues[1] ?? null, arrived: [0, 1] };
  gpsError.value = null; openStop.value = null; stopsOpen.value = false; soundOpen.value = false; sceneOpen.value = true; following.value = true;
  nowPlaying.value = null; simulated.value = new URLSearchParams(location.search).get("simtag") === "1";
  const story = p.stops[2]!.stories[0]!;
  switch (step) {
    case "locating": nav.value = { ...IDLE_NAV, status: "locating" }; break;
    case "to-start": nav.value = { ...base, status: "to_start", seg: 0, toStop: 640, nextCue: null, toCue: null, currentCue: null, arrived: [] }; break;
    case "off-route": nav.value = { ...base, offRoute: true, offBy: 63 }; break;
    case "at-stop": nav.value = { ...base, status: "at_stop", toStop: 0, nextCue: null, toCue: null, arrived: [0, 1, 2] }; openStop.value = 2; break;
    case "story": nav.value = { ...base, status: "at_stop", toStop: 0, arrived: [0, 1, 2] }; nowPlaying.value = { kind: "story", stop: 2, story, para: 1, paused: false, manual: false }; break;
    case "aside": nav.value = { ...base, toCue: 14 }; nowPlaying.value = { kind: "aside", aside: p.asides[1] ?? p.asides[0]! }; break;
    case "gps-denied": nav.value = { ...IDLE_NAV, status: "locating" }; gpsError.value = "denied"; break;
    case "stops-list": nav.value = base; stopsOpen.value = true; break;
    case "sound": nav.value = base; soundOpen.value = true; break;
    case "recentre": nav.value = { ...base, nextCue: null, toCue: null }; following.value = false; break;
    default: nav.value = base;
  }
}

export async function enterDemo(step: string): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}packs/thames-loop/pack.json`);
  const p = (await res.json()) as Pack;
  pack.value = p;
  packIndex.value = [];
  screen.value = "ride";
  demoState(p, step);
}

/** Arrow keys step through the states, so a person can click through them on a desktop. */
export function useDemoKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const q = new URLSearchParams(location.search);
      const i = Math.max(0, DEMO_STEPS.indexOf((q.get("step") ?? "riding") as typeof DEMO_STEPS[number]));
      const next = DEMO_STEPS[(i + (e.key === "ArrowRight" ? 1 : DEMO_STEPS.length - 1)) % DEMO_STEPS.length]!;
      q.set("step", next);
      history.replaceState(null, "", `?${q.toString()}`);
      const p = pack.value;
      if (p) demoState(p, next);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [enabled]);
}
