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

Wave 2, task 34 (the tutorial):

- As briefed. Its own choices, kept: the picker has a looser second pass if the strict rules find nothing; a card with
  too little room drops its picture first; Next stays disabled until the step's part is lit.
- Found in review: step 4 lit the whole story body, which left its card room for the title only: Previous and Next
  were cut off. The tour spec checked the card's box but not what was inside it. The step lights the paragraph now,
  the card's line gives way before its buttons ever do, and the spec checks at every step and size that Next lies
  wholly inside the card and on screen.
- Found in review: step 4 moved on as soon as the paragraph changed, and the voice changes it by itself about 3.5 s
  in (each story's first paragraph is short), so the tour skipped on before the rider had tapped. It waits for a tap.
- Rider's seat: the dim hardly showed on dark pages (deeper now); step 5, "Pause or close", never said what Close
  does (it does now); the end card's "Back to the menu" wrapped in its button (it is "Menu").
- Known: going back to step 1 does not speak the turn again, because the director never repeats a cue. The banner and
  the card still show it.

## Round 2

- `npm run check`: 415 unit tests pass, build clean. The full e2e suite on the final build, four workers: 93 of 94.
  The one failure, "a wheel zoom while following keeps following", waited a fixed 900 ms for the map's zoom, which
  lands later on a machine busy with four browsers playing real audio. It passes alone (3 of 3) and now waits for the
  zoom itself. It touches nothing this iteration changed.
- The Android build passes on CI from the branch (run 45093691263); its APK is the run's artifact, for the phone checks.

- Dead-end hunt over the tutorial (`tests/e2e/tour.spec.ts`): Close, Escape and the phone's Back at each of the eight
  steps leave no mixer within 2 s and the saved ride as it was; Close straight after Start; End ride in the dock ends
  the tour; Choose a route opens Routes; the follow setting the rider flips is put back.
- Rider's seat: every menu page, ride state and tutorial step read in place at 390 by 844 light and dark and 360 by
  740 light. Nothing new found.

## Phone checks (Evgeny)

1. Install the test APK. The app opens on the menu. Back on a page returns to the menu; Back on the menu sends the
   app to the background.
2. Settings before a ride: set the soundscape level, start a ride, hear it.
3. The tutorial with earphones: the turn, the arrival chime and the story; tap the right of the story and the voice
   jumps on; Map, then Stop in the bar; the passing-by story; Close at any step is silence at once. Lock the phone
   mid-tour: the sound stops, and the step starts again when you come back.
4. A real ride, at a stop: Back on a story stops it and its music within 2 s; Map keeps it playing with Stop in the
   bar; Pause quiets the music too; Close story makes no chime and leaves no music behind.
5. Nearby: tap through a place's story; Back stops it, a second Back closes Nearby.

## Open

- Browser history for the pages on the web: the system back gesture still leaves the site from a page, as it did from
  Nearby. The Android app's Back is handled.
- A passing-by chime already queued behind turn speech still sounds after a Stop (the mixer gives signals no cancel).
  It cannot be reached from the screen: the card that has Stop appears only after the chime.
