import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import catalogue from "../../src/audio/catalogue.json";
import { RECIPES, TRIM_DB, allLoops, loopsFor } from "../../src/audio/soundscapes";

const SOUNDS = join(__dirname, "../../public/sounds");
const exists = (name: string): boolean => existsSync(join(SOUNDS, `${name}.mp3`));

function mp3s(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? mp3s(p) : e.name.endsWith(".mp3") ? [p] : [];
  });
}

interface Credit { file: string; title: string; author: string; licence: string; source: string; cut: string; note?: string }

const found = import.meta.glob<Credit[]>("../../src/audio/credits-*.json", { eager: true, import: "default" });
const credits: Credit[] = Object.values(found).flat();

/**
 * Effects with no recording under the licence bar yet (CC0, public domain or CC BY): tools/sound/sources.json has no
 * source for them. Add one, run `python3 tools/sound/build_sounds.py fetch`, then `process`, `check` and `credits`,
 * and take the name off this list. Their stories keep them in the route files; `tools/pack_sound.py` adds them to
 * the packs once the file exists.
 */
const AWAITING_FETCH: string[] = [];

describe("sound library", () => {
  it("has every loop and fx file a recipe uses", () => {
    const missing = allLoops().filter((n) => !exists(n));
    expect(missing).toEqual([]);
  });

  it("has a file for every catalogue effect and the aside signal, except those still awaiting their fetch", () => {
    const wanted = [...Object.keys(catalogue.effects).map((n) => `fx/${n}`), "signals/aside"];
    expect(wanted.filter((n) => !exists(n) && !AWAITING_FETCH.includes(n))).toEqual([]);
    // the list only shrinks: a file that arrived must come off it
    expect(AWAITING_FETCH.filter((n) => exists(n))).toEqual([]);
  });

  it("has a recipe for every catalogue soundscape and no recipe outside the catalogue", () => {
    const names = Object.keys(catalogue.soundscapes).sort();
    expect(Object.keys(RECIPES).sort()).toEqual(names);
    for (const n of names) expect(RECIPES[n]!.length, n).toBeGreaterThan(1);
    expect(loopsFor("no-such-soundscape")).toEqual(loopsFor("river"));
  });

  it("has a level trim for every soundscape, within 10 dB", () => {
    expect(Object.keys(TRIM_DB).sort()).toEqual(Object.keys(catalogue.soundscapes).sort());
    for (const [n, db] of Object.entries(TRIM_DB)) expect(Math.abs(db), n).toBeLessThanOrEqual(10);
  });

  it("keeps panning gentle and sparse layers quiet", () => {
    for (const [name, parts] of Object.entries(RECIPES)) {
      const base = Math.max(...parts.filter((p) => p.loop).map((p) => p.level ?? 1));
      for (const p of parts) {
        if (p.pan !== undefined) expect(Math.abs(p.pan), name).toBeLessThanOrEqual(0.3);
        if (p.fx) expect(p.level ?? 1, `${name} ${p.fx}`).toBeLessThanOrEqual(base * 0.5);
      }
    }
  });

  it("credits every mp3 exactly once, under a licence that is allowed", () => {
    const files = mp3s(SOUNDS).map((p) => `sounds/${relative(SOUNDS, p).split("\\").join("/")}`);
    const counts = new Map<string, number>();
    for (const c of credits) counts.set(c.file, (counts.get(c.file) ?? 0) + 1);
    expect(files.filter((f) => counts.get(f) !== 1)).toEqual([]);
    expect([...counts.keys()].filter((f) => !files.includes(f) && !f.startsWith("sounds/music/"))).toEqual([]);
    for (const c of credits) {
      expect(c.licence, c.file).toMatch(/^(CC0|Public domain|CC BY \d)/i);
      expect(c.licence, c.file).not.toMatch(/SA|NC|ND|GFDL/i);
      expect(c.author.length, c.file).toBeGreaterThan(0);
      // recordings link to their page; what was composed for Versta names the script that makes it
      if (c.author !== "Composed for Versta") expect(c.source, c.file).toMatch(/^https?:\/\//);
      else expect(c.source, c.file).toMatch(/^tools\//);
    }
  });

  it("stays inside the size budget (8.5 MB, music and task 17 signals excluded)", () => {
    const skip = (p: string): boolean => {
      const rel = relative(SOUNDS, p).split("\\").join("/");
      return rel.startsWith("music/") || ["signals/arrive.mp3", "signals/close.mp3", "signals/finish.mp3"].includes(rel);
    };
    const total = mp3s(SOUNDS).filter((p) => !skip(p)).reduce((a, p) => a + statSync(p).size, 0);
    expect(total).toBeLessThanOrEqual(8.5 * 1024 * 1024);
  });
});
