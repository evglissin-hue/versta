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
  for (const step of ["riding", "at-stop", "story", "aside", "stops-list", "sound"]) {
    await page.goto(`/?demo=ride&step=${step}`);
    await expect(page.getByTestId("banner")).toBeVisible();
    const small = await page.$$eval("button, a.linkbtn", (els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 47.5).map((e) => e.textContent));
    expect(small, `small targets in ${step}`).toEqual([]);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(wide, `horizontal overflow in ${step}`).toBe(false);
  }
});
