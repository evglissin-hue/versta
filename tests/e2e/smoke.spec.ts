import { expect, test } from "@playwright/test";

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
  await expect(card).toContainText("22");
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
  for (const step of ["riding", "at-stop", "story", "aside", "stops-list", "sound", "join", "scene-hidden", "stop-sheet", "finish", "detour-turn", "detour-plain"]) {
    await page.goto(`/?demo=ride&step=${step}`);
    await expect(page.getByTestId("banner").or(page.getByTestId("finish"))).toBeVisible();
    const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.textContent));
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
