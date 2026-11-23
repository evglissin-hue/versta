/**
 * Dead-end hunt, iteration 7: sound that outlives what started it. Real audio in headless Chromium (a null sink), so
 * the mixers, their timelines and the live list are the real ones. Every way out of a sound must leave nothing
 * sounding within 2 s but turn speech already queued, and leave no mixer alive but the ride's while a ride runs.
 */
import { expect, test, type Page } from "@playwright/test";

interface Live { owner: string; sounding: string[] }
interface Ev { at: number; ch: string; ev: string; src: string; pos?: number }

const live = (page: Page): Promise<Live[]> => page.evaluate(() => (window as unknown as { __verstaSound?: { live(): Live[] } }).__verstaSound?.live() ?? []);
/** What is still sounding, nav speech left out ("<owner> <ch>:<src>"). */
async function sounding(page: Page): Promise<string[]> {
  return (await live(page)).flatMap((m) => m.sounding.filter((s) => !s.startsWith("nav:")).map((s) => `${m.owner} ${s}`));
}
/** Nothing but queued turn speech within 2 s (plus the round trip of the poll). */
async function quiet(page: Page, why: string): Promise<void> {
  await expect.poll(() => sounding(page), { message: `nothing sounding after ${why}`, timeout: 2600, intervals: [100] }).toEqual([]);
}
const back = (page: Page): Promise<void> => page.evaluate(() => { window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })); });
const timeline = (page: Page): Promise<Ev[]> => page.evaluate(() => (window.__versta?.timeline() ?? []) as Ev[]);

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  return errors;
}

/** A simulated Thames Loop ride with real audio, up to the first story playing at stop 1 with its scene open. */
async function toFirstStory(page: Page): Promise<void> {
  await page.goto("/?sim=1&speed=5&scale=12&page=routes");
  const card = page.getByTestId("route-card").filter({ has: page.getByRole("heading", { name: "Thames Loop", exact: true }) });
  await card.getByRole("button", { name: /^Ride/ }).click();
  await expect.poll(() => page.evaluate(() => window.__versta?.nowPlaying.value?.kind ?? null), { timeout: 60_000 }).toBe("story");
  await expect(page.getByTestId("scene")).toBeVisible();
  // the voice is really on before the rider does anything
  await expect.poll(async () => (await timeline(page)).some((e) => e.ch === "voice" && e.ev === "on"), { timeout: 10_000 }).toBe(true);
}

test.describe("a story at a stop", () => {
  test("the scene's Back stops the story, its soundscape and its music", async ({ page }) => {
    const errors = watch(page);
    await toFirstStory(page);
    await page.getByTestId("scene-back").click();
    await expect(page.getByTestId("scene")).toHaveCount(0);
    expect(await page.evaluate(() => window.__versta!.nowPlaying.value)).toBeNull();
    await quiet(page, "the scene's Back");
    expect(errors).toEqual([]);
  });

  test("Close story with nothing queued is silent: no close signal, no linger", async ({ page }) => {
    await toFirstStory(page);
    const before = (await timeline(page)).length;
    await page.getByTestId("scene-foot").getByRole("button", { name: "Close story" }).click();
    await quiet(page, "Close story");
    const after = (await timeline(page)).slice(before);
    expect(after.filter((e) => e.ch === "signal" && e.ev === "on").map((e) => e.src), "no signal after a close the rider asked for").toEqual([]);
  });

  test("Map keeps the story playing over the map; Stop in the mini bar ends it", async ({ page }) => {
    await toFirstStory(page);
    await page.getByTestId("scene-map").click();
    await expect(page.getByTestId("scene")).toHaveCount(0);
    await expect(page.getByTestId("stop-sheet")).toHaveCount(0);
    await expect(page.getByTestId("mini-bar")).toBeVisible();
    // still playing a second later
    await page.waitForTimeout(1000);
    expect((await sounding(page)).some((s) => s.startsWith("ride voice:")), "the voice plays on under the map").toBe(true);
    await page.getByTestId("mini-stop").click();
    await expect(page.getByTestId("mini-bar")).toHaveCount(0);
    await quiet(page, "Stop in the mini bar");
  });

  test("the phone's Back stops a story in the scene, and from the map after Map", async ({ page }) => {
    await toFirstStory(page);
    await back(page);
    await expect(page.getByTestId("scene")).toHaveCount(0);
    await quiet(page, "Back on the scene");
    // play it again from the stop sheet, put it under the map, then Back
    const sheet = page.getByTestId("stop-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /^Play/ }).first().click();
    await expect(page.getByTestId("scene")).toBeVisible();
    await page.getByTestId("scene-map").click();
    await expect(page.getByTestId("mini-bar")).toBeVisible();
    await back(page);
    await expect(page.getByTestId("mini-bar")).toHaveCount(0);
    await quiet(page, "Back with the story under the map");
    // nothing left to close: the ride screen stays
    await back(page);
    await expect(page.getByTestId("ride")).toBeVisible();
  });

  test("Pause fades the soundscape and music with the voice; Resume brings them back", async ({ page }) => {
    await toFirstStory(page);
    // the bed rose with the arrival
    await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("ride ambience:")), { timeout: 8000 }).toBe(true);
    await page.getByTestId("scene-foot").getByRole("button", { name: "Pause" }).click();
    await quiet(page, "Pause");
    await page.getByTestId("scene-foot").getByRole("button", { name: "Resume" }).click();
    await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("ride ambience:")), { timeout: 8000 }).toBe(true);
    await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("ride voice:")), { timeout: 8000 }).toBe(true);
  });

  test("tapping the text walks the story paragraph by paragraph; the last tap closes it in silence", async ({ page }) => {
    await toFirstStory(page);
    const marks = await page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.story.audio?.marks ?? [] : []; });
    expect(marks.length, "a recorded story with marks").toBeGreaterThan(2);
    const tap = page.getByTestId("scene-tap");
    const box = (await tap.boundingBox())!;
    for (let p = 1; p < marks.length; p++) {
      const before = (await timeline(page)).length;
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
      await expect.poll(() => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; })).toBe(p);
      // the voice comes back in at the paragraph's mark
      await expect.poll(async () => (await timeline(page)).slice(before).find((e) => e.ch === "voice" && e.ev === "on")?.pos ?? null, { timeout: 4000 }).not.toBeNull();
      const on = (await timeline(page)).slice(before).find((e) => e.ch === "voice" && e.ev === "on")!;
      expect(Math.abs((on.pos ?? 0) - (marks[p]! - 0.1)), `paragraph ${p + 1} starts at its mark`).toBeLessThan(0.35);
    }
    // back one, then on again
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.5);
    await expect.poll(() => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; })).toBe(marks.length - 2);
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect.poll(() => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; })).toBe(marks.length - 1);
    const before = (await timeline(page)).length;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect(page.getByTestId("scene")).toHaveCount(0);
    await quiet(page, "the last tap");
    expect((await timeline(page)).slice(before).filter((e) => e.ch === "signal" && e.ev === "on")).toEqual([]);
  });

  test("a paused story stays paused when tapped on", async ({ page }) => {
    await toFirstStory(page);
    await page.getByTestId("scene-foot").getByRole("button", { name: "Pause" }).click();
    await quiet(page, "Pause");
    const box = (await page.getByTestId("scene-tap").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect.poll(() => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; })).toBe(1);
    await page.waitForTimeout(800);
    expect(await sounding(page)).toEqual([]);
    await expect(page.getByTestId("scene-foot").getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("End ride with a story playing leaves no mixer", async ({ page }) => {
    await toFirstStory(page);
    await page.getByTestId("scene-map").click();
    await page.getByRole("button", { name: "End ride" }).click();
    await page.getByRole("button", { name: "End ride" }).last().click();
    await expect(page.getByTestId("ride")).toHaveCount(0);
    await expect.poll(() => live(page), { timeout: 2600 }).toEqual([]);
  });
});

