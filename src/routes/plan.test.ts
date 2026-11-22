import { describe, expect, it } from "vitest";
import type { PackIndexEntry } from "../types";
import { plan, type PlanInput } from "./plan";

const e = (id: string, version: string, updated: string, extra: Partial<PackIndexEntry> = {}): PackIndexEntry =>
  ({ id, name: id, mode: "walking", km: 1, stops: 1, hero: "", blurb: "", version, updated, bytes: 10, format: 1, ...extra });

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  builtIn: [], record: {}, staged: {}, site: null, riding: null, savedRideId: null, wifi: true, removed: [],
  transfers: {}, wanted: [], costs: {}, appFormat: 1, ...over,
});

describe("plan", () => {
  it("lists the site's order first, then routes only on the phone", () => {
    const p = plan(base({ builtIn: [e("a", "1", "2026-01-01T00:00:00Z"), e("z", "1", "2026-01-01T00:00:00Z")], site: [e("n", "1", "2026-02-01T00:00:00Z"), e("a", "1", "2026-01-01T00:00:00Z")], wifi: false }));
    expect(p.index.map((x) => x.id)).toEqual(["n", "a", "z"]);
    expect(p.action).toEqual({ kind: "none" });
  });

  it("downloads a new route on Wi-Fi only, one at a time, site order", () => {
    const site = [e("n1", "1", "2026-02-01T00:00:00Z"), e("n2", "1", "2026-02-01T00:00:00Z")];
    expect(plan(base({ site })).action).toEqual({ kind: "download", id: "n1" });
    expect(plan(base({ site, wifi: false })).action).toEqual({ kind: "none" });
    expect(plan(base({ site, riding: "" })).action).toEqual({ kind: "none" });
    expect(plan(base({ site, removed: ["n1"] })).action).toEqual({ kind: "download", id: "n2" });
    expect(plan(base({ site, wifi: false, wanted: ["n2"] })).action).toEqual({ kind: "download", id: "n2" });
  });

  it("does not retry a failed transfer by itself", () => {
    const site = [e("n1", "1", "2026-02-01T00:00:00Z")];
    const p = plan(base({ site, transfers: { n1: { state: "failed", done: 1, total: 5 } } }));
    expect(p.action).toEqual({ kind: "none" });
    expect(p.status.n1).toMatchObject({ kind: "on-site", transfer: { state: "failed" } });
  });

  it("an equal or older downloaded copy is dropped for the built-in one", () => {
    const b = e("a", "1", "2026-01-01T00:00:00Z");
    expect(plan(base({ builtIn: [b], record: { a: { version: "1", updated: b.updated!, entry: b } } })).action).toEqual({ kind: "drop", id: "a" });
  });

  it("a staged update waits for riding and for a saved ride with other stops", () => {
    const b = e("a", "1", "2026-01-01T00:00:00Z"), n = e("a", "2", "2026-02-01T00:00:00Z");
    const staged = { a: { version: "2", updated: n.updated!, entry: n, bytes: 3, stopsChanged: true } };
    const input = base({ builtIn: [b], site: [n], staged });
    expect(plan({ ...input, riding: "a" }).status.a).toMatchObject({ update: { held: "riding", ready: true } });
    expect(plan({ ...input, savedRideId: "a" }).action).toEqual({ kind: "none" });
    expect(plan({ ...input, savedRideId: "a" }).status.a).toMatchObject({ update: { held: "saved-ride" } });
    expect(plan(input).action).toEqual({ kind: "switch", id: "a" });
    expect(plan({ ...input, riding: "other" }).action).toEqual({ kind: "switch", id: "a" });
  });

  it("a staged update the site has moved past is dropped", () => {
    const b = e("a", "1", "2026-01-01T00:00:00Z"), n = e("a", "2", "2026-02-01T00:00:00Z"), m = e("a", "3", "2026-03-01T00:00:00Z");
    const staged = { a: { version: "2", updated: n.updated!, entry: n, bytes: 3, stopsChanged: false } };
    expect(plan(base({ builtIn: [b], site: [m], staged })).action).toEqual({ kind: "drop-next", id: "a" });
    expect(plan(base({ builtIn: [b], site: null, staged })).action).toEqual({ kind: "switch", id: "a" });
  });
});
