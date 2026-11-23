import { expect, test, type Page } from "@playwright/test";

const override = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PW_BASE_URL;
if (override) test.use({ baseURL: override });

const para = (page: Page) => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n && n.kind === "story" ? n.para : -1; });
const ticksOn = (page: Page) => page.locator("[data-testid=scene-foot] .ticks i.on").count();

test("the story scene: a tap on the right moves on, a tap on the left goes back, arrows do the same", async ({ page }) => {
  await page.goto("/?demo=ride&step=story");
  const body = page.getByTestId("scene-tap");
  await expect(body).toBeVisible();
  const start = await para(page);
  const ticks = await ticksOn(page);
  const box = (await body.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await expect.poll(() => para(page)).toBe(start + 1);
  expect(await ticksOn(page)).toBe(ticks + 1);
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await expect.poll(() => para(page)).toBe(start);
  await page.getByTestId("scene").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => para(page)).toBe(start + 1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => para(page)).toBe(start);
  await page.getByRole("button", { name: "Next part" }).dispatchEvent("click");
  await expect.poll(() => para(page)).toBe(start + 1);
});

test("Map hides the scene and shows the mini bar with Stop; Back closes the story", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?demo=ride&step=story");
  const scene = page.getByTestId("scene");
  await expect(scene.getByTestId("scene-back")).toHaveText("Back");
  await scene.getByTestId("scene-map").click();
  await expect(scene).toHaveCount(0);
  const mini = page.getByTestId("mini-bar");
  await expect(mini).toBeVisible();
  const btns = mini.locator("button");
  expect(await btns.count()).toBeGreaterThanOrEqual(3);
  const sizes = await btns.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, l: r.left, r: r.right }; }));
  for (const s of sizes) { expect(s.h).toBeGreaterThanOrEqual(47.5); expect(s.l).toBeGreaterThanOrEqual(0); expect(s.r).toBeLessThanOrEqual(360); }
  await mini.getByRole("button", { name: "Open" }).click();
  await expect(scene).toBeVisible();
  await scene.getByTestId("scene-back").click();
  await expect(scene).toHaveCount(0);
  expect(await page.evaluate(() => window.__versta!.nowPlaying.value)).toBeNull();
});

test("the scene's top bar fits at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?demo=ride&step=story");
  const r = await page.getByTestId("scene").locator(".scene-top").evaluate((el) => [...el.children].map((c) => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, h: b.height }; }));
  for (const b of r) { expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(360); }
  expect(r[0]!.h).toBeGreaterThanOrEqual(47.5);
  expect(r[2]!.h).toBeGreaterThanOrEqual(47.5);
});

test("the passing-by card has a Stop", async ({ page }) => {
  await page.goto("/?demo=ride&step=aside");
  await expect(page.getByTestId("aside-stop")).toBeVisible();
});

async function startSim(page: Page): Promise<void> {
  await page.goto("/?sim=1&speed=5&scale=8&virtual=1&page=routes");
  await page.getByRole("button", { name: /^Ride/ }).first().click();
  await page.waitForFunction(() => window.__versta?.nowPlaying.value?.kind === "story", null, { timeout: 90_000 });
}
const voiceOff = (page: Page) => page.evaluate(() => {
  const t = window.__versta!.timeline().filter((e) => e.ch === "voice");
  const last = t[t.length - 1];
  return !!last && last.ev === "off";
});

test("on a ride, Back on the scene ends the story and its voice", async ({ page }) => {
  test.setTimeout(150_000);
  await startSim(page);
  await page.getByTestId("scene-back").click();
  await expect.poll(() => page.evaluate(() => window.__versta!.nowPlaying.value), { timeout: 5000 }).toBeNull();
  await expect.poll(() => voiceOff(page)).toBe(true);
});

test("on a ride, Map then the mini bar's Stop ends a story started from the stop sheet", async ({ page }) => {
  test.setTimeout(150_000);
  await startSim(page);
  await page.getByTestId("scene-back").click();
  await expect.poll(() => page.evaluate(() => window.__versta!.nowPlaying.value)).toBeNull();
  await page.getByRole("button", { name: /^Stops/ }).click();
  await page.locator(".stoprow").first().click();
  const sheet = page.getByTestId("stop-sheet");
  await sheet.getByRole("button", { name: /^Play/ }).first().click();
  await page.waitForFunction(() => window.__versta?.nowPlaying.value?.kind === "story");
  await page.getByTestId("scene-map").click();
  await expect(page.getByTestId("scene")).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await page.getByTestId("mini-stop").click();
  await expect.poll(() => page.evaluate(() => window.__versta!.nowPlaying.value)).toBeNull();
  await expect.poll(() => voiceOff(page)).toBe(true);
  await expect(page.getByTestId("mini-bar")).toHaveCount(0);
});

test("nearby: a right tap moves the text on, Back on the panel stops it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5056, longitude: -0.0756 });
  await page.goto("/");
  await page.getByTestId("menu-nearby").click();
  await page.getByTestId("nearby-row").first().getByRole("button", { name: /^Play/ }).click();
  const text = page.getByTestId("nearby-text");
  await expect(text).not.toBeEmpty();
  const first = await text.textContent();
  const box = (await page.getByTestId("nearby-tap").boundingBox())!;
  // watch for the change itself, and then that it holds: the voice jumps with the text, so the playhead keeps it there
  await page.evaluate(() => {
    const w = window as unknown as { __changed: boolean };
    w.__changed = false;
    new MutationObserver(() => { w.__changed = true; }).observe(document.querySelector("[data-testid=nearby-panel]")!, { subtree: true, childList: true, characterData: true });
  });
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.4);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __changed: boolean }).__changed)).toBe(true);
  expect(first).not.toBeNull();
  await page.waitForTimeout(1500);
  expect(await text.textContent()).not.toBe(first);
  await page.getByTestId("nearby-back").click();
  await expect(page.getByTestId("nearby-panel")).toHaveCount(0);
});
