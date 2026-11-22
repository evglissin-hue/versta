import { useEffect } from "preact/hooks";
import { IDLE_NAV, gpsError, nav, nowPlaying, openStop, pack, packBase, packIndex, screen, settings, simulated, startChoice } from "../state";
import type { Detour, LngLat, NavState, Pack, PackIndexEntry } from "../types";
import { soundCheckOpen, demoRide, finishOpen, finishedAt, following, firstRideSheet, lastTouch, netDown, peek, ringDemo, sceneOpen, soundOpen, startFailure, startPhase, stopsOpen, wholeRoute } from "./uistate";

/** Preview route /?demo=ride&step=N[&pack=<id>]: the ride screen driven by hand-made state. No GPS, no audio, no ride controller. */
export const DEMO_STEPS = ["locating", "to-start", "riding", "off-route", "at-stop", "story", "aside", "gps-denied", "stops-list", "sound", "recentre", "continue", "start-choice", "scene-hidden", "stop-sheet", "finish", "detour-turn", "detour-plain", "follow-course", "follow-north", "follow-free", "whole-route", "then", "wrong-way", "dock-time", "first-ride", "loading", "load-failed", "offline", "story-manual", "soundcheck"] as const;

/** A point `m` metres from `p`, north (positive dy) and east (positive dx). */
function shift(p: LngLat, dx: number, dy: number): LngLat {
  return [p[0] + dx / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + dy / 111320];
}

const HOME_STEPS = ["continue", "first-ride", "loading", "load-failed", "offline"];

