# Task 25: start from the nearest stop

Owned paths: `src/nav/engine.ts` (`startAt`), `tests/unit/nav.test.ts` (or a new `tests/unit/startat.test.ts`),
`src/ui/StartChoice.tsx` (new), `src/ui/Ride.tsx` (render it), `src/ui/Banner.tsx` (the to-start banner),
`src/ui/uistate.ts` and `src/ui/join.test.ts` (remove the old join choice), `src/ui/Demo.tsx` (a step),
`src/styles/app.css`, `tests/e2e/smoke.spec.ts` (tests that start a real ride far from stop 1 now see the sheet).
Not: `src/ride.ts`, `src/types.ts`, `src/state.ts` (master: already done, see below).

Read first: `docs/build/it6-00-overview.md` section 5; in `src/ride.ts` the master's `startOffer`,
`START_CHOICE_METRES`, `chooseStart` and how `choosing` gates the fixes; `startChoice` in `src/state.ts`;
`StartChoice` and `NavEngine.startAt` in `src/types.ts`; in `src/nav/engine.ts` `toStart`, `jumpToSegment`,
`markBehind`, `JOIN_*`; `src/ui/Banner.tsx` (the current "To the start / Join nearby" choice), `joinChoice` and
`joinTarget` in `src/ui/uistate.ts`; CLAUDE.md copy rules.

## Goal

A rider who opens a route far from its first stop chooses, before anything is said, whether to start at stop 1 or
at the nearest stop; the ride then guides them there and runs on to the last stop.

## Decisions

- Engine `startAt(stop)`: called once, before the engine has seen a fix, for any stop including 0.
  - The ride begins `to_start` towards that stop, guided exactly as stop 0 is today (`toStart` generalised to a start
    stop). Within the stop's radius: arrive at it, `at_stop`, then on along the next segment.
  - Stops before it and their segments are behind (cues and asides never fire) and skipped: not in `arrived`.
  - No silent join part way after `startAt` (neither `JOIN_*` logic nor `nearest`): the rider goes where they chose.
    Without a call to `startAt` the engine behaves exactly as today (resume, simulator, "Ride to this stop").
  - `distanceDone` and `distanceLeft` count from the chosen stop.
- The sheet `StartChoice.tsx`, shown on the ride screen while `startChoice.value` is set, bottom sheet, modal, no
  close button (the rider must choose; Back ends the ride as from the ride screen with nothing started):
  - Title "Where do you start?"
  - Button 1 (primary): "Start at 07 Foot Tunnel", under it "600 m away, the nearest stop".
  - Button 2: "Start at 01 Tower Bridge", under it "4.2 km away, the start of the route".
  - Each calls `chooseStart(stop)`. Stop numbers two digits as elsewhere; distances with the existing formatter.
- The to-start banner: "Head for 07 Foot Tunnel, 600 m" (or "Head for the start, 01 Tower Bridge, 4.2 km"). The old
  "To the start / Join nearby" choice and `joinTarget` / `joinChoice` are removed with their test.
- `Demo.tsx`: step `start-choice` showing the sheet with Thames Loop numbers.
- Copy plain, no dashes, no exclamation marks; buttons at least 48 px.

## Acceptance checks

1. Unit (engine): `startAt(7)` then fixes walking from a point near stop 7 into its radius: arrives at 7 first,
   `arrived` holds only stops from 7 on, no cue or aside of segments up to 7 fires, the ride then reaches the last
   stop with every later turn spoken. `startAt(0)` with the rider 60 m from the line far from stop 0: no join, guided
   to stop 0.
2. Unit: `startOffer` (ride.ts, already written) returns null within 300 m of stop 1 and never offers the last stop.
3. e2e: with geolocation set near a middle stop of the Thames Loop, tapping Ride shows the sheet; choosing the
   nearest stop gives a banner heading for that stop; choosing stop 1 heads for stop 1. Existing smoke tests that
   start a real ride are updated for the sheet.
4. Screenshot of the `start-choice` demo step at 390 by 844, light and dark, in the report.
5. `npm run check` and `npx playwright test tests/e2e/smoke.spec.ts` pass.
