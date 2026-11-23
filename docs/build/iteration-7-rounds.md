# Iteration 7: what the review rounds found

Request (22 November, settled 23 November): a main menu with settings and the list of rides; a tutorial on it that
walks people through the features; sounds that stop when you go back instead of hanging on; tap to move on through a
story's phrases. Spec `it7-00-overview.md`, briefs 31 to 34.

## What changed from the spec

- Task 31 added `src/ui/PageBar.tsx` (the Back and title bar the three pages share), to keep Menu and Routes free of a
  circular import.
- The bare route count beside Routes on the menu is gone (see the rider's seat).

## Round 1

Quality check (each diff against its brief):

- Task 32: as briefed. Two choices of its own, both kept: the linger now starts when the 2.5 s end gap runs out, so a
  Close in that gap is silent too; and a paused story fires no effects from the playhead reports a seek makes.
  Found in review: stopping a passing-by story did not count as its end, so the next one could start straight
  after. It now keeps its gap; a unit test covers it.
- Task 31: as briefed. Found in review: the demo preview removed the saved ride on most steps, so opening a preview
  link on a real phone would have lost the rider's ride. It now removes only the one it made. The menu had two rules
  in a row under the header; one now.
- Task 33: as briefed. The hidden "Next part" and "Previous part" buttons are 48 px and see-through (a 1 px one fails
  the 48 px check); the scene keeps the arrow keys from the demo's step keys. Found in review: in Nearby a left tap on
  the first paragraph replayed the story from scratch, which un-paused a paused one. It now goes back in place.
- Merging: task 33's new tests started from the old Home; they start from the menu now.
- `npm run check`: 406 unit tests pass, build clean. e2e: menu, smoke and story 63 of 63; the whole-ride hunt 6 of 6.

Dead-end hunt, the new class "sound that outlives what started it" (`tests/e2e/hunt.spec.ts`, real audio in headless
Chromium, every mixer read through `window.__verstaSound.live()`), 11 checks, all passing:

- the scene's Back; Close story (no close chime, no linger); Map, then Stop in the mini bar; the phone's Back in the
  scene and with the story under the map; Pause (the soundscape and music go quiet, and come back on Resume); tapping
  through a whole story (the voice lands within 0.35 s of each paragraph's mark, the last tap closes it in silence);
  a paused story stays paused when tapped on; End ride with a story playing leaves no mixer; Stop on a passing-by
  story; Nearby's Back and Close; the Sound check's Close, Back and going to the background.
- Unit level (`tests/unit/sound-policy.test.ts`, 30 tests): stopAll at six moments of a stop, skip, the shorter
  linger, pause, paragraph steps and their effects, exact seeks in every voice phase, dispose closing the timeline.
- Found: nothing in the app. One test assumed the stop sheet stays open after a story is stopped; in a simulation the
  rider rides on at once and the sheet closes, as it should. The test reopens the stop from the stops list.

Rider's seat (every screen at 390 by 844 light and dark, and 360 by 740 light):

- The menu showed "2" beside Routes in the same column as the tutorial's "2 MIN": it read as a time. Removed.
- About's "Simulate a ride" link said nothing about what it does. It now has one line.
- The scene's top bar (Back, the stop's name, Map) and the mini bar's four buttons fit at 360 px.
