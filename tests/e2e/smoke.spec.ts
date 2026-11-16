import { expect, test, type Page } from "@playwright/test";

// Set PW_BASE_URL to run against a preview on another port.
const override = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PW_BASE_URL;
if (override) test.use({ baseURL: override });

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
  const card = page.getByTestId("route-card");
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
  for (const step of ["riding", "at-stop", "story", "aside", "stops-list", "sound", "join", "scene-hidden", "stop-sheet", "finish", "detour-turn", "detour-plain", "follow-course", "follow-north", "follow-free", "whole-route", "then", "wrong-way", "dock-time"]) {
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
  await expect(page.getByTestId("route-card").getByRole("button", { name: "Ride", exact: true })).toHaveCount(0);
  const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.textContent));
  expect(small).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test("join choice offers the start and the nearby route, and the choice changes the banner", async ({ page }) => {
  await page.goto("/?demo=ride&step=join");
  const banner = page.getByTestId("banner");
  await expect(banner).toContainText("Head for the route");
  await expect(banner.getByRole("button", { name: /To the start/ })).toBeVisible();
  await banner.getByRole("button", { name: /To the start/ }).click();
  await expect(banner).toContainText("Head for the start");
  await banner.getByRole("button", { name: /Join nearby/ }).click();
  await expect(banner).toContainText("Head for the route");
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
  await expect(book.getByRole("button", { name: "Play" })).toHaveCount(3);
  await book.getByRole("button", { name: "Back to the map" }).click();
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
