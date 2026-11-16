# Task 7: the line and the graph (Python tools)

Owned paths: `tools/*.py`, `tools/content/**`, `docs/adding-a-route.md`, and the generated files
`public/packs/thames-loop/pack.json`, `public/packs/thames-loop/graph.json`, `public/packs/thames-loop/cues/**`,
`public/packs/thames-loop/system/**`, `public/packs/index.json`.

## Goal

Three things: a bike router of our own over OpenStreetMap data, so routes are planned to our taste; the Thames Loop
re-planned where the first line left the river; and a compact corridor graph shipped with the pack so the app can
find a way back when the rider strays.

## What exists

- `tools/build_pack.py` builds `pack.json` from `tools/content/thames-loop.*` and cached OSM extracts in `OSM_DIR`
  (already downloaded at `/home/claude/osm`: about 70 `cell_*.xml` files and some `rel_*.xml`). Read it first: it
  parses the extracts, matches the line to street names, writes cues and anchors asides.
- `tools/fetch_osm.py` downloads extracts for cells near the GPX tracks. `tools/narrate.py` records cues, system
  clips and asides with Kokoro (models at `/home/claude/tts`, about 0.7 s of compute per second of audio).
- `tools/content/thames-loop.plan.json` (new, written by the master) lists the segments to plan again and why, with
  approximate via points. `tools/content/thames-loop.asides.json` now has a `near` point on some asides.

## Decisions

- `tools/router.py`: build a routing graph from the OSM extracts. Nodes are way nodes; edges are way pieces between
  junctions. Rideable: every `highway` a bike may use; footways, pedestrian streets and paths without
  `bicycle=yes|designated|permissive` are allowed as walking sections at a high cost; steps at a very high cost;
  motorways, trunk roads without cycle provision, and `bicycle=no|private` or `access=private|no` ways are out.
  Respect one-way streets unless `oneway:bicycle=no` or a contraflow cycle lane.
  Cost per metre: 1.0 for quiet residential streets; about 0.6 for ways that belong to a bicycle route relation
  (`route=bicycle`, national, regional or local) and for cycleways; 0.8 for living streets and pedestrian areas where
  bikes are allowed; 1.6 for tertiary, 2.5 for secondary, 4 for primary; 5 for walking sections; 20 for steps.
  Multiply by 0.8 for any way within 60 m of the Thames (water polygons are in the extracts) so the line likes the
  river. Routing: Dijkstra or A* through the via points in order, each snapped to the nearest rideable node.
- Coverage: the re-planned segments leave the corridor of the old line. Before routing, fetch the extra OSM cells you
  need (extend `fetch_osm.py` to take a bounding area or extra points; one request per cell, pause between requests,
  descriptive User-Agent, reuse the cache). Cover at least 700 m either side of both the old and the new line.
- Re-plan only the segments named in `thames-loop.plan.json` (4, 8, 10, 11). Keep every other segment's line exactly
  as it is. Save the planned lines where `build_pack.py` reads them: replace the two GPX inputs with one
  `tools/content/thames-loop.track.json` holding the line per segment (convert the existing lines into it).
  For segment 8, take the router's line only if at least half of it is off Westferry Road; say what it chose.
- `build_pack.py`: read `track.json`; anchor each aside by its street when that street is on the segment's line, else
  by its `near` point (nearest point of that segment's line, warn if more than 250 m away); add to `pack.system`:
  `rerouting: "system/rerouting.mp3"` ("Finding a way back to the route.") and `turns` with a clip for each turn kind
  except `depart` ("Turn left.", "Turn right.", "Bear left.", "Bear right.", "Sharp left.", "Sharp right.",
  "Continue straight."); add `graph: "graph.json"`. Update `km` in the pack and in `public/packs/index.json`.
- `graph.json` (`RouteGraph` in `src/types.ts`): the routing graph within 500 m of the final line, simplified
  (merge chains of degree-two nodes with the same name and kind, keep geometry out: straight edges between junctions
  are fine as long as no edge is longer than 150 m; split longer ones). Coordinates to 5 decimals. Target under
  450 KB. Every stop and every 100 m of the line must have a graph node within 40 m: check and report.
- Narration: `tools/narrate.py` must record the new cues, the rerouting clip and the turn clips, and delete cue
  files that no longer belong to the pack. Run it.
- Print the new cue list per segment and render a picture for the master to look at: `tools/render_line.py` writes
  `/tmp/line-<seg>.png` for each re-planned segment (old line grey, new line magenta, water blue, stops numbered,
  street names of the cues). Look at the pictures yourself and fix obvious faults (a line through water, a pointless
  loop, a long walking section that a nearby street would avoid).
- Update `docs/adding-a-route.md` to describe planning with the router.

## Acceptance checks

- The four re-planned segments: report old and new length, share of the new line on cycle routes or cycleways, metres
  of walking sections, metres on primary or secondary roads, and the cue list. Segment 4 must not use Evelyn Street
  for more than 300 m; segment 10 must not use The Highway for more than 150 m; segment 11 must use Wapping High
  Street and Wapping Lane.
- All 21 asides are anchored; list any anchored by `near` and how far they are from their point.
- `pack.json` validates against the `Pack` type (write a small check with `npx tsx` or a node script reading the
  fields), all audio files referenced by the pack exist, and no unreferenced cue files remain.
- `npm run typecheck` and `npm run build` pass. Unit tests that pin the old line's details may now fail: list which
  ones and why. Do not edit them; the master updates them.
