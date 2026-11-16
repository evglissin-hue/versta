# Task 2: the map

Owned paths: `src/map/**`.

## Goal

`MapView` (`src/map/MapView.tsx`, props in the existing stub) shows a chart-styled live map of London with the route,
the stops, the rider and the next manoeuvre, and keeps the camera on the rider.

## Decisions

- MapLibre GL JS 4 (already a dependency). Import its CSS. One map instance per mount, removed on unmount.
- Tiles: OpenFreeMap vector tiles, OpenMapTiles schema. Get the tile URL template from `tileTemplate()` in
  `src/offline.ts`; it is a stub that throws in your worktree, so catch any failure and fall back to the TileJSON at
  `https://tiles.openfreemap.org/planet` (source `url`). Glyphs:
  `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf` with "Noto Sans Regular", "Noto Sans Bold" and
  "Noto Sans Italic". No sprites.
- Style (`src/map/style.ts`): our own style, not a stock one. An Admiralty chart: land buff, water shoal blue, parks a
  quiet green, buildings barely there from zoom 15, roads as plain lines (minor, major, paths dashed, rail thin), road
  names along the line, place names, water names in italic. Two palettes, light and dark, matching
  `src/styles/tokens.css`; follow `prefers-color-scheme` and switch live. Street names must be readable at zoom 16 in
  sunlight: dark ink with a land-coloured halo.
- Route: the segment being ridden is a thick line in the mark colour with a land-coloured casing; the part already
  ridden (earlier segments and the current one up to `nav.alongSeg`) is muted; later segments are thinner and lighter.
  The foot tunnel segment (two points, stop id `foot-tunnel`) is dashed.
- Stops: numbered round HTML markers (two digits, Barlow Condensed). The stop being ridden towards is filled with the
  mark colour, arrived stops with ink. Tapping one calls `onStopTap(index)`. At least 44px hit area.
- Asides: small quiet dots on the line. The next manoeuvre (`nav.nextCue`): a ring at its point.
- Rider: an HTML marker at `nav.snapped` (or the raw fix when there is no snap or the rider is off route), with a
  heading arrow from `fix.heading` or else `nav.routeBearing`, and a translucent accuracy circle. Animate between fixes
  so it glides. When off route the arrow turns the warning colour.
- Camera: with `follow` true and status `riding` or `at_stop`, ease to the rider at zoom 16.2, bearing
  `nav.routeBearing` when `settings.courseUp` else 0, with padding for the UI (about 150px top, 230px bottom). Any
  drag, pinch or rotate by the rider calls `onFollowChange(false)`. With status `idle`, `locating` or `to_start`, fit
  the whole route (and the rider when known).
- Attribution: MapLibre's compact attribution control, bottom left above the dock, with OpenStreetMap contributors and
  OpenFreeMap. It must not be removed.
- Read `nav` and `settings` from `src/state.ts` with signal effects; do not re-create the map when they change.
- Set `window.__verstaMap` to the map instance for the end-to-end tests.

## Acceptance checks

- A throwaway dev harness (do not commit it into `src/app.tsx`; a file under `src/map/dev/` with its own html entry
  is fine, or a Playwright script) renders the map with the real pack and a few hand-made `nav` states. Take
  screenshots at phone size (390 by 844) in light and dark: whole route, riding on segment 4 course-up, at a stop, off
  route. Look at them and fix what is wrong. Mention in the report what you saw.
- No console errors. The map survives unmount and remount.
- `npm run check` passes.
