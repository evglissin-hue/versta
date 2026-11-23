/**
 * The tutorial: a spotlight tour of a practice ride (task 34). This file is the interface the rest of the app uses and
 * the controller that ties the engine, the practice ride and the page together. The engine (engine.ts) knows nothing
 * of rides, the steps (practice.ts) know nothing of the overlay (Tour.tsx).
 */
import { effect, signal } from "@preact/signals";
import { currentDirector, endRide, loadPack, startPractice } from "../ride";
import { packIndex, practice, settings, updateSettings } from "../state";
import type { PackIndexEntry, Settings } from "../types";
import { openPage } from "../ui/uistate";
import { TourEngine, type Card } from "./engine";
import { pickPractice } from "./pick";
import { practiceSteps } from "./practice";

const SEEN_KEY = "versta:tutorial";
function seenBefore(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

/** True once this device has opened the tutorial. Until then the menu's Tutorial row has a pulsing dot. */
export const tutorialSeen = signal(seenBefore());

/** True while the tour is on screen (its intro card, a step, or its end card). */
export const tourActive = signal(false);

/** The one engine the overlay draws. */
export const tourEngine = new TourEngine();

/** The practice ride's own route: the Thames Loop (built into the Android app) when listed, else the first. */
const PRACTICE_ROUTE = "thames-loop";

let session = 0;
let began = false;
let saved: Settings | null = null;
let stopWatch: (() => void) | null = null;

const NEEDS_ROUTE = "The practice ride needs a route. Connect and try again.";

function intro(): Card {
  return {
    id: "intro", picture: "speaker", title: "A practice ride",
    line: "You hear a real turn and a real story. Nothing is saved. Turn the sound up.",
    actions: [{ label: "Start", primary: true, run: () => void start() }, { label: "Not now", run: () => endTutorial() }],
  };
}
function problem(): Card {
  return { id: "problem", picture: "speaker", title: "No route yet", line: NEEDS_ROUTE, actions: [{ label: "Close", primary: true, run: () => endTutorial() }] };
}
function end(): Card {
  return {
    id: "end", picture: "flag", title: "Ready to ride", line: "Pick a route, or come back to this from the menu.",
    actions: [
      { label: "Choose a route", primary: true, run: () => { endTutorial(); openPage("routes"); } },
      { label: "Back to the menu", run: () => endTutorial() },
    ],
  };
}

async function routeEntry(): Promise<PackIndexEntry | null> {
  if (packIndex.value.length === 0) {
    try {
      const j = (await (await fetch(`${import.meta.env.BASE_URL}packs/index.json`)).json()) as { packs: PackIndexEntry[] };
      if (packIndex.value.length === 0) packIndex.value = j.packs;
    } catch { /* offline with nothing listed: the card says so */ }
  }
  const list = packIndex.value;
  return list.find((e) => e.id === PRACTICE_ROUTE) ?? list[0] ?? null;
}

function onVisible(): void {
  if (document.visibilityState === "hidden") currentDirector()?.stopAll();
  else if (tourActive.value) void tourEngine.reenter();
}

async function start(): Promise<void> {
  const my = session;
  tourEngine.busy.value = true;
  try {
    const entry = await routeEntry();
    if (!entry) throw new Error("no route");
    const pack = await loadPack(entry.id);
    if (my !== session) return;
    const pick = pickPractice(pack);
    if (!pick) throw new Error("no practice stop");
    const run = await startPractice(pack);
    // closed while the ride was starting: end it the moment it exists, so no ride screen is left without its tour
    if (my !== session) { endRide(false); return; }
    began = true;
    stopWatch = effect(() => { if (!practice.value && began) endTutorial(); });
    tourEngine.begin(practiceSteps(pack, pick, run));
  } catch {
    if (my === session) tourEngine.card(problem());
  }
}

/** Open the tutorial from a tap on the menu: the intro card first, then the practice ride. */
export function startTutorial(): void {
  if (tourActive.value) return;
  session++;
  began = false;
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* the dot comes back next time */ }
  tutorialSeen.value = true;
  saved = { ...settings.value };
  tourEngine.onEnd = () => { currentDirector()?.stopAll(); tourEngine.card(end()); };
  document.addEventListener("visibilitychange", onVisible);
  tourActive.value = true;
  tourEngine.card(intro());
}

/** Close the tour from anywhere (its Close button, the phone's Back): ends the practice ride and stops every sound. */
export function endTutorial(): void {
  if (!tourActive.value) return;
  session++;
  began = false;
  stopWatch?.(); stopWatch = null;
  document.removeEventListener("visibilitychange", onVisible);
  tourEngine.close();
  tourActive.value = false;
  // read-only: a setting the rider changed during the tour (the follow button flips course up) is put back
  if (saved) {
    const patch: Partial<Settings> = {};
    for (const k of Object.keys(saved) as (keyof Settings)[]) if (settings.value[k] !== saved[k]) (patch as Record<string, unknown>)[k] = saved[k];
    if (Object.keys(patch).length > 0) updateSettings(patch);
    saved = null;
  }
  if (practice.value) endRide(false);
}
