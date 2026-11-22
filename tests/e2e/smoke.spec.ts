import { expect, test, type Page } from "@playwright/test";

// Set PW_BASE_URL to run against a preview on another port.
const override = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PW_BASE_URL;
if (override) test.use({ baseURL: override });

/** The card of the pack the demo screens show (the first in the index). Home lists one card per pack. */
const demoCard = (page: Page) => page.getByTestId("route-card").first();
const thamesCard = (page: Page) => page.getByTestId("route-card").filter({ has: page.getByRole("heading", { name: "Thames Loop", exact: true }) });

test("a stale cached index loses to the network copy", async ({ page }) => {
  await page.goto("/");
  await expect(thamesCard(page)).toBeVisible();
  // Wait until the service worker controls the page, so the next load goes through its caching rules.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // Plant an old index in the pack cache (only one made-up route), as if saved by an earlier visit.
  await page.evaluate(async () => {
    const cache = await caches.open("versta-packs");
    const url = new URL("packs/index.json", document.baseURI).href;
    const stale = { packs: [{ id: "old-route", name: "Old Route", mode: "walk", km: 1, stops: 1, hero: "packs/old-route/hero.jpg", blurb: "stale" }] };
    await cache.put(url, new Response(JSON.stringify(stale), { headers: { "Content-Type": "application/json" } }));
  });
  await page.reload();
  await expect(thamesCard(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Old Route", exact: true })).toHaveCount(0);
});

function watchConsole(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test("home shows the Thames Loop card", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Versta" })).toBeVisible();
  const card = thamesCard(page);
  await expect(card).toContainText("Thames Loop");
  await expect(card).toContainText("km");
  await expect(card.getByRole("button", { name: "Ride" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Save for offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Simulate a ride" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("demo ride shows the banner and dock", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/?demo=ride&step=riding");
  await expect(page.getByTestId("banner")).toContainText("Turn left");
  await expect(page.getByRole("region", { name: "Ride controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End ride" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("demo ride: every button is at least 48px tall at 360px wide", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const step of ["riding", "at-stop", "story", "aside", "stops-list", "sound", "start-choice", "scene-hidden", "stop-sheet", "finish", "detour-turn", "detour-plain", "follow-course", "follow-north", "follow-free", "whole-route", "then", "wrong-way", "dock-time", "story-manual"]) {
    await page.goto(`/?demo=ride&step=${step}`);
    await expect(page.getByTestId("banner").or(page.getByTestId("finish"))).toBeVisible();
    // Stop markers shrink to 30px at low zoom on purpose (the map is still easing in on the rider when this runs), so they are left out then.
    const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5 && !(e.classList.contains("vm-stop") && e.closest(".is-low"))).map((e) => e.textContent));
    expect(small, `small targets in ${step}`).toEqual([]);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(wide, `horizontal overflow in ${step}`).toBe(false);
  }
});

test("continue card on Home offers Continue ride and Start again", async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?demo=ride&step=continue");
  const card = page.getByTestId("continue");
  await expect(card.getByRole("button", { name: "Continue ride" })).toBeVisible();
  await expect(card).toContainText("You reached 05 Deptford & the Tsar");
  await expect(card.getByRole("button", { name: "Start again" })).toBeVisible();
  await expect(demoCard(page).getByRole("button", { name: "Ride", exact: true })).toHaveCount(0);
  const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.textContent));
  expect(small).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test("the start-choice step shows the sheet with both stops and no way to close it", async ({ page }) => {
  await page.goto("/?demo=ride&step=start-choice");
  const sheet = page.getByTestId("start-choice");
  await expect(sheet).toContainText("Where do you start?");
  await expect(sheet.getByRole("button")).toHaveCount(2);
  await expect(sheet.getByRole("button", { name: /^Start at 07 .*600 m away, the nearest stop$/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Start at 01 Tower Bridge.*4\.2 km away, the start of the route$/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close" })).toHaveCount(0);
});

/** A real ride (the browser's position set near stop 7 of the Thames Loop), through the start-choice sheet. */
async function rideFromStop7(page: Page, context: import("@playwright/test").BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  // 120 m from Foot Tunnel & Island Gardens, 7th stop: far from stop 1, and the nearest stop is not the last
  await context.setGeolocation({ latitude: 51.4881, longitude: -0.0081588 });
  await page.addInitScript(() => { try { localStorage.setItem("versta:firstride", "1"); } catch {} });
  await page.goto("/");
  await thamesCard(page).getByRole("button", { name: /^Ride/ }).click();
  await expect(page.getByTestId("start-choice")).toBeVisible({ timeout: 20_000 });
}

test("a real ride far from stop 1 asks where to start, and choosing the nearest stop heads for it", async ({ page, context }) => {
  await rideFromStop7(page, context);
  const sheet = page.getByTestId("start-choice");
  await expect(sheet).toContainText("the nearest stop");
  await expect(sheet.getByRole("button", { name: /^Start at 07 Foot Tunnel/ })).toBeVisible();
  // nothing is guided or said until the rider chooses
  expect(await page.evaluate(() => window.__versta!.nav.value.status)).not.toBe("to_start");
  await sheet.getByRole("button", { name: /^Start at 07 Foot Tunnel/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("banner")).toContainText("Head for 07 Foot Tunnel");
  await expect.poll(() => page.evaluate(() => window.__versta!.nav.value.seg)).toBe(6);
});

test("a real ride far from stop 1: Back to the routes, or the Back button, ends it before anything starts", async ({ page, context }) => {
  await rideFromStop7(page, context);
  await expect(page.getByTestId("banner")).toContainText("Choose where to start");
  await page.getByTestId("start-choice").getByRole("button", { name: "Back to the routes" }).click();
  await expect(page.getByTestId("start-choice")).toHaveCount(0);
  await expect(thamesCard(page)).toBeVisible();
  await thamesCard(page).getByRole("button", { name: /^Ride/ }).click();
  await expect(page.getByTestId("start-choice")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })));
  await expect(page.getByTestId("start-choice")).toHaveCount(0);
  await expect(thamesCard(page)).toBeVisible();
});

test("a real ride far from stop 1: choosing stop 1 heads for stop 1", async ({ page, context }) => {
  await rideFromStop7(page, context);
  await page.getByTestId("start-choice").getByRole("button", { name: /^Start at 01 Tower Bridge/ }).click();
  await expect(page.getByTestId("banner")).toContainText("Head for the start, 01 Tower Bridge");
  expect(await page.evaluate(() => window.__versta!.nav.value.seg)).toBe(0);
});

test("scene hides itself when the rider leaves the stop, leaving the mini bar", async ({ page }) => {
  await page.goto("/?demo=ride&step=scene-hidden");
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  await expect(page.getByTestId("scene")).toHaveCount(0);
  await expect(page.getByTestId("banner")).toBeVisible();
});

test("stop sheet is a bottom sheet: no ride button for the stop you are at, a map tap closes it", async ({ page }) => {
  await page.goto("/?demo=ride&step=at-stop");
  const sheet = page.getByTestId("stop-sheet");
  await expect(sheet).toContainText("You are here");
  await expect(sheet.getByRole("button", { name: "Ride to this stop" })).toHaveCount(0);
  const box = await sheet.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(844 * 0.62 + 1);
  expect(box!.y).toBeGreaterThan(844 * 0.3);
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __verstaMap?: unknown }).__verstaMap)).toBe(true);
  await page.mouse.click(195, 300);
  await expect(sheet).toHaveCount(0);
  await page.goto("/?demo=ride&step=stop-sheet");
  await expect(page.getByTestId("stop-sheet").getByRole("button", { name: "Ride to this stop" })).toBeVisible();
});

test("finish logbook shows the ride, the stories not heard and two ways out", async ({ page }) => {
  await page.goto("/?demo=ride&step=finish");
  const book = page.getByTestId("finish");
  await expect(book).toContainText("Thames Loop");
  await expect(book).toContainText("2 h 14 min");
  await expect(book).toContainText("15/18");
  await expect(page.getByTestId("avg-speed")).toHaveText("10.3");
  await expect(page.getByTestId("asides-heard")).toHaveText("14/21");
  await expect(book.getByRole("button", { name: "Play" })).toHaveCount(3);
  await book.getByRole("button", { name: "Back to map" }).click();
  await expect(book).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Stops 13\/13/ })).toBeVisible();
});

