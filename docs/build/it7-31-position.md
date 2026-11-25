# Task 31: a steady position and an honest off route

Goal: the rider's marker stays on the line and moves steadily while the rider rides the line, whatever the GPS
does, and off route, wrong way and rerouting come only from where the rider really went.

Owned paths: `src/nav/filter.ts` (new), `src/nav/engine.ts`, `src/native/gps.ts`, `src/nav/sources.ts` (browser
source only), `src/map/MapView.tsx`, `src/map/geometry.ts`, their tests. Contracts in `src/types.ts` are done by the
master: `Fix.receivedAt?`, `NavState.pos?`, `posAccuracy?`, `shown?`, `shownHeading?`.

## Decisions

### Sources

- `locationToFix`: an accuracy that is missing, not finite or not above 0 becomes `UNKNOWN_ACCURACY` (50 m). Every
  fix gets `receivedAt` (the clock when it reached the app: `Date.now()` on the phone and in the browser).
- The simulator sets `receivedAt` to its own clock.

### The filter (`createPositionFilter(origin)`, pure, no browser APIs)

- State per axis: position and velocity (local metres east and north), with a 2 by 2 covariance. Process noise is
  white acceleration, `Q_ACC` 1.5 m²/s³ (tuned on the jitter rides of task 32).
- Position measurement: the fix, variance `max(accuracy, 4)²`. Velocity measurement: from `speed` and `heading` when
  speed is at least 1 m/s and heading is known (variance `(0.6 + 0.1 * speed)²`), zero velocity when speed is below
  0.3 m/s (variance 0.5²). Anything else: position only.
