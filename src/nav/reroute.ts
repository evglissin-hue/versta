import { angleDiff, bearing, dist, polylineLength, type XY } from "../geo";
import type { RouteGraph, TurnKind } from "../types";

/** The rider must be within this many metres of a graph node for a way back to be found. */
export const START_RADIUS = 120;
/** A target point on the route is mapped to a graph node within this many metres. */
export const TARGET_RADIUS = 60;
/** A change of bearing beyond this many degrees is a turn. */
export const TURN_ANGLE = 35;
/** Bearings are measured over at least this many metres either side of a junction, so short edges do not jitter. */
const BEARING_SPAN = 12;
const CELL = 100;

/** The graph prepared for searching: adjacency in compressed form (respecting one-way edges) and a spatial grid. */
export interface GraphIndex {
  graph: RouteGraph;
  /** Node positions in the local projection, metres. */
  pts: XY[];
  /** Edges leaving node i are slots first[i] to first[i + 1] - 1. */
  first: Int32Array;
  to: Int32Array;
  cost: Float64Array;
  /** Index into graph.edges for each slot. */
  edge: Int32Array;
  cells: Map<number, number[]>;
}

export interface WayTarget {
  at: XY;
  /** Extra cost in metres, for targets the rider would rather not use (behind them). */
  penalty: number;
}

export interface WayTurn {
  turn: TurnKind;
  /** The street turned onto, or its kind ("footpath", "cycle path", "steps", "path") when it has no name. */
  name: string;
  at: XY;
  /** Metres from the start of the line. */
  along: number;
}

export interface WayBack {
  /** From the rider to the chosen point on the route, in the local projection. */
  line: XY[];
  length: number;
  turns: WayTurn[];
  /** Index of the target the way ends at. */
  target: number;
}

const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

/** Build the adjacency and grid once per graph. `project` maps a node to the local projection. */
export function buildIndex(graph: RouteGraph, project: (p: [number, number]) => XY): GraphIndex {
  const n = graph.nodes.length;
  const pts: XY[] = graph.nodes.map((p) => project(p));
  const deg = new Int32Array(n + 1);
  for (const e of graph.edges) {
    deg[e[0] + 1]!++;
    if (e[6] !== 1) deg[e[1] + 1]!++;
  }
  for (let i = 0; i < n; i++) deg[i + 1]! += deg[i]!;
  const slots = deg[n]!;
  const to = new Int32Array(slots);
  const cost = new Float64Array(slots);
  const edge = new Int32Array(slots);
  const fill = deg.slice(0, n);
  graph.edges.forEach((e, k) => {
    const put = (a: number, b: number): void => {
      const s = fill[a]!++;
      to[s] = b; cost[s] = e[3]; edge[s] = k;
    };
    put(e[0], e[1]);
    if (e[6] !== 1) put(e[1], e[0]);
  });
  const cells = new Map<number, number[]>();
  pts.forEach((p, i) => {
    const key = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL));
    const list = cells.get(key);
    if (list) list.push(i); else cells.set(key, [i]);
  });
  return { graph, pts, first: deg, to, cost, edge, cells };
}

/** The node nearest `p` within `maxDist` metres, or -1. */
export function nearestNode(index: GraphIndex, p: XY, maxDist: number): number {
  const r = Math.ceil(maxDist / CELL);
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  let best = -1;
  let bestD = maxDist;
  for (let x = cx - r; x <= cx + r; x++) {
    for (let y = cy - r; y <= cy + r; y++) {
      const list = index.cells.get(cellKey(x, y));
      if (!list) continue;
      for (const i of list) {
        const d = dist(p, index.pts[i]!);
        if (d <= bestD) { bestD = d; best = i; }
      }
    }
  }
  return best;
}

/** Binary min-heap of (priority, node) pairs with lazy deletion. */
class Heap {
  private pri: number[] = [];
  private val: number[] = [];
  get size(): number { return this.pri.length; }
  push(p: number, v: number): void {
    let i = this.pri.length;
    this.pri.push(p); this.val.push(v);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.pri[up]! <= p) break;
      this.pri[i] = this.pri[up]!; this.val[i] = this.val[up]!;
      i = up;
    }
    this.pri[i] = p; this.val[i] = v;
  }
  pop(): [number, number] {
    const topP = this.pri[0]!;
    const topV = this.val[0]!;
    const p = this.pri.pop()!;
    const v = this.val.pop()!;
    const n = this.pri.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.pri[c + 1]! < this.pri[c]!) c++;
        if (this.pri[c]! >= p) break;
        this.pri[i] = this.pri[c]!; this.val[i] = this.val[c]!;
        i = c;
      }
      this.pri[i] = p; this.val[i] = v;
    }
    return [topP, topV];
  }
}

