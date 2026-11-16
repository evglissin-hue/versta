import { describe, expect, it } from "vitest";
import { makeProjection, type XY } from "../../src/geo";
import { buildIndex, findWayBack, nearestNode, type GraphIndex } from "../../src/nav/reroute";
import type { Cue, RouteGraph } from "../../src/types";

const proj = makeProjection([-0.07, 51.5]);
const toLngLat = (p: XY): [number, number] => [-0.07 + p[0] / proj.kx, 51.5 + p[1] / proj.ky];
const fromLngLat = (p: [number, number]): XY => [(p[0] - proj.origin[0]) * proj.kx, (p[1] - proj.origin[1]) * proj.ky];

type Edge = RouteGraph["edges"][number];

function index(graph: RouteGraph): GraphIndex {
  return buildIndex(graph, fromLngLat);
}

/** A hand-made graph. Edges are given as [from, to, name index, kind index, oneway]; length and cost come from the geometry. */
function hand(points: XY[], edges: [number, number, number, number, number?][], names: string[], kinds: Cue["kind"][] = ["road"]): RouteGraph {
  return {
    nodes: points.map(toLngLat),
    edges: edges.map(([a, b, name, kind, one]) => {
      const m = Math.hypot(points[b]![0] - points[a]![0], points[b]![1] - points[a]![1]);
      return [a, b, m, m, name, kind, one ?? 0] as Edge;
    }),
    names,
    kinds,
  };
}

/** A street grid with `step` metres between nodes. `factor(horizontal, line)` scales the cost of one street. */
export function grid(x0: number, y0: number, x1: number, y1: number, step: number, factor: (horizontal: boolean, line: number) => number = () => 1): RouteGraph {
  const nx = Math.floor((x1 - x0) / step) + 1;
  const ny = Math.floor((y1 - y0) / step) + 1;
  const nodes: XY[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push([x0 + i * step, y0 + j * step]);
  const names: string[] = [];
  const nameOf = (label: string): number => {
    let k = names.indexOf(label);
    if (k < 0) { names.push(label); k = names.length - 1; }
    return k;
  };
  const edges: Edge[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * nx + i;
      if (i + 1 < nx) edges.push([a, a + 1, step, step * factor(true, j), nameOf(`Row ${j}`), 0, 0]);
      if (j + 1 < ny) edges.push([a, a + nx, step, step * factor(false, i), nameOf(`Col ${i}`), 0, 0]);
    }
  }
  return { nodes: nodes.map(toLngLat), edges, names, kinds: ["road"] };
}