- Gate on the position innovation, Mahalanobis squared `d2` over both axes, measured against what the fix claims
  (`max(accuracy, 4)²` plus the filter's own position variance): up to 9 taken as is; 9 to 30 taken with less
  weight (variance scaled by `(d2 / 9)²`); above 30 dropped as a jump. A taken fix counts for less than its claim:
  its standard deviation is the claim times `rScale` 2, because GPS errors hold for seconds and fixes are not
  independent. The sweep that chose 9, 30 and 2 is `tests/unit/jitter-sweep.test.ts` (on demand only).
- Velocity: applied with every fix, taken or not, unless it disagrees wildly with the track (d2 over 30, or over 9
  while coasting). A dropped jump still moves the estimate on by dead reckoning on the device's velocity. Device
  velocity standing still counts too: a cluster of fixes 50 m away while the phone says "standing" is multipath.
  After 10 s with no position taken the velocity fades (time constant 10 s).
- Dropped, never taken: `time` not after the last taken fix ("stale": duplicates, out of order); `receivedAt -
  time` over 10 s ("late"); accuracy over the engine's `maxAccuracy` ("poor").
- Re-acquire: dropped jumps that agree with each other (each within 15 m plus 15 m/s times the gap of the one
  before) for 4 fixes spanning at least 3 s, and that the rider could have reached since the last taken fix at
  15 m/s plus twice the accuracy, reset the filter to the latest of them. With device velocity fresh (within 5 s)
  that is not enough, because a cluster that sits a steady distance to one side is multipath: the jumps must also
  pull away from the dead reckoning as a rider leaving its path would, over 6 fixes and at least 5 s, each step
  outwards and none much bigger than the average, at 1.5 to 10 m/s, in one direction, from under 0.7 of the final
  offset. After 12 s of nothing but jumps (30 s with device velocity) the filter resets to the latest fix whatever
  it is: the track itself was wrong.
- `push(fix)` returns `{ used, why?, p, sigma, speed, heading }`: `sigma` is the 1-sigma position error, honest
  (it never drops below 3 m and grows while coasting), `heading` is null below 1.5 m/s.
- `resetTo(fix)` for the engine's snap back (below) and `reset()`.

### The engine

- Every fix the engine takes (accuracy within `maxAccuracy`) goes through the filter. A dropped fix updates
  `state.fix` (the raw fix, for the accuracy ring and the banner) and nothing else: no events.
- Snap back, only while the estimate itself is more than 20 m off the line: two dropped jumps in a row that lie
  within 15 m of the line, within 25 m (plus the distance ridden since the last fix) of where the dead reckoning has
  the rider along it, reset the filter to the second (the multipath has ended); four in a row on the line further
  along do the same (the track was wrong). While the estimate is on the line, refused fixes on the line never reset
  it: in a street of tall buildings multipath lands along the street itself, 50 m ahead or behind, and the first
  hunt showed both rules hijacking a correct estimate there.
- The position along the line advances at most 1.5 times the rider's speed per second plus 12 m: an estimate off to
  one side at a bend must not throw it forward to the next turn (not after a jump or off route, when the whole line
  is searched).
- Every decision reads the filtered position: matching to the line, arrival, the missed arrival, leaving a stop,
  setting off, off route, back on route, wrong way, the way back, guiding to the start, the nearest point.
  Speed and heading for the window, standing and wrong way come from the filter.
- `state.pos` and `state.posAccuracy` from the filter. `state.shown`: riding or at a stop and not off route, the
  snapped point while the offset is within `SNAP_FULL = 25 + min(error, 25)`, blending linearly to the filtered
  position over the next 30 m; off route, guiding to the start or locating, the filtered position. `shownHeading`:
  the route's bearing when the marker is on the line, else the filter's heading. The drawn marker moves at most the
  rider's speed times the time since the last fix plus 10 m (no leaps: a reset glides in over a few fixes), and
  while the rider rides forward at 1.5 m/s or more it does not slide back along the line: an estimate that falls
  back by up to 40 m holds the marker where it is until it catches up. Forward means the bearing agrees, within 90
  degrees, with the line where the marker is or where the estimate now projects (in a dogleg the two differ).
- `error` everywhere is `max(sigma, min(fix accuracy, 60), 8)`: never trust less than 8 m, never let a wild
  accuracy figure push thresholds past sense.
- Off route (replaces the 8 s rule): a spell starts when the offset passes `40 + min(error, 40)`. It counts the
  seconds, the metres ridden (filtered speed times time), the distance gained along the line and the largest
  offset. `off_route` fires when the spell is 10 s old, 30 m have been ridden, and one of: the distance gained
  along the line is under half the distance ridden (going away), the offset is 30 m past the threshold, or the
  spell has lasted 45 s and 200 m. The spell ends after two fixes back within the threshold less 10 m. The device's
  own fixes count as evidence too: two raw fixes in a row on the line near where the rider is end a spell, and none
  fires on a fix whose raw position is on the line (the estimate is what strayed).
- Back on route: two filtered fixes in a row within 25 m of the line.
- Wrong way: as today, but only from the filter's heading and speed, and the 40 m back along the line must also be
  40 m ridden.
- `jumpToSegment`, `startAt` and `reset` reset the filter.

### The map

- The rider marker and the follow camera use `shown` (fallback: the snapped point, then the fix). The arrow uses
  `shownHeading`. The accuracy ring uses `posAccuracy` when there is one. The guide line to the start begins at
  `pos`. `turnFrame` frames from `shown`.

## Acceptance

- `tests/unit/filter.test.ts`: on-line fixes with 5 m noise give an error under 4 m RMS; one 60 m jump with a 5 m
  accuracy is dropped and moves the estimate under 3 m; duplicate, older and late fixes are dropped; a 90 degree
  turn at 6 m/s with good fixes lags under 6 m; a GPS gap of 20 s followed by a jump consistent with the speed is
  taken; a move of 300 m held for 15 s is taken by re-acquiring; a missing accuracy is 50 m.
- The engine tests in `tests/unit/nav.test.ts` pass, with any scenario that teleports the rider rewritten to move
  as a rider can, and the change explained in the test.
- Task 32's jitter rides pass.
- `npm run check`.
