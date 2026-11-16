# Task 10: the camera and the riding controls

Owned paths: `src/map/**`, `src/ui/Ride.tsx`, `src/ui/Banner.tsx`, `src/ui/Dock.tsx`, `src/ui/MapControls.tsx` (new),
`src/ui/uistate.ts`, `src/ui/format.ts`, `src/ui/format.test.ts`, `src/ui/Demo.tsx`, `src/styles/app.css`,
`tests/e2e/smoke.spec.ts`.

## Goal

While riding, the map should look after itself. Today, once the rider touches the map it stays where they left it
until they find a Recentre button in the dock. Make following the default state that the app returns to, and give
the rider two obvious controls on the map itself.

## Decisions

1. Follow button. A round 56px button floating on the map, bottom right, just above the dock (and above the aside
   card or mini bar when they show). It replaces the dock's Recentre button, which goes.
   - Following, course up: a filled arrow. Tap: switch to north up (writes `settings.courseUp`).
   - Following, north up: a compass needle with N. Tap: switch to course up.
   - Not following: the arrow hollow, in the mark colour, with the label "Recentre" beside it for the first 5 s. Tap:
     follow again, eased, not snapped.
2. Coming back by itself. When not following, `settings.autoRecentre` is on, the status is `riding` and the rider
   is moving (`nav.speedAvg` above 1.5 m/s, or `fix.speed` when `speedAvg` is absent), following resumes 8 s after
   the last touch on the map. Show the 8 s as a thin ring filling round the follow button. Any touch restarts it.
   Standing still, the map stays where the rider put it.
3. Zooming is not leaving. A pinch or double tap while following changes the follow zoom and keeps following; the
   chosen zoom is remembered for the session, clamped 14.5 to 18. Only a drag or a rotate stops following.
4. Look ahead. In course up, place the rider about two thirds of the way down the visible map (between the banner
   and the dock) so more road shows ahead. In north up, keep the rider centred in that visible area.
5. The camera helps with turns. Ease in by 0.4 of a zoom level when the next turn is within 120 m; ease out by 0.4
   above 7 m/s. Rotate smoothly by the shortest way round and ignore bearing changes under 8 degrees so the map does
   not twitch. Camera moves between fixes are linear and last about as long as the gap between fixes, so the map
   glides and does not step.
6. Whole route button. A second round button above the follow button (a small route squiggle icon). Tap: fit the
   whole route with the rider. Tap again, or the follow button: back to following. Auto-recentre waits 12 s in this
   state.
7. Peek at the turn. Tapping the banner while a turn is shown flies the camera to that manoeuvre at zoom 17 for 4 s,
   then returns to following.
8. Banner additions. When `nav.thenCue` is set, a second smaller line: a small arrow and "then right onto Cable
   Street". When `nav.wrongWay` is true: warning colours, "You are riding against the route", "Turn around when you
   can". 
9. Dock. The line under the next stop's name reads distance and time: "1.2 km, about 5 min", the time from
   `nav.speedAvg` (use 4 m/s when absent or under 1 m/s). Formatting helpers go in `src/ui/format.ts` with tests.
10. The map itself. Dark theme: the land is a murky olive brown; make it a deep blue grey that sits with
    `--paper` dark, parks a muted green, water darker than land, and check street names still read. At low zoom,
    where stop markers overlap (Greenwich: 05, 06, 07), shrink markers to 30px below zoom 13 and keep the next stop
    on top.

## Acceptance checks

- Extend the `/?demo=ride` steps: follow states (course up, north up, not following with the ring part way), whole
  route, `then` line, wrong way, dock with time. Add a way for the smoke test to drive the map: `window.__verstaMap`
  exists already.
- Playwright smoke tests (Chrome at `/usr/bin/google-chrome`, args `--no-sandbox --use-gl=angle
  --use-angle=swiftshader --enable-unsafe-swiftshader`), against your own preview on port 4176:
  - dragging the map stops following and shows the hollow arrow; tapping it follows again;
  - with a simulated ride (`/?sim=1&speed=5&scale=4&virtual=1`, tap Ride, wait for `riding`), dragging the map and
    then waiting brings following back by itself within 12 s; with `autoRecentre` off in localStorage it does not;
  - a wheel or pinch zoom while following keeps following;
  - the whole route button fits the route and the second tap returns to following;
  - 48px targets and no horizontal overflow at 360px still hold.
- Screenshots at 390 by 844, light and dark, of every new demo step and of a simulated ride mid segment; look at
  each with the Read tool and fix what is wrong. Say what you saw.
- `npm run check` passes.
