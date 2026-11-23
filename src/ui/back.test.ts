import { beforeEach, describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals";

const stopAll = vi.fn();
const endRide = vi.fn();
const endTutorial = vi.fn();
const stopNearby = vi.fn();
let director: { stopAll: () => void } | null = null;
vi.mock("../ride", () => ({ currentDirector: () => director, endRide: (x: boolean) => endRide(x) }));
vi.mock("../tour", () => ({ tourActive: signal(false), endTutorial: () => endTutorial() }));
vi.mock("./Nearby", () => ({ nearbyPlaying: signal(false), nearbyControls: { play: null, stop: () => stopNearby() } }));

const { closeTopOverlay } = await import("./back");
const { IDLE_NAV, nav, nowPlaying, openStop, screen, startChoice } = await import("../state");
const { tourActive } = await import("../tour");
const { nearbyPlaying } = await import("./Nearby");
const ui = await import("./uistate");

const story = { kind: "story", stop: 1, story: { id: "s" }, para: 0, paused: false, manual: false } as unknown as NonNullable<typeof nowPlaying.value>;
const aside = { kind: "aside", aside: { id: "a" } } as unknown as NonNullable<typeof nowPlaying.value>;

beforeEach(() => {
  vi.clearAllMocks();
  director = { stopAll };
  tourActive.value = false; startChoice.value = null; ui.firstRideSheet.value = null; ui.recordingsOpen.value = false; ui.soundCheckOpen.value = false;
  nowPlaying.value = null; ui.sceneOpen.value = true; ui.nearbyOpen.value = false; nearbyPlaying.value = false;
  nav.value = IDLE_NAV; ui.finishOpen.value = true; ui.soundOpen.value = false; ui.stopsOpen.value = false; openStop.value = null;
  screen.value = "home"; ui.pages.value = ["menu"];
});

describe("pages", () => {
  it("openPage pushes, ignores the page on top, and backPage pops down to the menu", () => {
    ui.openPage("routes");
    ui.openPage("routes");
    expect(ui.pages.value).toEqual(["menu", "routes"]);
    ui.openPage("settings");
    expect(ui.pages.value).toEqual(["menu", "routes", "settings"]);
    expect(ui.backPage()).toBe(true);
    expect(ui.backPage()).toBe(true);
    expect(ui.pages.value).toEqual(["menu"]);
    expect(ui.backPage()).toBe(false);
    expect(ui.pages.value).toEqual(["menu"]);
  });
});

describe("closeTopOverlay", () => {
  it("closes the top-most thing first, one level per call", () => {
    // every level set at once
    ui.openPage("about");
    openStop.value = 2; ui.stopsOpen.value = true; ui.soundOpen.value = true;
    nav.value = { ...IDLE_NAV, status: "finished" };
    ui.nearbyOpen.value = true; nearbyPlaying.value = true;
    nowPlaying.value = story; ui.sceneOpen.value = true;
    ui.soundCheckOpen.value = true; ui.recordingsOpen.value = true; ui.firstRideSheet.value = { id: "x", resume: null };
    startChoice.value = { nearest: 1, toNearest: 1, toFirst: 2 };
    tourActive.value = true;

    expect(closeTopOverlay()).toBe(true); expect(endTutorial).toHaveBeenCalledOnce(); tourActive.value = false;
    expect(closeTopOverlay()).toBe(true); expect(endRide).toHaveBeenCalledWith(false); startChoice.value = null;
    expect(closeTopOverlay()).toBe(true); expect(ui.firstRideSheet.value).toBeNull();
    expect(closeTopOverlay()).toBe(true); expect(ui.recordingsOpen.value).toBe(false);
    expect(closeTopOverlay()).toBe(true); expect(ui.soundCheckOpen.value).toBe(false);
    // a story scene: Back stops the story
    expect(closeTopOverlay()).toBe(true); expect(stopAll).toHaveBeenCalledOnce(); nowPlaying.value = null;
    // nearby: a playing story stops first, then the screen closes
    expect(closeTopOverlay()).toBe(true); expect(stopNearby).toHaveBeenCalledOnce(); nearbyPlaying.value = false;
    expect(closeTopOverlay()).toBe(true); expect(ui.nearbyOpen.value).toBe(false);
    // the finish logbook only shows with nothing else up, but with the sound sheet and stops list open it is not on top
    ui.finishOpen.value = true; ui.soundOpen.value = false; ui.stopsOpen.value = false;
    expect(closeTopOverlay()).toBe(true); expect(ui.finishOpen.value).toBe(false);
    ui.soundOpen.value = true; ui.stopsOpen.value = true;
    expect(closeTopOverlay()).toBe(true); expect(ui.soundOpen.value).toBe(false);
    expect(closeTopOverlay()).toBe(true); expect(ui.stopsOpen.value).toBe(false);
    expect(closeTopOverlay()).toBe(true); expect(openStop.value).toBeNull();
    // the home page goes back to the menu last
    nav.value = IDLE_NAV;
    expect(closeTopOverlay()).toBe(true); expect(ui.pages.value).toEqual(["menu"]);
    expect(closeTopOverlay()).toBe(false);
  });

  it("stops a story whose scene is hidden, and a passing-by story", () => {
    screen.value = "ride";
    nowPlaying.value = story; ui.sceneOpen.value = false;
    expect(closeTopOverlay()).toBe(true); expect(stopAll).toHaveBeenCalledTimes(1);
    nowPlaying.value = aside;
    expect(closeTopOverlay()).toBe(true); expect(stopAll).toHaveBeenCalledTimes(2);
  });

  it("with no director (the preview) clears what is playing itself", () => {
    director = null;
    nowPlaying.value = story;
    expect(closeTopOverlay()).toBe(true);
    expect(nowPlaying.value).toBeNull();
  });

  it("leaves the page stack alone while a ride is on screen", () => {
    ui.openPage("routes");
    screen.value = "ride";
    expect(closeTopOverlay()).toBe(false);
    expect(ui.pages.value).toEqual(["menu", "routes"]);
  });
});