function demoState(p: Pack, step: string): void {
  const seg = p.segments[2]!;
  const on = seg[Math.floor(seg.length * 0.4)]!;
  const fix = { lng: on[0], lat: on[1], accuracy: 8, heading: 90, speed: 4, time: 0 };
  const base: NavState = { ...IDLE_NAV, status: "riding", fix, snapped: on, seg: 2, alongSeg: 400, toStop: 840, speedAvg: 4.5, distanceDone: 3100, distanceLeft: 18900, nextCue: p.cues.find((c) => c.turn === "left") ?? null, toCue: 120, currentCue: p.cues[1] ?? null, arrived: [0, 1] };
  gpsError.value = null; openStop.value = null; stopsOpen.value = false; soundOpen.value = false; soundCheckOpen.value = false; sceneOpen.value = true; following.value = true;
  finishOpen.value = true; finishedAt.value = null; startChoice.value = null; demoRide.value = null;
  wholeRoute.value = false; peek.value = null; ringDemo.value = null; lastTouch.value = 0;
  settings.value = { ...settings.value, courseUp: true };
  nowPlaying.value = null; simulated.value = new URLSearchParams(location.search).get("simtag") === "1";
  firstRideSheet.value = null; startPhase.value = null; startFailure.value = null; netDown.value = false;
  screen.value = HOME_STEPS.includes(step) ? "home" : "ride";
  const story = p.stops[2]!.stories[0]!;
  const tagged = p.asides.find((a) => a.tags.length > 0) ?? p.asides[0]!;
  const off = shift(on, 0, 70);
  const offFix = { ...fix, lng: off[0], lat: off[1] };
  const k = Math.floor(seg.length * 0.4);
  const rejoin = seg[Math.min(seg.length - 1, k + 2)]!;
  const lost: NavState = { ...base, fix: offFix, snapped: null, offRoute: true, offBy: 70 };
  const way = (next: Detour["next"]): Detour => ({ line: [off, shift(off, 20, 0), rejoin], toRejoin: 240, next });
  switch (step) {
    case "locating": nav.value = { ...IDLE_NAV, status: "locating" }; break;
    case "to-start": nav.value = { ...base, status: "to_start", seg: 0, distanceDone: 0, distanceLeft: p.km * 1000, toStop: 640, nextCue: null, toCue: null, currentCue: null, arrived: [] }; break;
    case "start-choice": {
      // the rider stands 600 m from stop 7, 4.2 km from stop 1: the sheet asks, and nothing is said until they choose
      const stop7 = p.stops[6]!.at;
      const rider = shift(stop7, -300, -520);
      nav.value = { ...IDLE_NAV, status: "locating", fix: { ...fix, lng: rider[0], lat: rider[1], heading: null, speed: 0 } };
      startChoice.value = { nearest: 6, toNearest: 600, toFirst: 4200 };
      break;
    }
    case "off-route": nav.value = lost; break;
    case "detour-turn": nav.value = { ...lost, detour: way({ turn: "left", name: p.cues[3]?.name ?? "the next street", at: seg[Math.min(seg.length - 1, k + 2)]!, dist: 120 }) }; break;
    case "detour-plain": nav.value = { ...lost, detour: way(null) }; break;
    case "at-stop": nav.value = { ...base, status: "at_stop", toStop: 0, nextCue: null, toCue: null, arrived: [0, 1, 2] }; openStop.value = 2; break;
    case "stop-sheet": nav.value = base; openStop.value = 5; break;
    case "story": nav.value = { ...base, status: "at_stop", toStop: 0, arrived: [0, 1, 2] }; nowPlaying.value = { kind: "story", stop: 2, story, para: 1, paused: false, manual: false }; break;
    case "scene-hidden": nav.value = base; nowPlaying.value = { kind: "story", stop: 2, story, para: 1, paused: false, manual: false }; setTimeout(() => { sceneOpen.value = false; }, 600); break;
    case "finish": {
      const all = p.stops.flatMap((s) => s.stories);
      const skipped = new Set(all.filter((x) => x.kind === "optional").slice(0, 3).map((x) => x.id));
      const end = Date.now();
      demoRide.value = { startedAt: end - (2 * 60 + 14) * 60000, finishedAt: end, heard: all.filter((x) => !skipped.has(x.id)).map((x) => x.id).concat(p.asides.slice(0, 14).map((a) => a.id)) };
      const last = p.stops.length - 1;
      nav.value = { ...base, status: "finished", seg: last, alongSeg: 0, toStop: 0, distanceDone: p.km * 1000, distanceLeft: 0, nextCue: null, toCue: null, arrived: p.stops.map((_, i) => i) };
      break;
    }
    case "aside": nav.value = { ...base, toCue: 14 }; nowPlaying.value = { kind: "aside", aside: tagged }; break;
    case "gps-denied": nav.value = { ...IDLE_NAV, status: "locating" }; gpsError.value = "denied"; break;
    case "stops-list": {
      const heardNow = p.stops.slice(0, 2).flatMap((x) => x.stories.map((y) => y.id)).concat(p.stops[2]!.stories.slice(0, 1).map((y) => y.id));
      demoRide.value = { startedAt: Date.now() - 50 * 60000, finishedAt: Date.now(), heard: heardNow };
      nav.value = base; stopsOpen.value = true;
      break;
    }
    case "first-ride": nav.value = IDLE_NAV; firstRideSheet.value = { id: p.id, resume: null }; break;
    case "loading": nav.value = IDLE_NAV; startPhase.value = { id: p.id, phase: "loading" }; break;
    case "load-failed": nav.value = IDLE_NAV; startFailure.value = { id: p.id, kind: "load", resume: null }; break;
    case "offline": nav.value = IDLE_NAV; netDown.value = true; break;
    case "story-manual": nav.value = { ...base, status: "at_stop", toStop: 0, arrived: [0, 1, 2] }; nowPlaying.value = { kind: "story", stop: 2, story, para: 1, paused: false, manual: true }; break;
    case "soundcheck": nav.value = base; soundCheckOpen.value = true; break;
    case "sound": nav.value = base; soundOpen.value = true; break;
    case "recentre":
    case "follow-free": nav.value = base; following.value = false; ringDemo.value = 0.55; break;
    case "follow-course": nav.value = base; break;
    case "follow-north": nav.value = base; settings.value = { ...settings.value, courseUp: false }; break;
    case "whole-route": nav.value = base; wholeRoute.value = true; following.value = false; ringDemo.value = 0.3; break;
    case "then": {
      const c = p.cues.filter((x) => x.turn === "right" || x.turn === "left");
      nav.value = { ...base, nextCue: c[0] ?? base.nextCue, toCue: 80, thenCue: p.cues.find((x) => x.name.length > 0 && x !== c[0] && x.turn === "right") ?? c[1] ?? null, toThen: 60 };
      break;
    }
    case "wrong-way": nav.value = { ...base, nextCue: null, toCue: null, wrongWay: true }; break;
    case "dock-time": nav.value = { ...base, nextCue: null, toCue: null, toStop: 1240, speedAvg: 4.1 }; break;
    case "continue": {
      const saved = { packId: p.id, seg: 5, arrived: [0, 1, 2, 3, 4], heard: [], startedAt: Date.now() - 3600000, savedAt: Date.now() };
      try { localStorage.setItem("versta:ride", JSON.stringify(saved)); } catch {}
      nav.value = IDLE_NAV;
      break;
    }
    default: nav.value = base;
  }
}

/** The demo shows the pack named by ?pack=<id>, or else the first pack in the index. */
export async function enterDemo(step: string): Promise<void> {
  let entries: PackIndexEntry[] = [];
  try { entries = ((await (await fetch(`${import.meta.env.BASE_URL}packs/index.json`)).json()) as { packs: PackIndexEntry[] }).packs; } catch {}
  const id = new URLSearchParams(location.search).get("pack") ?? entries[0]?.id;
  if (!id) return;
  const res = await fetch(`${packBase(id)}pack.json`);
  const p = (await res.json()) as Pack;
  // set the state in one go, before Home renders: the continue step writes the saved ride Home reads
  pack.value = p;
  packIndex.value = entries;
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
