/** public/places.json (tools/places.py): every stop with audio and every aside of every pack, with files that exist. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlacesFile } from "../../src/types";
import { PACKS, hasFile, loaded } from "./packs";

const file = JSON.parse(readFileSync("public/places.json", "utf8")) as PlacesFile;

/** JSON with keys sorted, as tools/places.py hashes it. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

describe("places.json", () => {
  it("has a place for every stop with audio and every aside, ids unique", () => {
    const want: string[] = [];
    for (const p of PACKS) {
      const pack = loaded(p);
      for (const s of pack.stops) if (s.stories.some((st) => st.audio)) want.push(`${pack.id}:${s.id}`);
      for (const a of pack.asides) if (a.audio) want.push(`${pack.id}:${a.id}`);
    }
    const ids = file.places.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(want);
  });

  it("points every story at a file in its pack, with a radius and a length", () => {
    for (const pl of file.places) {
      expect(pl.radius, pl.id).toBeGreaterThan(0);
      expect(pl.stories.length, pl.id).toBeGreaterThan(0);
      if (pl.kind === "aside") expect(pl.stories).toHaveLength(1);
      for (const s of pl.stories) {
        expect(hasFile(pl.pack, s.audio), `${pl.id} ${s.audio}`).toBe(true);
        expect(s.dur, `${pl.id} ${s.id}`).toBeGreaterThan(0);
        if (s.pic) expect(hasFile(pl.pack, s.pic), `${pl.id} ${s.pic}`).toBe(true);
      }
    }
  });

  it("has the version its content gives", () => {
    const { version, ...rest } = file;
    expect(version).toBe(createHash("sha256").update(canonical(rest)).digest("hex").slice(0, 16));
  });
});
