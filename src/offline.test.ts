import { describe, expect, it } from "vitest";
import { packFiles, routeTiles } from "./offline";
import type { Pack } from "./types";

const pack = {
  id: "t", hero: { src: "img/h.jpg", caption: "" },
  stops: [{ stories: [{ audio: { src: "audio/a.mp3" }, pic: { src: "img/a.jpg" } }] }],
  asides: [{ audio: "asides/x.mp3" }], cues: [{ audio: "cues/c.mp3" }, { audio: "cues/q.mp3", quiet: true }],
  system: { arrive: ["system/a.mp3"], offRoute: "system/o.mp3", backOnRoute: "system/b.mp3" },
  segments: [[], [[-0.0754, 51.5055], [-0.0654, 51.5055]]],
} as unknown as Pack;

describe("offline", () => {
  it("lists every pack file once, and no file for a quiet cue", () => {
    expect(packFiles(pack).sort()).toEqual(["asides/x.mp3", "audio/a.mp3", "cues/c.mp3", "img/a.jpg", "img/h.jpg", "pack.json", "system/a.mp3", "system/b.mp3", "system/o.mp3"]);
  });
  it("also lists the way-back clips, the turn and distance clips and the corridor graph", () => {
    const full = { ...pack, graph: "graph.json", system: { ...pack.system, rerouting: "system/r.mp3", wrongWay: "system/w.mp3", turns: { left: "system/l.mp3" }, distances: { "100": "system/in-100.mp3" } } } as Pack;
    const files = packFiles(full);
    for (const f of ["graph.json", "system/r.mp3", "system/w.mp3", "system/l.mp3", "system/in-100.mp3"]) expect(files).toContain(f);
  });
  it("covers the line with tiles at each zoom", () => {
    const tiles = routeTiles(pack, 11, 14);
    for (const z of [11, 12, 13, 14]) expect(tiles.some((t) => t.startsWith(`${z}/`))).toBe(true);
    expect(tiles.length).toBeGreaterThan(4);
  });
});
