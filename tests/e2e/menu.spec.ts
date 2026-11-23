import { expect, test, type Page } from "@playwright/test";

const back = (page: Page): Promise<void> => page.evaluate(() => { window.dispatchEvent(new CustomEvent("versta:back", { cancelable: true })); });

const ROWS = ["menu-routes", "menu-nearby", "menu-settings", "menu-tutorial", "menu-about"];

test("the menu shows its rows in order, and no Continue without a saved ride", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Versta" })).toBeVisible();
  await expect(page.getByTestId("menu-continue")).toHaveCount(0);
  const ids = await page.locator("[data-testid^=menu-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")).filter((x) => x && !["menu", "menu-dot", "menu-continue"].includes(x)));
  expect(ids).toEqual(ROWS);
  await expect(page.getByTestId("menu-routes")).toContainText("Bike rides and walks, with their stories.");
  await expect(page.getByTestId("menu-routes")).toContainText(/\d/);
});

for (const [row, page_, title] of [["menu-routes", "route-card", "Routes"], ["menu-settings", "settings-page", "Settings"], ["menu-about", "about-page", "About"]] as const) {
  test(`${row} opens its page and both Back ways return to the menu`, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId(row).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    if (page_ === "route-card") await expect(page.getByTestId(page_).first()).toBeVisible(); else await expect(page.getByTestId(page_)).toBeVisible();
    await page.getByTestId("page-back").click();
    await expect(page.getByTestId("menu")).toBeVisible();
    await page.getByTestId(row).click();
    await expect(page.getByTestId("page-back")).toBeVisible();
    await back(page);
    await expect(page.getByTestId("menu")).toBeVisible();
  });
}

test("Nearby opens over the menu and Back closes it", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5056, longitude: -0.0756 });
  await page.goto("/");
  await page.getByTestId("menu-nearby").click();
  await expect(page.getByTestId("nearby")).toBeVisible();
  await back(page);
  await expect(page.getByTestId("nearby")).toHaveCount(0);
  await expect(page.getByTestId("menu")).toBeVisible();
});

test("a switch on the Settings page writes versta:settings", async ({ page }) => {
  await page.goto("/?page=settings");
  const row = page.getByRole("switch", { name: /Soundscape/ }).first();
  const before = await row.getAttribute("aria-checked");
  await row.click();
  await expect(row).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("versta:settings") ?? "{}") as Record<string, unknown>);
  expect(saved.ambience).toBe(before !== "true");
});

test("the tutorial dot shows until versta:tutorial is 1", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("menu-dot")).toBeVisible();
  await expect(page.getByTestId("menu-tutorial")).toContainText("2 min");
  await page.evaluate(() => localStorage.setItem("versta:tutorial", "1"));
  await page.reload();
  await expect(page.getByTestId("menu-tutorial")).toBeVisible();
  await expect(page.getByTestId("menu-dot")).toHaveCount(0);
});

test("Continue shows only with a saved ride and starts it", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("versta:firstride", "1");
      if (!localStorage.getItem("versta:ride")) localStorage.setItem("versta:ride", JSON.stringify({ packId: "thames-loop", seg: 5, arrived: [0, 1, 2, 3, 4], heard: [], startedAt: Date.now() - 3600000, savedAt: Date.now() }));
    } catch {}
  });
  await page.goto("/?sim=1&speed=5&scale=8&virtual=1");
  const card = page.getByTestId("menu-continue");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Thames Loop. You reached 05");
  await card.getByRole("button", { name: "Continue ride" }).click();
  await expect(page.getByTestId("ride")).toBeVisible({ timeout: 20_000 });
});

for (const scheme of ["light", "dark"] as const) {
  test(`at 360 by 740 every button is at least 48 px tall and nothing scrolls sideways (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 360, height: 740 });
    for (const q of ["", "?page=routes", "?page=settings", "?page=about"]) {
      await page.goto(`/${q}`);
      await expect(page.locator("main.home")).toBeVisible();
      await page.waitForTimeout(300);
      const small = await page.locator("main.home button, main.home a.btn").evaluateAll((els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 47.5).map((e) => (e.textContent ?? "").trim()));
      expect(small, `small targets on ${q || "menu"}`).toEqual([]);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `sideways scroll on ${q || "menu"}`).toBeLessThanOrEqual(0);
    }
  });
}
