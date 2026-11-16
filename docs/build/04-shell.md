# Task 4: screens, offline saving, icons

Owned paths: `src/app.tsx`, `src/main.tsx`, `src/ui/**`, `src/styles/**` (keep the token names in `tokens.css`),
`src/offline.ts`, `public/icons/**`, `index.html` (head only), `tests/e2e/smoke.spec.ts`, `tools/make-icons.mjs`.

## Goal

The app a rider sees: pick a route, ride it, hear and read its stories. One hand, outdoors, big targets.

## Look

Carry over the prototype in `docs/legacy/artifact-v2-template.html`: an Admiralty chart. Barlow Condensed in capitals
for labels, buttons and street names; Newsreader for story text. Square corners, 2px ink borders, the chart magenta for
the one thing to press. Fonts come from the `@fontsource` packages (import the weights used: Barlow Condensed 500, 600,
700; Newsreader 400 and 400 italic), so they work offline. Light and dark follow the system.

## Screens

Home (`screen` is "home"):
- Wordmark VERSTA with one line under it: "Rides and walks that tell you their stories as you pass."
- One card per entry in `public/packs/index.json` (load it into `packIndex`): hero picture, name, km, stops, blurb,
  a main button "Ride" and a secondary "Save for offline" that shows progress and then "Saved for offline".
- "Ride" must, inside the tap handler, call `loadPack(id)` then `startRide(pack)` from `src/ride.ts`.
- Footer: the credits. A small "Simulate a ride" link that reloads with `?sim=1&speed=5&scale=8`.

Ride (`screen` is "ride"): the map fills the screen (`MapView` from `src/map/MapView.tsx`, a stub in your worktree),
with these over it:
- Cue banner, top: from `nav`. `locating`: "Finding you". `to_start`: "Head to the start" with the stop name and
  distance. `riding`: a large arrow for `nextCue.turn`, the street name large, the distance to it (to 10 m; "now"
  under 20 m), and smaller the stretch being ridden (`currentCue.name`). No `nextCue`: the next stop and distance.
  `at_stop`: "At 03 The Mayflower". Off route: warning colours, "Off the route by 60 m". `finished`: "Route complete".
  If `gpsError` is set: say what happened and how to fix it (location permission, GPS off).
- Dock, bottom: next stop number and name, distance left to it, a thin progress line for the whole route, and
  buttons: Stops, Recentre (only when the map is not following), Sound, End ride (asks once before ending).
- Aside card: while `nowPlaying.kind` is "aside": title, tags, the text (three lines, tap to expand) and a Stop
  button. Sits above the dock.
- Story scene: while `nowPlaying.kind` is "story": full-screen dark scene like the prototype's (picture drifting
  slowly behind, stop name, tags, title, the current paragraph, one tick per paragraph, picture caption). Buttons:
  Pause or Resume (in `manual` mode it is Next, then Finish on the last paragraph), Next story or End (calls
  `skip()`), and "Back to map", which hides the scene but keeps the story playing; a mini bar in the dock then shows
  the story title with pause and a way back into the scene. Use `currentDirector()` from `src/ride.ts`.
- Stop sheet: when `openStop` is set: the stop's name, note, "Pint stop" chip, its stories (picture thumb, kind, tags,
  minutes, heard or not, a Play button each), "Play all", "Ride to this stop" (`jumpToStop`) and Close.
- Stops list: every stop in order with arrived state and distance; tapping one opens its sheet.
- Sound sheet: a switch for every field of `Settings` (use `updateSettings`), passing-by stories as a three-way
  choice Off, Sparse, Rich, each with a one-line explanation.
- When `simulated` is true show a small SIMULATED tag on the banner.

## Offline (`src/offline.ts`)

- `tileTemplate()`: fetch `https://tiles.openfreemap.org/planet` (3 s timeout), take `tiles[0]`, remember it in
  `localStorage`. If the network fails, return the remembered template, preferring the one stored with a saved pack.
- `savePackOffline(pack, onProgress)`: put every pack file into the Cache Storage cache `versta-packs` (pack.json,
  all story, aside, cue and system audio, all pictures), and into `versta-tiles` every vector tile at zooms 11 to 16
  that lies within 400 m of the route line, plus the glyph ranges 0-255 and 256-511 for the three font stacks. Fetch
  at most six at a time, report progress, and store `{ savedAt, bytes, tileTemplate }` under
  `versta:offline:<packId>`. A failed file is retried once and then counted as failed; reject at the end if any failed.
- `offlineStatus`, `removePackOffline` to match. The service worker (configured in `vite.config.ts`, not yours to
  edit) already serves both caches cache-first.

## Icons

A verst post: the striped black and white roadside post of old Russian highways, on chart buff, with a magenta cap.
`public/icons/icon.svg`, and PNGs `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (safe zone respected)
rasterised by a small script `tools/make-icons.mjs` using Playwright (already a dev dependency, Chrome at
`/usr/bin/google-chrome`). Commit the PNGs.

## Acceptance checks

- A dev-only preview route: opening `/?demo=ride` shows the ride screen driven by hand-made state (no GPS, no audio),
  cycling through: locating, riding with a cue, off route, at a stop with the sheet open, a story scene, an aside
  card. Take phone-size screenshots (390 by 844) of each in light and dark, look at them, fix what is wrong, and say
  in the report what you saw. Every line of copy must be read in place.
- `tests/e2e/smoke.spec.ts` (Playwright against `npm run preview`): home renders the Thames Loop card; `/?demo=ride`
  shows the banner and dock; no console errors.
- No text is clipped at 360px wide. Every button is at least 48px tall.
- `npm run check` passes.
