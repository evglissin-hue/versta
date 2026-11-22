# Task 26: zoom in before turns

Owned paths: `src/map/geometry.ts`, `src/map/geometry.test.ts`, `src/map/MapView.tsx` (the follow camera only),
`tests/e2e/smoke.spec.ts` (one test).

Read first: `docs/build/it6-00-overview.md` section 7, `cameraZoom` and `lookAheadPadding` in `src/map/geometry.ts`,
the follow camera in `src/map/MapView.tsx` (how base zoom, manual zoom, course up and whole-route view work),
`NavState` in `src/types.ts` (`nextCue`, `toCue`, `currentCue`, `speedAvg`).

## Goal

Coming up to a turn, the map shows the junction big and clear, with the rider and the turn both on screen, and
eases back after it.

## Decisions

- A pure function in `geometry.ts`, `turnFrame(nav, base)` → `{ zoom, focus: LngLat | null }` or null:
  - Applies when `nextCue` is a real turn (not `straight`, not `depart`) and `toCue` is at most
    `clamp(speed * 12, 60, 200)` metres (speed = `speedAvg` or the fix speed, 4 m/s if unknown).
  - Zoom: `max(base, 17.5)`, capped at `FOLLOW_ZOOM_MAX`.
  - Focus: the midpoint between the rider and the turn point (`nextCue.at`), so both stay on screen; in course-up
    the bearing is kept as now.
  - After the turn is passed (it becomes `currentCue`), the frame holds until the rider is 30 m past it, then null.
- `MapView.tsx`: while a frame applies, the follow camera eases (about 800 ms) to its zoom and focus; when it ends,
  back to the normal follow camera. The existing +0.4 for a near turn in `cameraZoom` goes (the frame replaces it).
- The rider's hand wins: a manual zoom or drag during an approach cancels the frame until that turn is passed. Not
  in whole-route view, not while peeking at a turn, not off route.
- No new settings.

## Acceptance checks

1. Unit: the frame starts at the right distance for slow, normal and fast speeds, not for straight or depart, holds
   until 30 m past the turn, never zooms out from a closer base zoom.
2. e2e: on a simulated ride (`?sim=1&speed=5&scale=4`), sample the map zoom before, during and after the first real
   turn: it rises to at least 17.4 near the turn and falls back after.
3. `npm run check` and the smoke e2e pass.
