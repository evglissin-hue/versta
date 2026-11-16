# Task 9: the experience round

Owned paths: `src/app.tsx`, `src/main.tsx`, `src/ui/**`, `src/styles/**`, `src/map/**`, `src/offline.ts`,
`tests/e2e/smoke.spec.ts`.

## Goal

The first version works. Make it feel considered. Each item below is a design decision already made; build them.

## Decisions

1. Continue a ride. `savedRide()` in `src/ride.ts` returns an unfinished ride on this device. On Home, a pack with
   one shows a main button "Continue ride" with a line under it ("You reached 05 Deptford & the Tsar") and a smaller
   "Start again". Continue calls `startRide(pack, sim, saved)`. Start again calls `forgetSavedRide()` then starts.
2. Joining. While `nav.status` is `to_start` and `nav.nearest` is set, the banner offers two choices with distances:
   "To the start" and "Join nearby" (hide the second when the nearest point is within 150 m of the start). The
   chosen target gets a dashed guide line on the map from the rider to it, and the banner says "Head for the start,
   2.1 km" or "Head for the route, 300 m". Default: whichever is nearer. The choice is UI state only; the engine
   adopts the route by itself once the rider is on it.
3. The story scene gets out of the way. When the rider leaves the stop (`nav.status` goes from `at_stop` to `riding`)
   while a story plays, hide the scene and show the mini bar, so the map and the turn banner are back without a tap.
4. The stop sheet becomes a bottom sheet: at most 62 percent of the height, scrolling inside, the map visible above
   it, a Close button and a tap on the map both close it. Hide "Ride to this stop" for the stop the rider is at or is
   already heading for; show "You are here" or "Next stop" there.
5. The finish. When `nav.status` is `finished` and nothing is playing, show a logbook over the map: route name, km
   ridden, time taken (from `rideStartedAt()` in `src/ride.ts`), stories heard out of the total, and the optional
   stories not heard, each with a Play button. Buttons: "Back to the map" and "End ride".
6. The detour. When `nav.detour` is set: draw its line on the map (dashed, warning colour) with a ring where it
   rejoins; the banner shows the detour's next turn (arrow, street name, distance) under a "Way back" label, or
   "Follow the dashed line, 240 m" when there is no turn. When off route with no detour, keep the current
   off-route banner.
7. Small things: the banner's "Go straight in" for a `straight` cue reads "Continue onto"; distances under 20 m read
   "now"; the Stops button shows how many are done ("Stops 3/13"); the aside card shows its tags.

## Acceptance checks

- Extend the `/?demo=ride` preview with steps for: continue card on Home (a saved ride injected), join choice,
  scene auto-hidden with mini bar, bottom sheet over the map, finish logbook, detour with a turn, detour without a
  turn. Screenshot each at 390 by 844 in light and dark (Chrome at `/usr/bin/google-chrome`, `--no-sandbox`, and for
  the map `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), look at every one with the Read
  tool, read every line of copy in place, fix what is wrong, and say what you saw.
- Smoke tests cover the new demo steps and still check 48px targets and no horizontal overflow at 360px.
- `npm run check` passes. Run the smoke tests against your own preview on port 4175.
