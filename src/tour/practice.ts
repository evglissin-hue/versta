/**
 * The practice ride's script (task 34): which stop, turn and passing-by story it uses, the nav states it shows, and the
 * eight steps. It talks to the ride only through `Practice` (feed, skipAhead) and the director.
 */
import { currentDirector, type Practice } from "../ride";
import { directorLog, nav, nowPlaying, openStop } from "../state";
import type { Aside, NavEvent, Pack } from "../types";
import { sceneOpen, soundOpen, stopsOpen } from "../ui/uistate";
import type { Step } from "./engine";
import { practiceStates, type PracticePick } from "./pick";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const q = (sel: string) => (): Element | null => document.querySelector(sel);

/** The eight steps of the practice ride, bound to one running practice ride. */
export function practiceSteps(pack: Pack, pick: PracticePick, practice: Practice): Step[] {
  const st = practiceStates(pack, pick);
  const storyId = pack.stops[pick.stop]!.stories.find((s) => s.kind === "core")!.id;
  const approach: NavEvent = { type: "cue", cue: pick.cue, phase: "approach" };
  let arrivedOnce = false;
  let baseline: number | null = null;
  let asideGen = 0;

  const para = (): number => { const n = nowPlaying.value; return n?.kind === "story" ? n.para : -1; };
  const storyOn = (): boolean => nowPlaying.value?.kind === "story";
  const clean = (): void => { openStop.value = null; stopsOpen.value = false; soundOpen.value = false; };

  /** The rider before the turn, nothing else playing. */
  const toBefore = (): void => {
    asideGen++;
    if (nav.value.status !== "riding" || nav.value.seg !== pick.stop || nowPlaying.value) { currentDirector()?.stopAll(); practice.feed(st.before, []); }
    clean();
  };
  /** The rider at the stop with its story playing and the scene open. The first time is a real arrival. */
  const toStory = (): void => {
    asideGen++;
    clean();
    if (nowPlaying.value?.kind === "aside") currentDirector()?.stopAll();
    if (!arrivedOnce) {
      arrivedOnce = true;
      practice.feed(st.atStop, [{ type: "arrive", stop: pick.stop }]);
    } else {
      if (nav.value.status !== "at_stop") practice.feed(st.atStop, []);
      if (!storyOn()) currentDirector()?.playStory(pick.stop, storyId);
    }
    sceneOpen.value = true;
  };

  const nextAside = (): Aside => {
    const d = currentDirector();
    return pick.asides.find((a) => !d?.heard.has(a.id)) ?? pick.asides[0]!;
  };
  /** The passing-by story: the director may skip it (it was only just quiet), so ask again each second for 5 s. */
  const toAside = (): void => {
    const gen = ++asideGen;
    currentDirector()?.stopAll();
    clean();
    practice.feed(st.after, [{ type: "leave", stop: pick.stop }]);
    practice.skipAhead(10 * 60_000);
    const aside = nextAside();
    const attempt = async (n: number): Promise<void> => {
      if (gen !== asideGen || !practice.live) return;
      practice.feed(st.after, [{ type: "aside", aside }]);
      await sleep(1000);
      if (gen !== asideGen || !practice.live || nowPlaying.value?.kind === "aside") return;
      const skipped = directorLog.value.slice(-20).some((e) => e.what === "aside_skipped" && e.id === aside.id && e.reason !== "busy" && e.reason !== "too_soon");
      if (n < 5 && !skipped) void attempt(n + 1);
    };
    void attempt(1);
  };

  return [
    {
      id: "turn", target: q('[data-testid="banner"]'), title: "The next turn", line: "Spoken before you reach it. Tap the banner to see the turn.", picture: "turn", interactive: true,
      enter: () => {
        asideGen++;
        if (nav.value.status !== "riding" || nav.value.seg !== pick.stop || nowPlaying.value) currentDirector()?.stopAll();
        clean();
        practice.feed(st.before, [approach]);
      },
    },
    { id: "buttons", target: q('[data-testid="map-controls"]'), title: "Map buttons", line: "The arrow keeps the map on you. The line shows the whole route.", picture: "mapbtn", interactive: true, enter: toBefore },
    { id: "dock", target: q('[aria-label="Ride controls"]'), title: "Where you are heading", line: "The next stop, how far and how long. End ride stops it all.", picture: "dock", enter: toBefore },
    {
      id: "story", target: q('[data-testid="scene-tap"]'), title: "Tap to move on", line: "Tap the right of the story for the next part, the left to go back.", picture: "tap", waitMs: 8000, interactive: true,
      enter: () => { baseline = null; toStory(); },
      done: () => { const p = para(); if (p < 0) return false; if (baseline === null) { baseline = p; return false; } return p > baseline; },
    },
    { id: "foot", target: q('[data-testid="scene-foot"]'), title: "Pause or close", line: "Pause holds the voice and the music. Back 15 s repeats the last words.", picture: "pause", interactive: true, enter: () => toStory() },
    { id: "map", target: q('[data-testid="scene-map"]'), title: "Listen with the map", line: "Map keeps the story playing. Back stops it.", picture: "scene", interactive: true, enter: () => toStory(), done: () => !sceneOpen.value },
    {
      id: "mini", target: q('[data-testid="mini-bar"]'), title: "The story goes on", line: "Pause it, stop it, or open it again here.", picture: "mini", waitMs: 3000, interactive: true,
      enter: async () => {
        asideGen++;
        if (!storyOn()) toStory();
        clean();
        practice.feed(st.after, [{ type: "leave", stop: pick.stop }]);
        await sleep(80);
        sceneOpen.value = false;
      },
    },
    { id: "aside", target: q('[data-testid="aside-card"]'), title: "Passing by", line: "A short story as you pass something. Stop ends it.", picture: "aside", waitMs: 6000, interactive: true, enter: toAside },
  ];
}
