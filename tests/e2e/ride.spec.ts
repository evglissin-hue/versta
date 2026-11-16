/**
 * The dead-end hunt: whole rides on the built-in simulator, with sound in virtual mode so they run fast.
 * These must find what a rider would get stuck on before a rider does.
 */
import { expect, test, type Page } from "@playwright/test";

interface LogEntry { at: number; what: string; id?: string; reason?: string }
interface Snapshot { status: string; seg: number; arrived: number[]; log: LogEntry[]; cues: { id: string; quiet?: boolean }[]; stops: { stories: { id: string; kind: string }[] }[]; playing: string | null }

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const v = window.__versta!;
    const p = v.pack.value!;
    return {
      status: v.nav.value.status, seg: v.nav.value.seg, arrived: v.nav.value.arrived, log: v.log.value,
      cues: p.cues.map((c) => ({ id: c.id, quiet: c.quiet })),
      stops: p.stops.map((s) => ({ stories: s.stories.map((st) => ({ id: st.id, kind: st.kind })) })),
      playing: v.nowPlaying.value ? v.nowPlaying.value.kind : null,
    };
  });
}

async function ride(page: Page, query: string): Promise<Snapshot> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?${query}`);
  await page.getByRole("button", { name: /^Ride/ }).first().click();
  await page.waitForFunction(() => window.__versta?.pack.value != null && window.__versta.nav.value.status !== "idle", null, { timeout: 15_000 });
  // collect the log as the ride goes: the app keeps only the last few hundred entries
  const seen = new Map<string, LogEntry>();
  let last: Snapshot | null = null;
  for (let i = 0; i < 1500; i++) {
    last = await snapshot(page);
    for (const e of last.log) seen.set(`${e.at}|${e.what}|${e.id ?? ""}`, e);
    if (last.status === "finished" && last.playing === null) break;
    await page.waitForTimeout(200);
  }
  expect(errors, "no uncaught errors during the ride").toEqual([]);
  return { ...last!, log: [...seen.values()].sort((a, b) => a.at - b.at) };
}

test("a full ride reaches every stop, speaks every turn once and plays every core story", async ({ page }) => {
  test.setTimeout(300_000);
  const s = await ride(page, "sim=1&speed=5&scale=60&virtual=1");
  expect(s.status).toBe("finished");
  expect(s.arrived).toEqual([...Array(s.stops.length).keys()]);

  const arrivals = s.log.filter((e) => e.what === "arrive").map((e) => e.id);
  expect(arrivals.length, "one arrival per stop").toBe(s.stops.length);

  const spoken = s.log.filter((e) => e.what === "cue_spoken").map((e) => e.id!);
  expect(new Set(spoken).size, "no turn spoken twice").toBe(spoken.length);
  const mustSpeak = s.cues.filter((c) => !c.quiet).map((c) => c.id);
  expect(mustSpeak.filter((id) => !spoken.includes(id)), "turns never spoken").toEqual([]);

  const started = s.log.filter((e) => e.what === "story_start").map((e) => e.id);
  const core = s.stops.flatMap((st) => st.stories.filter((x) => x.kind === "core").map((x) => x.id));
  expect(core.filter((id) => !started.includes(id)), "core stories never played").toEqual([]);

  const asides = s.log.filter((e) => e.what === "aside_played");
  expect(asides.length, "some passing-by stories play").toBeGreaterThanOrEqual(4);
  for (let i = 1; i < asides.length; i++) {
    expect((asides[i]!.at - asides[i - 1]!.at) / 1000, "passing-by stories stay sparse").toBeGreaterThanOrEqual(300);
  }
  expect(s.log.some((e) => e.what === "off_route"), "the simulated rider never leaves the route").toBe(false);
});

test("joining part way picks up the route from there", async ({ page }) => {
  test.setTimeout(240_000);
  const s = await ride(page, "sim=1&speed=5&scale=60&virtual=1&from=8");
  expect(s.status).toBe("finished");
  const arrivals = s.log.filter((e) => e.what === "arrive");
  expect(arrivals.length, "arrivals from the joining stop onwards").toBeGreaterThanOrEqual(s.stops.length - 9);
});

test("a fast rider still gets every turn", async ({ page }) => {
  test.setTimeout(240_000);
  const s = await ride(page, "sim=1&speed=9&scale=60&virtual=1");
  expect(s.status).toBe("finished");
  const spoken = s.log.filter((e) => e.what === "cue_spoken").map((e) => e.id!);
  const mustSpeak = s.cues.filter((c) => !c.quiet).map((c) => c.id);
  expect(mustSpeak.filter((id) => !spoken.includes(id)), "turns never spoken at speed").toEqual([]);
});