test("a passing-by story: Stop on its card is silent", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?sim=1&speed=5&scale=16&page=routes");
  // stories at stops would hold the rider; leave them to Back so the ride rolls on to a passing-by story
  await page.evaluate(() => localStorage.setItem("versta:settings", JSON.stringify({ autoPlayStories: false, asides: "rich" })));
  await page.reload();
  const card = page.getByTestId("route-card").filter({ has: page.getByRole("heading", { name: "Thames Loop", exact: true }) });
  await card.getByRole("button", { name: /^Ride/ }).click();
  await expect.poll(() => page.evaluate(() => window.__versta?.nowPlaying.value?.kind ?? null), { timeout: 200_000, intervals: [250] }).toBe("aside");
  await expect(page.getByTestId("aside-card")).toBeVisible();
  await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("ride voice:")), { timeout: 8000 }).toBe(true);
  await page.getByTestId("aside-stop").click();
  await expect(page.getByTestId("aside-card")).toHaveCount(0);
  await quiet(page, "Stop on the passing-by card");
});

test("Nearby: Close, and the phone's Back, leave nothing sounding and no mixer", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5056, longitude: -0.0756 });
  await page.goto("/");
  await page.getByTestId("menu-nearby").click();
  const play = async (): Promise<void> => {
    await page.getByTestId("nearby-row").first().getByRole("button", { name: /^Play/ }).click();
    await expect(page.getByTestId("nearby-panel")).toBeVisible();
    await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("nearby voice:")), { timeout: 10_000 }).toBe(true);
  };
  await play();
  await back(page);
  await expect(page.getByTestId("nearby-panel")).toHaveCount(0);
  await quiet(page, "Back on a Nearby story");
  await play();
  await page.getByTestId("nearby").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("nearby")).toHaveCount(0);
  await expect.poll(() => live(page), { timeout: 2600 }).toEqual([]);
});

test("Sound check: Close, the phone's Back and going to the background leave nothing sounding", async ({ page }) => {
  await page.goto("/?page=settings");
  const open = async (): Promise<void> => {
    await page.getByRole("button", { name: "Sound check" }).click();
    await expect(page.getByTestId("sound-check")).toBeVisible();
    await page.getByTestId("sc-soundscapes").getByRole("button", { name: /^Play/ }).first().click();
    await page.getByTestId("sc-music").getByRole("button", { name: /^Play/ }).first().click();
    await expect.poll(async () => (await sounding(page)).some((s) => s.startsWith("soundcheck ambience:")), { timeout: 8000 }).toBe(true);
  };
  await open();
  await page.getByTestId("sound-check").getByRole("button", { name: "Close" }).click();
  await expect.poll(() => live(page), { timeout: 2600 }).toEqual([]);
  await open();
  await back(page);
  await expect(page.getByTestId("sound-check")).toHaveCount(0);
  await expect.poll(() => live(page), { timeout: 2600 }).toEqual([]);
  await open();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await quiet(page, "the app going to the background");
});