test("detour banner shows the way back, with and without a turn", async ({ page }) => {
  await page.goto("/?demo=ride&step=detour-turn");
  await expect(page.getByTestId("banner")).toContainText("Way back");
  await expect(page.getByTestId("banner")).toContainText("120 m");
  await page.goto("/?demo=ride&step=detour-plain");
  await expect(page.getByTestId("banner")).toContainText("Follow the dashed line, 240 m");
  await page.goto("/?demo=ride&step=off-route");
  await expect(page.getByTestId("banner")).toContainText("Off the route by 70 m");
});

test("the Stops button counts the stops done, and the aside card shows its tags", async ({ page }) => {
  await page.goto("/?demo=ride&step=riding");
  await expect(page.getByRole("button", { name: "Stops 2/13" })).toBeVisible();
  await page.goto("/?demo=ride&step=aside");
  await expect(page.getByTestId("aside-card").locator(".tag").first()).toBeVisible();
});

/* ---------------------------------------------------------------- iteration 3: polish */

test("home: what is inside the route, the Android line, no offline warning online", async ({ page }) => {
  await page.goto("/");
  await expect(thamesCard(page).getByTestId("inside")).toHaveText("13 stops, 18 stories, 21 passing-by stories, about 30 min of listening");
  await expect(page.getByTestId("android-link")).toHaveAttribute("href", "https://github.com/evglissin-hue/versta/releases/tag/android-latest");
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
});