function turnKind(delta: number): TurnKind {
  const a = Math.abs(delta);
  if (a <= TURN_ANGLE) return "straight";
  const right = delta > 0;
  if (a <= 70) return right ? "slight_right" : "slight_left";
  if (a <= 125) return right ? "right" : "left";
  return right ? "sharp_right" : "sharp_left";
}

const KIND_LABEL: Record<string, string> = { road: "road", cycle_path: "cycle path", footpath: "footpath", steps: "steps", path: "path" };

function labelOf(index: GraphIndex, edgeIdx: number): { label: string; named: boolean } {
  const e = index.graph.edges[edgeIdx]!;
  const name = index.graph.names[e[4]];
  if (name) return { label: name, named: true };
  const kind = index.graph.kinds[e[5]] ?? "road";
  return { label: KIND_LABEL[kind] ?? "path", named: false };
}

/**
 * The cheapest way from `from` to any of `targets` along the graph (Dijkstra on edge cost), or null when the rider
 * is not within START_RADIUS of a node or no target can be reached. The line runs from the rider to the node path
 * and on to the chosen target point.
 */
export function findWayBack(index: GraphIndex, from: XY, targets: WayTarget[]): WayBack | null {
  const startNode = nearestNode(index, from, START_RADIUS);
  if (startNode < 0) return null;

  // Node -> cheapest target that maps to it.
  const goal = new Map<number, { extra: number; target: number }>();
  targets.forEach((t, i) => {
    const node = nearestNode(index, t.at, TARGET_RADIUS);
    if (node < 0) return;
    const extra = t.penalty + dist(index.pts[node]!, t.at);
    const have = goal.get(node);
    if (!have || extra < have.extra) goal.set(node, { extra, target: i });
  });
  if (goal.size === 0) return null;

  const n = index.pts.length;
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevSlot = new Int32Array(n).fill(-1);
  const heap = new Heap();
  best[startNode] = 0;
  heap.push(0, startNode);
  let bestTotal = Infinity;
  let bestNode = -1;
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > best[u]!) continue;
    // Penalties are never negative, so nothing popped from here on can beat the best total.
    if (d >= bestTotal) break;
    const g = goal.get(u);
    if (g && d + g.extra < bestTotal) { bestTotal = d + g.extra; bestNode = u; }
    for (let s = index.first[u]!; s < index.first[u + 1]!; s++) {
      const v = index.to[s]!;
      const nd = d + index.cost[s]!;
      if (nd < best[v]!) { best[v] = nd; prev[v] = u; prevSlot[v] = s; heap.push(nd, v); }
    }
  }
  if (bestNode < 0) return null;

  const nodes: number[] = [];
  const edges: number[] = [];
  for (let v = bestNode; v >= 0; v = prev[v]!) {
    nodes.push(v);
    if (prevSlot[v]! >= 0) edges.push(index.edge[prevSlot[v]!]!);
  }
  nodes.reverse();
  edges.reverse();

  const target = goal.get(bestNode)!.target;
  const goalPoint = targets[target]!.at;
  const nodePts = nodes.map((i) => index.pts[i]!);
  const line: XY[] = [from, ...nodePts, goalPoint];
  const length = polylineLength(line);

  // Turns: at each junction between two edges of the path.
  const turns: WayTurn[] = [];
  const offset = dist(from, nodePts[0]!);
  const alongNode: number[] = [offset];
  for (let i = 1; i < nodePts.length; i++) alongNode.push(alongNode[i - 1]! + dist(nodePts[i - 1]!, nodePts[i]!));
  for (let i = 1; i < nodePts.length - 1; i++) {
    let a = i - 1;
    while (a > 0 && dist(nodePts[a]!, nodePts[i]!) < BEARING_SPAN) a--;
    let b = i + 1;
    while (b < nodePts.length - 1 && dist(nodePts[i]!, nodePts[b]!) < BEARING_SPAN) b++;
    const delta = angleDiff(bearing(nodePts[a]!, nodePts[i]!), bearing(nodePts[i]!, nodePts[b]!));
    const was = labelOf(index, edges[i - 1]!);
    const now = labelOf(index, edges[i]!);
    if (Math.abs(delta) <= TURN_ANGLE && was.label === now.label) continue;
    turns.push({ turn: turnKind(delta), name: now.label, at: nodePts[i]!, along: alongNode[i]! });
  }
  return { line, length, turns, target };
}