const at = <T>(a: readonly T[], i: number): T => {
  const v = a[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
};

/** A route running east along y = 0 from x = 0 to x = 600, sampled like the engine does. */
function targetsOnRoute(lastAlong: number): { at: XY; penalty: number }[] {
  const out: { at: XY; penalty: number }[] = [];
  for (let d = Math.max(0, lastAlong - 50); d <= 600; d += 50) out.push({ at: [d, 0], penalty: d < lastAlong ? 1.5 * (lastAlong - d) : 0 });
  return out;
}

describe("way back on a street grid", () => {
  // Row 2 (y = 120) and column 5 (x = 300) are cheap; every other street costs five times as much.
  const g = grid(-300, -300, 900, 600, 60, (horizontal, line) => (horizontal ? (line === 7 ? 1 : 5) : line === 10 ? 1 : 5));
  const idx = index(g);

  it("rejoins ahead of the last known position, not behind", () => {
    // The rider is at x = 240, 120 m north of the route, but last knew himself to be 300 m along it.
    const from: XY = [240, 120];
    const way = findWayBack(idx, from, targetsOnRoute(300));
    expect(way).not.toBeNull();
    const end = at(way!.line, way!.line.length - 1);
    expect(end[1]).toBe(0);
    expect(end[0]).toBeGreaterThanOrEqual(300);
    expect(at(way!.line, 0)).toEqual(from);
    expect(way!.length).toBeGreaterThan(170);
    expect(way!.length).toBeLessThan(260);
    // With no penalty the nearest route point wins, which is behind.
    const plain = index(grid(-300, -300, 900, 600, 60));
    const flat = findWayBack(plain, from, targetsOnRoute(300).map((t) => ({ ...t, penalty: 0 })));
    expect(at(flat!.line, flat!.line.length - 1)[0]).toBeLessThan(300);
    const biased = findWayBack(plain, from, targetsOnRoute(300));
    expect(at(biased!.line, biased!.line.length - 1)[0]).toBeGreaterThanOrEqual(300);
  });

  it("reports the turn with the right kind and the street turned onto", () => {
    const way = findWayBack(idx, [240, 120], targetsOnRoute(300))!;
    // East along Row 7 to x = 300, then south down Col 10 (a right turn) to the route.
    expect(way.turns).toHaveLength(1);
    const t = at(way.turns, 0);
    expect(t.turn).toBe("right");
    expect(t.name).toBe("Col 10");
    expect(t.at[0]).toBeCloseTo(300, 3);
    expect(t.at[1]).toBeCloseTo(120, 3);
    expect(t.along).toBeCloseTo(60, 3);
  });

  it("finds nothing when the rider is more than 120 m from any street", () => {
    expect(findWayBack(idx, [240, 1000], targetsOnRoute(300))).toBeNull();
    expect(nearestNode(idx, [240, 1000], 120)).toBe(-1);
    expect(nearestNode(idx, [241, 119], 120)).toBeGreaterThanOrEqual(0);
  });

  it("finds nothing when no target is within 60 m of a street", () => {
    expect(findWayBack(idx, [240, 120], [{ at: [3000, 3000], penalty: 0 }])).toBeNull();
  });
});

describe("turn kinds and names", () => {
  // A(0,0) A2(50,0) B(100,0) C(180,80) D(100,80) E(100,-10) F(100,-120)
  const pts: XY[] = [[0, 0], [50, 0], [100, 0], [180, 80], [100, 80], [100, -10], [100, -120]];
  const names = ["", "A St", "B St", "D St", "E St"];
  const g = hand(pts, [
    [0, 1, 1, 0], [1, 2, 1, 0], // straight on A St: no turn at the join
    [2, 3, 2, 0],               // slight left onto B St
    [3, 4, 0, 1],               // sharp left onto an unnamed footpath
    [4, 5, 3, 0],               // left onto D St... heading south
    [5, 6, 4, 0],               // same bearing, new name: a "straight" turn
  ], names, ["road", "footpath"]);
  it("gives each junction its kind and name", () => {
    const way = findWayBack(index(g), [0, 0], [{ at: [100, -120], penalty: 0 }])!;
    expect(way.turns.map((t) => [t.turn, t.name])).toEqual([
      ["slight_left", "B St"],
      ["sharp_left", "footpath"],
      ["left", "D St"],
      ["straight", "E St"],
    ]);
    // no turn at the node between the two A St edges, and alongs rise
    const alongs = way.turns.map((t) => t.along);
    expect([...alongs].sort((a, b) => a - b)).toEqual(alongs);
    expect(alongs[0]).toBeCloseTo(100, 3);
  });
  it("calls a right turn right, a gentle turn slight, and a gentle right slight_right", () => {
    const p: XY[] = [[0, 0], [100, 0], [100, -100], [200, -150]];
    const gr = hand(p, [[0, 1, 0, 0], [1, 2, 1, 0], [2, 3, 2, 0]], ["Main", "Side", "Lane"]);
    const way = findWayBack(index(gr), [0, 0], [{ at: [200, -150], penalty: 0 }])!;
    expect(way.turns.map((t) => [t.turn, t.name])).toEqual([["right", "Side"], ["slight_left", "Lane"]]);
    const p2: XY[] = [[0, 0], [100, 0], [160, -80]];
    const g2 = hand(p2, [[0, 1, 0, 0], [1, 2, 1, 0]], ["Main", "Side"]);
    const way2 = findWayBack(index(g2), [0, 0], [{ at: [160, -80], penalty: 0 }])!;
    expect(way2.turns.map((t) => t.turn)).toEqual(["slight_right"]);
  });
});

describe("one-way streets", () => {
  // S(0,0) T(100,0) U(0,100) V(100,100). S to T direct, or round by U and V.
  const pts: XY[] = [[0, 0], [100, 0], [0, 100], [100, 100]];
  const via = (oneway: number): RouteGraph => hand(pts, [[0, 1, 0, 0, oneway], [0, 2, 1, 0], [2, 3, 2, 0], [3, 1, 3, 0]], ["a", "b", "c", "d"]);
  const target = [{ at: [100, 0] as XY, penalty: 0 }];
  it("goes direct when the short street runs the right way", () => {
    expect(findWayBack(index(via(1)), [0, 0], target)!.length).toBeCloseTo(100, 3);
  });
  it("goes round when the short street is one-way against the rider", () => {
    const g = via(1);
    // Flip the short street: it now runs T to S only.
    g.edges[0] = [1, 0, 100, 100, 0, 0, 1];
    const way = findWayBack(index(g), [0, 0], target)!;
    expect(way.length).toBeCloseTo(300, 3);
    expect(way.turns.map((t) => t.turn)).toEqual(["right", "right"]);
  });
  it("can be ridden both ways when not one-way", () => {
    expect(findWayBack(index(via(0)), [100, 0], [{ at: [0, 0], penalty: 0 }])!.length).toBeCloseTo(100, 3);
  });
  it("finds nothing when the only street out is one-way inwards", () => {
    const g = hand([[0, 0], [100, 0]], [[1, 0, 0, 0, 1]], ["a"]);
    expect(findWayBack(index(g), [0, 0], [{ at: [100, 0], penalty: 0 }])).toBeNull();
  });
});

describe("compute time on a graph of about 6000 nodes", () => {
  it("finds a way back across the whole grid in well under 30 ms", () => {
    const g = grid(0, 0, 77 * 60, 77 * 60, 60);
    expect(g.nodes.length).toBe(78 * 78);
    const idx = index(g);
    const targets: { at: XY; penalty: number }[] = [];
    for (let d = 0; d <= 4000; d += 50) targets.push({ at: [4400, 200 + d], penalty: d < 2000 ? (2000 - d) * 1.5 : 0 });
    const times: number[] = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      const way = findWayBack(idx, [50 + k, 80], targets);
      times.push(performance.now() - t0);
      expect(way).not.toBeNull();
    }
    times.sort((a, b) => a - b);
    const median = at(times, 7);
    console.info(`way back on ${g.nodes.length} nodes: median ${median.toFixed(2)} ms, max ${at(times, 14).toFixed(2)} ms`);
    expect(median).toBeLessThan(30);
  });
});