test("home preview states: first ride sheet, loading, load failure, offline, all with big targets and no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const step of ["first-ride", "loading", "load-failed", "offline"]) {
    await page.goto(`/?demo=ride&step=${step}`);
    await expect(demoCard(page)).toBeVisible();
    if (step === "first-ride") {
      const sheet = page.getByTestId("first-ride");
      await expect(sheet).toContainText("Versta follows your ride by GPS and talks to you as you go.");
      await expect(sheet.getByRole("button", { name: "Start the ride" })).toBeVisible();
    }
    if (step === "loading") await expect(demoCard(page).getByRole("button", { name: "Loading the route" })).toBeDisabled();
    if (step === "load-failed") {
      await expect(page.getByTestId("load-failure")).toContainText("Could not load the route. Check your connection and try again.");
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    }
    if (step === "offline") await expect(demoCard(page).getByTestId("offline-note")).toContainText("offline");
    const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.textContent));
    expect(small, `small targets in ${step}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `overflow in ${step}`).toBe(false);
  }
});

test("the first-ride sheet shows once, before the browser asks for anything, and never again", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
  await page.goto("/");
  await demoCard(page).getByRole("button", { name: "Ride", exact: true }).click();
  const sheet = page.getByTestId("first-ride");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("ride")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Start the ride" }).click();
  await expect(page.getByTestId("ride")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem("versta:firstride"))).toBe("1");
  await page.goto("/");
  await demoCard(page).getByRole("button", { name: /^Ride|Continue/ }).first().click();
  await expect(page.getByTestId("ride")).toBeVisible({ timeout: 20_000 });
});

test("the sound sheet is grouped, and the soundscape level writes the setting", async ({ page }) => {
  await page.goto("/?demo=ride&step=sound");
  const sheet = page.getByTestId("sound-sheet");
  for (const h of ["Voices", "Atmosphere", "Riding"]) await expect(sheet.getByText(h, { exact: true })).toBeVisible();
  for (const l of ["Story voice", "Turn instructions", "Soundscape", "Music", "Start stories on arrival", "Keep the screen awake", "Course up", "Recentre by itself"]) await expect(sheet.getByText(l, { exact: true }).first()).toBeVisible();
  await sheet.getByTestId("bed-level").getByRole("radio", { name: "Rich" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("versta:settings") ?? "{}").bedLevel)).toBe("rich");
  await sheet.getByTestId("bed-level").getByRole("radio", { name: "Soft" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("versta:settings") ?? "{}").bedLevel)).toBe("soft");
  await sheet.getByText("Recentre by itself", { exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("versta:settings") ?? "{}").autoRecentre)).toBe(false);
});

test("the scene shows Back 15 s and the time left for a recorded story, and neither Back 15 s nor a time when read by tapping", async ({ page }) => {
  await page.goto("/?demo=ride&step=story");
  const scene = page.getByTestId("scene");
  await expect(scene.getByRole("button", { name: "Back 15 s" })).toBeVisible();
  await expect(page.getByTestId("time-left")).toHaveText(/^(under a minute|\d+ min) left$/);
  await page.goto("/?demo=ride&step=story-manual");
  await expect(page.getByTestId("scene")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back 15 s" })).toHaveCount(0);
  await expect(page.getByTestId("time-left")).toHaveCount(0);
  await page.goto("/?demo=ride&step=scene-hidden");
  await expect(page.getByTestId("mini-bar").getByRole("button", { name: "Back 15 s" })).toBeVisible();
});

test("the stops list shows distance from the start, time to stops ahead, pint stops and story dots", async ({ page }) => {
  await page.goto("/?demo=ride&step=stops-list");
  const list = page.getByTestId("stops-list");
  await expect(list).toContainText("from start");
  await expect(list.getByTestId("stop-eta").first()).toContainText(/about \d+ min|about \d+ h/);
  await expect(list.locator(".chip.pint").first()).toBeVisible();
  await expect(list.locator(".sdots i.on").first()).toBeVisible();
  await expect(list.locator(".sdots i:not(.on)").first()).toBeVisible();
});

/* ---------------------------------------------------------------- iteration 3: the camera and the riding controls */

type Win = { __verstaMap?: { getZoom(): number; loaded(): boolean }; __verstaUi?: { followZoom: { value: number }; peek: { value: unknown }; wholeRoute: { value: boolean } } };
const followBtn = (page: Page) => page.getByTestId("follow");

async function mapReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => !!(window as unknown as Win).__verstaMap)).toBe(true);
  await page.waitForTimeout(1200);
}
async function dragMap(page: Page): Promise<void> {
  await page.mouse.move(195, 420);
  await page.mouse.down();
  await page.mouse.move(195, 470, { steps: 4 });
  await page.mouse.move(195, 520, { steps: 4 });
  await page.mouse.up();
}
const zoomOf = (page: Page) => page.evaluate(() => (window as unknown as Win).__verstaMap!.getZoom());

test("follow button shows course up, north up and not following, with the ring part way", async ({ page }) => {
  await page.goto("/?demo=ride&step=follow-course");
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
  await expect(page.getByTestId("recentre-ring")).toHaveCount(0);
  await page.goto("/?demo=ride&step=follow-north");
  await expect(followBtn(page)).toHaveAttribute("data-state", "north");
  await page.goto("/?demo=ride&step=follow-free");
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("recentre-label")).toHaveText("Recentre");
  await expect(page.getByTestId("recentre-ring")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recentre" })).toHaveCount(1);
});

test("the follow button flips between course up and north up", async ({ page }) => {
  await page.goto("/?demo=ride&step=follow-course");
  await followBtn(page).click();
  await expect(followBtn(page)).toHaveAttribute("data-state", "north");
  await followBtn(page).click();
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
});

test("the banner shows the turn after next, the wrong way warning, and the dock shows distance and time", async ({ page }) => {
  await page.goto("/?demo=ride&step=then");
  await expect(page.getByTestId("banner-then")).toContainText(/^then (right|left|bear)/i);
  await page.goto("/?demo=ride&step=wrong-way");
  await expect(page.getByTestId("banner")).toContainText("You are riding against the route");
  await expect(page.getByTestId("banner")).toContainText("Turn around when you can");
  await page.goto("/?demo=ride&step=dock-time");
  await expect(page.getByTestId("dock-dist")).toHaveText("1.2 km, about 5 min");
  await expect(page.getByRole("button", { name: "Recentre" })).toHaveCount(0);
});

test("dragging the map stops following and shows the hollow arrow; tapping it follows again", async ({ page }) => {
  await page.goto("/?demo=ride&step=riding");
  await mapReady(page);
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
  await dragMap(page);
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("recentre-label")).toBeVisible();
  await followBtn(page).click();
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
});

test("a wheel zoom while following keeps following and is remembered", async ({ page }) => {
  await page.goto("/?demo=ride&step=riding");
  await mapReady(page);
  const before = await page.evaluate(() => (window as unknown as Win).__verstaUi!.followZoom.value);
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(900);
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
  const after = await page.evaluate(() => (window as unknown as Win).__verstaUi!.followZoom.value);
  expect(after).toBeGreaterThan(before);
  expect(after).toBeLessThanOrEqual(18);
});

test("the whole route button fits the route, and a second tap goes back to following", async ({ page }) => {
  await page.goto("/?demo=ride&step=riding");
  await mapReady(page);
  const zoomIn = await zoomOf(page);
  await page.getByTestId("whole-route").click();
  await expect(page.getByTestId("whole-route")).toHaveAttribute("aria-pressed", "true");
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await expect.poll(() => zoomOf(page)).toBeLessThan(zoomIn - 2);
  await page.getByTestId("whole-route").click();
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(zoomIn - 1);
});

test("the follow button also leaves the whole route view", async ({ page }) => {
  await page.goto("/?demo=ride&step=whole-route");
  await expect(page.getByTestId("whole-route")).toHaveAttribute("aria-pressed", "true");
  await followBtn(page).click();
  await expect(page.getByTestId("whole-route")).toHaveAttribute("aria-pressed", "false");
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
});

test("tapping the turn banner peeks at the turn for a few seconds, then follows again", async ({ page }) => {
  await page.goto("/?demo=ride&step=riding");
  await mapReady(page);
  await page.getByTestId("banner").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__verstaUi!.peek.value !== null)).toBe(true);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(16.9);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__verstaUi!.peek.value === null), { timeout: 8000 }).toBe(true);
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
});

async function startSim(page: Page): Promise<void> {
  await page.goto("/?sim=1&speed=5&scale=4&virtual=1");
  await page.getByRole("button", { name: /^Ride/ }).first().click();
  await page.waitForFunction(() => window.__versta?.nav.value.status === "riding", null, { timeout: 30_000 });
  await mapReady(page);
}

test("on a simulated ride, dragging the map and waiting brings following back within 12 s", async ({ page }) => {
  await startSim(page);
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
  await dragMap(page);
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("recentre-ring")).toBeVisible();
  await expect(followBtn(page)).toHaveAttribute("data-state", "course", { timeout: 12_000 });
});

test("with autoRecentre off the map stays where the rider put it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("versta:settings", JSON.stringify({ autoRecentre: false })));
  await startSim(page);
  await dragMap(page);
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await page.waitForTimeout(11_000);
  await expect(followBtn(page)).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("recentre-ring")).toHaveCount(0);
  await followBtn(page).click();
  await expect(followBtn(page)).toHaveAttribute("data-state", "course");
});

test("sound check opens from Home, lists every sound, toggles the narrator, closes and answers Back", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sound check" }).click();
  const sc = page.getByTestId("sound-check");
  await expect(sc).toBeVisible();
  for (const [id, n] of [["sc-soundscapes", 23], ["sc-music", 6], ["sc-signals", 4], ["sc-effects", 21]] as const) {
    const rows = page.getByTestId(id).getByTestId("sc-row");
    await expect(rows).toHaveCount(n);
    // a sound with no recording yet says so in place of its Play button
    const missing = await rows.getByTestId("sc-missing").count();
    await expect(rows.getByRole("button", { name: /^Play/ })).toHaveCount(n - missing);
    if (id !== "sc-effects") expect(missing, id).toBe(0);
  }
  const narrator = sc.getByRole("switch", { name: /With the narrator/ });
  await expect(narrator).toHaveAttribute("aria-checked", "false");
  await narrator.click();
  await expect(narrator).toHaveAttribute("aria-checked", "true");
  await narrator.click();
  await expect(narrator).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("sc-soundscapes").getByRole("button", { name: /^Play/ }).first().click();
  await expect(page.getByTestId("sc-soundscapes").getByRole("button", { name: /^Stop/ })).toHaveCount(1);
  const fx = page.getByTestId("sc-effects").getByRole("button", { name: /^Play/ });
  if (await fx.count()) {
    await fx.first().click();
    await expect(page.getByTestId("sc-effects").getByRole("button", { name: /^Playing/ })).toHaveCount(1);
  }
  await page.getByTestId("sc-signals").getByRole("button", { name: /^Play/ }).first().click();
  await sc.getByRole("button", { name: "Stop all" }).click();
  await expect(page.getByTestId("sc-soundscapes").getByRole("button", { name: /^Stop/ })).toHaveCount(0);
  const small = await page.$$eval("[data-testid=sound-check] button", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && (e.getBoundingClientRect().height < 47.5 || e.getBoundingClientRect().width < 47.5)).map((e) => e.textContent));
  expect(small).toEqual([]);
  await sc.getByRole("button", { name: "Close" }).click();
  await expect(sc).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Versta" })).toBeVisible();
  await page.getByRole("button", { name: "Sound check" }).click();
  await expect(sc).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })));
  await expect(sc).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sound check opens from the ride's sound sheet and closing it returns to the ride", async ({ page }) => {
  const errors = watchConsole(page);
  await startSim(page);
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.getByTestId("sound-sheet").getByRole("button", { name: "Sound check" }).click();
  const sc = page.getByTestId("sound-check");
  await expect(sc).toBeVisible();
  await sc.getByRole("button", { name: "Close" }).click();
  await expect(sc).toHaveCount(0);
  await expect(page.getByTestId("sound-sheet")).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a simulated ride the map zooms in for the first real turn and eases back after it", async ({ page }) => {
  test.setTimeout(120_000);
  await startSim(page);
  const out = await page.evaluate(async () => {
    const w = window as unknown as { __verstaMap: { getZoom(): number }; __versta: { nav: { value: { nextCue: { id: string; turn: string } | null; toCue: number | null; currentCue: { id: string } | null; distanceDone: number } } } };
    const real = (c: { turn: string } | null): boolean => !!c && c.turn !== "straight" && c.turn !== "depart";
    let id: string | null = null;
    let before = -1; let during = -1; let after = -1; let passedAt = -1;
    const t0 = performance.now();
    while (performance.now() - t0 < 100_000) {
      const n = w.__versta.nav.value;
      const z = w.__verstaMap.getZoom();
      if (id === null && real(n.nextCue)) { id = n.nextCue!.id; before = z; }
      if (id !== null && n.nextCue?.id === id && n.toCue !== null && n.toCue < 25) during = Math.max(during, z);
      if (id !== null && passedAt < 0 && n.currentCue?.id === id) passedAt = n.distanceDone;
      if (passedAt >= 0 && n.distanceDone - passedAt > 90) { after = z; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { before, during, after };
  });
  console.log("turn zoom samples", JSON.stringify(out));
  expect(out.before).toBeLessThan(17);
  expect(out.during).toBeGreaterThanOrEqual(17.4);
  expect(out.after).toBeLessThan(17);
});

test("ride recordings open from Sound and settings, show the empty state and close with Back", async ({ page }) => {
  const errors = watchConsole(page);
  await startSim(page);
  await page.getByRole("button", { name: "Sound", exact: true }).click();
  await page.getByTestId("sound-sheet").getByRole("button", { name: "Ride recordings" }).click();
  const rec = page.getByTestId("recordings");
  await expect(rec).toBeVisible();
  await expect(page.getByTestId("recordings-empty")).toHaveText("No rides recorded yet. Your next ride will be.");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })));
  await expect(rec).toHaveCount(0);
  await expect(page.getByTestId("sound-sheet")).toBeVisible();
  expect(errors).toEqual([]);
});
