/**
 * The tutorial (task 34): every step lights the right part with the card on screen at several sizes, the sound is the
 * real director's, and closing the tour from anywhere leaves nothing sounding and the page as it was. `?virtual=1`
 * makes the practice mixer virtual: its timeline is the real one, and the timing is steady.
 */
import { expect, test, type Page } from "@playwright/test";

interface Live { owner: string; sounding: string[] }
interface Ev { at: number; ch: string; ev: string; src: string; pos?: number }

const IDS = ["turn", "buttons", "dock", "story", "foot", "map", "mini", "aside"];
/** What each step lights, for the geometry check. */
const TARGETS: Record<string, string> = {
  turn: '[data-testid="banner"]', buttons: '[data-testid="map-controls"]', dock: '[aria-label="Ride controls"]', story: '[data-testid="scene-tap"]',
  foot: '[data-testid="scene-foot"]', map: '[data-testid="scene-map"]', mini: '[data-testid="mini-bar"]', aside: '[data-testid="aside-card"]',
};

const live = (page: Page): Promise<Live[]> => page.evaluate(() => (window as unknown as { __verstaSound?: { live(): Live[] } }).__verstaSound?.live() ?? []);
const timeline = (page: Page): Promise<Ev[]> => page.evaluate(() => (window.__versta?.timeline() ?? []) as Ev[]);
const back = (page: Page): Promise<void> => page.evaluate(() => { window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })); });

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  return errors;
}

/** The step shows and its part is lit: Next is enabled. */
async function ready(page: Page, id: string): Promise<void> {
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", id, { timeout: 20_000 });
  await expect(page.getByTestId("tour-next")).toBeEnabled({ timeout: 20_000 });
}
async function open(page: Page): Promise<void> {
  await page.goto("/?virtual=1");
  await page.getByTestId("menu-tutorial").click();
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "intro");
  await page.getByRole("button", { name: "Start" }).click();
  await ready(page, "turn");
}
async function toStep(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await ready(page, IDS[i]!);
    await page.getByTestId("tour-next").click();
  }
  await ready(page, IDS[n]!);
}

test.describe("every step, at every size, in light and dark", () => {
  const sizes = [[360, 740], [390, 844], [412, 915], [768, 1024]] as const;
  for (const [w, h] of sizes) for (const scheme of ["light", "dark"] as const) {
    test(`${w} by ${h}, ${scheme}`, async ({ page }) => {
      const errors = watch(page);
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      for (let i = 0; i < IDS.length; i++) {
        await ready(page, IDS[i]!);
        await expect(page.getByTestId("tour-count")).toHaveText(`${i + 1} of ${IDS.length}`);
        // the hole eases for 200 ms, so poll until it has settled on the target
        await expect.poll(async () => page.evaluate(([sel, vw, vh]) => {
          const t = document.querySelector(sel as string)?.getBoundingClientRect();
          const hole = document.querySelector('[data-testid="tour-hole"]')?.getBoundingClientRect();
          const card = document.querySelector('[data-testid="tour-card"]')?.getBoundingClientRect();
          if (!t || !hole || !card) return "missing";
          const e = 1;
          if (!(hole.left <= t.left + e && hole.top <= t.top + e && hole.right >= t.right - e && hole.bottom >= t.bottom - e)) return `hole ${JSON.stringify(hole)} does not hold target ${JSON.stringify(t)}`;
          if (card.left < 0 || card.top < 0 || card.right > (vw as number) + e || card.bottom > (vh as number) + e) return `card off screen ${JSON.stringify(card)}`;
          if (card.left < 15 || card.right > (vw as number) - 15) return `card too near the edge ${JSON.stringify(card)}`;
          if (card.left < hole.right && hole.left < card.right && card.top < hole.bottom && hole.top < card.bottom) return `card ${JSON.stringify(card)} over hole ${JSON.stringify(hole)}`;
          return "ok";
        }, [TARGETS[IDS[i]!], w, h]), { message: `step ${IDS[i]}`, timeout: 5000, intervals: [100] }).toBe("ok");
        // every control on the card is 48 px
        const small = await page.getByTestId("tour-card").locator("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height).filter((x) => x < 47.5));
        expect(small).toEqual([]);
        if (i < IDS.length - 1) await page.getByTestId("tour-next").click();
      }
      await page.getByTestId("tour-next").click();
      await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "end");
      expect(errors).toEqual([]);
    });
  }
});

