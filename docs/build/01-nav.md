# Task 1: navigation engine and position sources

Owned paths: `src/geo.ts`, `src/nav/engine.ts`, `src/nav/sources.ts`, `tests/unit/geo.test.ts`, `tests/unit/nav.test.ts`.

## Goal

Given a pack and a stream of position fixes, say where the rider is on the route and emit the events the rest of the
app reacts to. Pure TypeScript in `geo.ts` and `engine.ts`: no DOM, no timers, no `Date.now()` (use `fix.time`).

## Decisions

Geometry (`src/geo.ts`): work in metres on a local flat projection centred on the pack's first stop. Export small pure
helpers (project, distance, bearing in degrees clockwise from north, nearest point on a polyline with the distance
along it, point at a distance along a polyline, polyline length). The map task may import these.

Engine (`createNavEngine(pack, opts)` in `src/nav/engine.ts`, options default to `DEFAULT_NAV_OPTIONS`):

- Precompute per segment: cumulative lengths, each cue's distance along the segment (from its vertex `i`), each aside's
  distance along the segment (project `aside.at` onto the polyline).
- `seg` is the index of the stop being ridden towards. `segments[seg]` is the line to it. `segments[0]` is empty.
- Status flow:
  - `locating` until the first fix with accuracy at or under `maxAccuracy`. Worse fixes update `state.fix` only.
  - `to_start` while `seg` is 0 and the rider is outside `stops[0].arriveRadius`. `toStop` is the straight-line distance
    to the start. No snapping, no off-route.
  - Joining part way: while in `to_start`, if the rider is within 60 m of some segment's line and more than 150 m from
    stop 0, adopt the nearest such segment at that point: status `riding`, `seg` set, `arrived` filled with every stop
    before it, cues and asides behind the rider marked as passed without events.
  - Arrival: when the straight-line distance to `stops[seg]` is at or under its `arriveRadius`, or `alongSeg` is within
    20 m of the segment's end: emit `arrive`, add to `arrived`. If it is the last stop: status `finished`, emit
    `finished`. Otherwise status `at_stop`, then `seg` moves to the next stop with `alongSeg` 0.
  - `at_stop` lasts until the rider is more than `arriveRadius + 15` m from that stop or more than 40 m along the new
    segment: emit `leave`, status `riding`. No off-route while `at_stop`.
  - Missed arrival: if the rider is beyond the off-route threshold from the current segment but within 30 m of the next
    segment's line, treat the stop as reached: emit `arrive` for it and carry on on the next segment.
- Snapping while `riding`: search the current segment in a window from 30 m behind the last position to 400 m ahead and
  take the nearest point. This stops jumps where a route doubles back on itself (segments 7 and 8 share Napier Avenue).
  `alongSeg` never moves backwards by more than 30 m in one fix.
- Off route: when the distance to the route stays above `offRouteDistance + min(accuracy, 30)` for `offRouteDelay`
  seconds of `fix.time`, emit `off_route` once and set `offRoute`. While off route, search the whole current segment
  (not the window) so the rider can rejoin further on. When a fix is within 25 m of it again, emit `back_on_route`;
  cues and asides the rider skipped are marked passed without events.
- Cues, for the current segment in order:
  - A `depart` cue fires `phase: "now"` once, when the rider starts moving on the segment (the `leave` event, or the
    first `riding` fix at least 15 m along).
  - Every other cue fires `approach` once when the distance to it is at or under
    `max(cueApproachMin, speed * cueApproachSeconds)` (use 4 m/s when speed is unknown), then `now` once at or under
    `cueNowDistance`. If the rider is already past the approach point when the cue becomes next, fire only `now`.
  - `nextCue` and `toCue` describe the next manoeuvre ahead; `currentCue` is the last one passed (the stretch the
    rider is on).
- Asides: emit `aside` once when `alongSeg` reaches the aside's distance minus `asideLead`, but not if the rider is
  already more than 60 m past it.
- `distanceDone` and `distanceLeft` are over the whole route, counting completed segments in full.
- `routeBearing` is the bearing of the segment at the snapped point.
- `jumpToSegment(seg)`: ride towards stop `seg` from wherever the rider is: status `riding` (or `to_start` for 0),
  `alongSeg` from a whole-segment search on the next fix, `arrived` set to every stop before it.
- `state` is a plain object that is replaced or mutated in place; callers copy it. Keep `arrived` sorted.

Sources (`src/nav/sources.ts`):

- `createGpsSource()`: `navigator.geolocation.watchPosition` with high accuracy, `maximumAge` 1000, `timeout` 20000.
  Map `coords.heading` NaN or null to null, same for speed. Map errors to `GpsError`. `unsupported` when the API is
  missing. `stop()` clears the watch.
- `createSimSource(pack, { speed, scale, from })`: rides the whole route from stop `from` at `speed` metres per
  simulated second. Emits one fix per simulated second, `scale` simulated seconds per real second (for large scales
  emit several fixes per timer tick, in order). Adds up to 3 m of deterministic jitter (seeded, not `Math.random`),
  accuracy 6, heading along the line, speed as given. `hold(true)` stops movement but keeps emitting fixes. `now()`
  returns the simulated clock in milliseconds. At the end of the route it keeps emitting the last position.

## Acceptance checks

Unit tests (Vitest, node environment, load the real pack JSON from `public/packs/thames-loop/pack.json`):

1. A noiseless ride along every segment at 4 m/s arrives at all 13 stops in order, ends `finished`, and every cue
   fires `now` exactly once and never out of order. Every non-depart cue fires `approach` before `now`.
2. The same ride with 8 m of seeded noise and accuracy 10 gives the same arrivals and never reports `off_route`.
3. All 21 asides are emitted exactly once on a full ride.
4. A detour 120 m off the line for 30 s gives exactly one `off_route` and one `back_on_route`.
5. Starting 2 km into segment 4 adopts segment 4 with stops 0 to 3 in `arrived` and no `arrive` events for them.
6. On segments 7 and 8 (shared Napier Avenue) `alongSeg` never jumps by more than 60 m between consecutive fixes.
7. Fixes with accuracy 200 never change `seg` or `alongSeg`.
8. The simulator at scale 50 completes the route and its `now()` advances 50 times faster than real time, within 20 percent.
9. `geo.ts` helpers: a few direct tests with known values.
