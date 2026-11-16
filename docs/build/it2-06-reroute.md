# Task 6: a way back when off route

Owned paths: `src/nav/reroute.ts`, `src/nav/engine.ts`, `src/geo.ts`, `src/story/director.ts`,
`tests/unit/reroute.test.ts`, `tests/unit/nav.test.ts`, `tests/unit/director.test.ts`.

## Goal

Today the app only says "You are off the route". It should find a way back along real streets, draw it, and talk the
rider back, with no network.

## Decisions

- The corridor graph (`RouteGraph` in `src/types.ts`) arrives through `engine.setGraph(graph)` some time after the
  ride starts, or never (old packs). With no graph, behave exactly as now.
- `src/nav/reroute.ts`, pure TypeScript: build an adjacency index once per graph (respect `oneway`), then
  `findWayBack(index, from, targets)`: Dijkstra with a binary heap on edge `cost`, from the graph node nearest the
  rider (within 120 m, else no route) to the cheapest of the target nodes. Return the polyline, its length in metres
  and its turns (a turn is where the street name changes or the bearing changes by more than 35 degrees; turn kinds
  as in `TurnKind`, with the name of the street turned onto, or "path" kinds from `graph.kinds`).
- Targets: points on the current segment from 50 m behind the last known `alongSeg` to its end, sampled every 50 m,
  each mapped to its nearest graph node within 60 m. Prefer rejoining ahead: add 1.5 times the distance behind as a
  penalty for targets behind the rider. Also include the stop itself.
- Engine: when `off_route` fires and a graph is set, compute a detour and emit `{ type: "detour", found }`. With a
  route found, set `state.detour` (`Detour`): the line from the rider's position, `toRejoin`, and `next`. On each fix
  trim the line behind the rider and update the distances. Emit `detour_turn` once per turn, 40 m before it. If the
  rider is more than 40 m from the detour line for 6 s, compute again, at most once every 10 s. On
  `back_on_route` clear `state.detour`. Compute time must stay under 30 ms on the real graph (measure it in a test
  once `public/packs/thames-loop/graph.json` exists; until then use a synthetic grid graph of similar size:
  about 6000 nodes).
- Nearest point for joining: while `to_start`, set `state.nearest` to the nearest point of the whole route
  (`at`, `seg`, straight-line `dist`). Recompute at most once every 5 s.
- Director additions:
  - `detour` with `found: true`: speak `pack.system.rerouting` when present and `navVoice` is on. Log `detour`.
  - `detour_turn`: speak `pack.system.turns?.[turn]` when present and `navVoice` is on. Log `detour_turn`.
  - `markHeard(ids)`: add to `heard`.
  - A soft bed under passing-by stories: when an aside starts and `settings.ambience` is on, `startBed(ambience, null)`
    with the ambience of the stop the rider last left (`nav.seg - 1`), and `stopBed(1.5)` when it ends or is cut.
    Do not restart a bed that a story already has running.

## Acceptance checks

Unit tests:

1. On a synthetic grid graph: the way back from a point two blocks off a straight route rejoins ahead, not behind;
   turns are reported with the right kinds and names; a one-way edge is respected; an unreachable start gives no route.
2. Engine with a graph: a detour 150 m off the line gives `off_route`, then `detour` found, a non-empty
   `state.detour.line` that ends on the route, `detour_turn` events in order, and after the rider follows the detour,
   `back_on_route` with `state.detour` cleared. Without a graph the same ride gives no `detour` events.
3. Straying from the detour triggers one recompute, not a storm of them.
4. `state.nearest` in `to_start` points at the right segment for a rider near Greenwich.
5. Director: rerouting clip and turn clips are spoken once each; `markHeard` stops a heard core story from
   auto-playing; an aside gets a bed and it stops with the aside.
6. All existing nav and director tests still pass. Update them where a contract addition requires it, not otherwise.