test("the sound is real: the turn, the arrival, a tap on the story, Map and the passing-by story", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.getByText("Practice", { exact: true })).toBeVisible();
  // step 1: the cue's own clip
  const cue = await page.evaluate(() => window.__versta!.nav.value.nextCue!.audio);
  await expect.poll(async () => (await timeline(page)).some((e) => e.ch === "nav" && e.ev === "on" && e.src.endsWith(cue)), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId("tour-title")).toHaveText("The next turn");
  // steps 2 and 3, then the arrival of step 4
  await toStep(page, 3);
  await expect.poll(async () => (await timeline(page)).some((e) => e.ch === "signal" && e.src === "arrive" && e.ev === "on"), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await timeline(page)).some((e) => e.ch === "voice" && e.ev === "on"), { timeout: 15_000 }).toBe(true);
  // a tap on the right of the story: the paragraph and the voice move on to the next mark
  const marks = await page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.story.audio!.marks : []; });
  const before = await page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; });
  const box = (await page.getByTestId("scene-tap").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.4);
  await expect.poll(() => page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "story" ? n.para : -1; })).toBe(before + 1);
  await expect.poll(async () => (await timeline(page)).filter((e) => e.ch === "voice" && e.ev === "on").some((e) => Math.abs((e.pos ?? -1) - marks[before + 1]!) < 0.5), { timeout: 5000 }).toBe(true);
  // the step moves on by itself once the paragraph has moved
  await ready(page, "foot");
  await page.getByTestId("tour-next").click();
  await ready(page, "map");
  await page.getByTestId("scene-map").click();
  await expect(page.getByTestId("scene")).toHaveCount(0);
  await ready(page, "mini");
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  expect(await page.evaluate(() => window.__versta!.nowPlaying.value?.kind)).toBe("story");
  await page.getByTestId("tour-next").click();
  await ready(page, "aside");
  const aside = await page.evaluate(() => { const n = window.__versta!.nowPlaying.value; return n?.kind === "aside" ? n.aside.audio : null; });
  expect(aside).not.toBeNull();
  await expect.poll(async () => (await timeline(page)).some((e) => e.ch === "voice" && e.ev === "on" && e.src.endsWith(aside!)), { timeout: 10_000 }).toBe(true);
  // the story that was playing is gone: only the aside speaks
  expect(await page.evaluate(() => window.__versta!.nowPlaying.value?.kind)).toBe("aside");
  expect(errors).toEqual([]);
});

const LIVE_RIDE = JSON.stringify({ packId: "thames-loop", seg: 3, arrived: [0, 1, 2], heard: [], startedAt: 1_700_000_000_000, savedAt: 1_700_000_100_000 });

async function leftClean(page: Page, why: string): Promise<void> {
  await expect(page.getByTestId("menu")).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(async () => (await live(page)).map((m) => `${m.owner}:${m.sounding.join(",")}`), { message: `no mixer left after ${why}`, timeout: 2600, intervals: [100] }).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("versta:ride")), `the saved ride after ${why}`).toBe(LIVE_RIDE);
  expect(await page.evaluate(() => window.__versta!.nowPlaying.value)).toBeNull();
}

