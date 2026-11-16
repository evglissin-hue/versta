# Iteration 3: what the review rounds found

Request: navigation that is more convenient, the recentre in particular, and a polishing pass.

## Round 1

Quality check (diffs against briefs, merge, `npm run check`):

- Task 11 (guidance): as briefed. One addition by the executor kept: the approach distance never drops below the
  "now" distance, or a turn less than 30 m after another would be skipped.
- Task 10 (camera): as briefed. Kept from the executor: the follow camera holds still while a finger is down, since
  each camera move was cancelling the rider's drag about one time in three.
- Task 12 (polish): as briefed. Listening time is 32 min from the pack, not the 40 the brief guessed; the pack wins.

Dead-end hunt (whole simulated rides at 4.5 and 9 m/s, a start part way, the detour tests):

- Found: the first turn after three stops (s03-003, s07-003, s09-002) was first heard at the turn itself. The rider
  only counted as having left the stop 50 m out, and those turns are 60 to 80 m from the stop. Fixed in the engine: a
  rider who stood still at the stop and is now moving along the next stretch has left after two fixes.
- New checks for the whole class, in `tests/unit/ride.integration.test.ts`: no turn is first heard at the turn, every
  warning comes at 20 m or more, and a rider on the line is never told they are riding against it (the line doubles
  back at Deptford and overshoots at The Grapes).
- 173 unit tests, 29 Playwright tests (three whole rides, the screens, the map being dragged and coming back), and
  the mix check pass.

Rider's seat (every new screen at 390 by 844, light and dark):

- The stop sheet had two Close buttons. One now.
- The first-ride sheet told riders inside the Android app to use the Android app. It now asks them to allow
  location all the time.
- The Android back button did not close the first-ride sheet. It does now.
- Vibration at turns needs the VIBRATE permission in the Android manifest. Added.

## Still open

- Not heard or felt by a person yet: the tick at the turn, the three soundscape levels, the vibration, and pinch
  zoom on a real touch screen.
- Detour turns still use the generic clips with no street names.
- Average speed on the finish screen includes time standing at stops.