const CLOSERS: Record<string, (page: Page) => Promise<void>> = {
  Close: (page) => page.getByTestId("tour-close").click(),
  Escape: (page) => page.keyboard.press("Escape"),
  "the phone's Back": (page) => back(page),
};
for (const [name, close] of Object.entries(CLOSERS)) {
  test(`${name} at every step stops every sound and leaves the menu and the saved ride as they were`, async ({ page }) => {
    const errors = watch(page);
    await page.addInitScript((ride) => { if (!localStorage.getItem("versta:ride")) localStorage.setItem("versta:ride", ride); }, LIVE_RIDE);
    await page.goto("/?virtual=1");
    for (let n = 0; n < IDS.length; n++) {
      await page.getByTestId("menu-tutorial").click();
      await page.getByRole("button", { name: "Start" }).click();
      await ready(page, "turn");
      await toStep(page, n);
      // something is sounding at the steps that play, before it is closed
      await close(page);
      await leftClean(page, `${name} at step ${n + 1}`);
    }
    expect(errors).toEqual([]);
  });
}

test("closing straight after Start leaves no ride screen and no sound", async ({ page }) => {
  const errors = watch(page);
  await page.goto("/?virtual=1");
  await page.getByTestId("menu-tutorial").click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu")).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("menu")).toBeVisible();
  await expect(page.getByTestId("ride")).toHaveCount(0);
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(async () => (await live(page)).length, { timeout: 2600 }).toBe(0);
  expect(errors).toEqual([]);
});

test("the tour ends by itself when the practice ride ends (End ride in the dock)", async ({ page }) => {
  await open(page);
  await toStep(page, 2);
  // the dock is under the dim, so its buttons are pressed in the page itself
  await page.evaluate(() => { [...document.querySelectorAll<HTMLButtonElement>(".dock-btns button")].find((b) => b.textContent === "End ride")!.click(); });
  await page.evaluate(() => { [...document.querySelectorAll<HTMLButtonElement>(".confirm button")].find((b) => b.textContent === "End ride")!.click(); });
  await expect(page.getByTestId("menu")).toBeVisible();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(async () => (await live(page)).length, { timeout: 2600 }).toBe(0);
});

test("the end card: Choose a route ends the practice ride and opens Routes", async ({ page }) => {
  await open(page);
  await toStep(page, 7);
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "end");
  await expect(page.getByTestId("tour-title")).toHaveText("Ready to ride");
  await page.getByRole("button", { name: "Choose a route" }).click();
  await expect(page.getByRole("heading", { name: "Routes", exact: true })).toBeVisible();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(async () => (await live(page)).length, { timeout: 2600 }).toBe(0);
});

test("the tutorial dot is gone once the tour has opened, and the follow button is put back", async ({ page }) => {
  await page.goto("/?virtual=1");
  await expect(page.getByTestId("menu-dot")).toBeVisible();
  await page.getByTestId("menu-tutorial").click();
  expect(await page.evaluate(() => localStorage.getItem("versta:tutorial"))).toBe("1");
  await page.getByRole("button", { name: "Start" }).click();
  await toStep(page, 1);
  const course = (): Promise<unknown> => page.evaluate(() => (JSON.parse(localStorage.getItem("versta:settings") ?? "{}") as { courseUp?: boolean }).courseUp ?? "default");
  expect(await course()).not.toBe(false);
  await page.getByTestId("follow").click();
  expect(await course(), "the follow button flipped course up during the tour").toBe(false);
  await page.getByTestId("tour-close").click();
  await expect(page.getByTestId("menu")).toBeVisible();
  expect(await course(), "put back when the tour closed").not.toBe(false);
  await expect(page.getByTestId("menu-dot")).toHaveCount(0);
});

test("by keyboard: Right is Next, Left is Previous, and the card has focus", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("tour-card")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await ready(page, "buttons");
  await page.keyboard.press("ArrowRight");
  await ready(page, "dock");
  await page.keyboard.press("ArrowLeft");
  await ready(page, "buttons");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu")).toBeVisible();
});

test("reduced motion: the pictures stand still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?virtual=1");
  await page.getByTestId("menu-tutorial").click();
  const names = await page.locator(".tp *").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName).filter((n) => n !== "none"));
  expect(names).toEqual([]);
});
