# Iteration 6: what the review rounds found

Request (22 November): new routes and changes to routes reach the Android app without a reinstall, automatically
on Wi-Fi; start a route from the nearest stop; a places library with a Nearby map and pocket alerts; zoom in before
turns; a ride recorder; the next turn on the lock screen. Spec `it6-00-overview.md`, briefs 21 to 30.

## What changed from the spec

- Offline map tiles on the phone stay out, by Evgeny's choice. Since the app never reads saved tiles, "Save for
  offline" and its notes are hidden in the Android app; the web keeps them.
- Recordings leave the phone through the Android share sheet (`@capacitor/share`, the only way to hand a file to
  another app). New dependencies in all: `@capacitor/filesystem`, `@capacitor/local-notifications`,
  `@capacitor/share`.
- The start choice sheet gained "Back to the routes" (see round 1).
- The route store keeps downloaded updates that wait (held for a ride) under their own key, `versta:routes-next`,
  so a restart does not delete them; a failed download waits for a tap instead of retrying every minute.

## Round 1

Quality check (each diff against its brief):

- Task 21: as briefed. 65 places (24 stops, 41 passing-by stories); both packs carry a version, size and date.
- Task 22: as briefed, with the additions above. Everything the phone does with files and the network sits behind
  one interface, so 21 scenario tests run without a phone.
- Task 24: as briefed. The master added the version check to `src/app.tsx`.
- Task 25: the engine's `startAt` and the sheet as briefed. It also had to change `src/map/MapView.tsx` (the guide
  line read the old join choice).
- Task 26: as briefed. The old +0.4 zoom for a near turn is gone, replaced by the turn frame.
- Task 27: as briefed. The master wired the recorder into `src/ride.ts` and filled the Android export.
- Task 23: as briefed.
- Task 28: as briefed; the master wired it into `src/ride.ts` and added a status bar icon (a white V) so Android does
  not show a blank square.
- Task 29: as briefed.
- Task 30: as briefed, plus: a place held back by the 5 minute gap is told later if the rider is still near it.
  `nearbyControls.play` now says whether it found the place, because a tap that opens the app arrives before the
  places have loaded. The master starts the watch at launch and stops it when a route ride starts.
- A unit test of the mixer timed out at 5 s while six worktrees loaded the machine (it takes 2 s alone): given 20 s.
- Parallel worktrees could have tested each other's build (Playwright reused whatever server held port 4173):
  `E2E_PORT` now gives each its own.

Dead-end hunt:

- Found: the start choice sheet had no way out. With the scrim over End ride and Back doing nothing on the ride
  screen, a rider who opened the wrong route had to choose a start first. It now has "Back to the routes", and Back
  does the same. e2e covers both.
- Found: the banner above the sheet said "Finding you, waiting for a GPS position" while the sheet showed distances
  from the rider's position. It now says "Choose where to start".
- Found: a coarse first fix (a network position hundreds of metres out) would set the start offer. The gate now
  waits for a fix within the engine's 80 m limit; e2e starts at 600 m accuracy and sees no offer until 8 m.
- Found: Nearby fetched the site's places.json with `fetch`, which the Android WebView refuses (the app's pages are
  on https://localhost and the site sends no cross-origin headers). The phone always fell back to the places in the
  APK, so a new route's places would never have arrived. Site requests from the app now go through native HTTP
  (`src/native/site.ts`); a test makes `fetch` refuse cross-origin URLs as the WebView does. The route store already
  used native HTTP.
- Found: an update's cost was worked out only when its download began, so on mobile data the card offered it at the
  size of the whole route. The store now reads the site's manifest when it first sees an update. Test 13b asserts
  the cost and the transfer total (it asserted neither).
- Found: the ride notice is ongoing; if Android kills the app mid-ride it would stay on the lock screen. The app
  clears it at launch (no ride runs then).
- Found: Back on Nearby with a story playing left the screen. It now stops the story first.

Rider's seat (screenshots of every new state, light and dark, 390 by 844):

- Nearby: about 30 numbered markers piled up near Monument. The map now shows the nearest 12; the list keeps every
  place within 3 km.
- Nearby: a passing-by place is named after its story, so the title showed twice. The repeat is hidden.
- The Recordings sheet looked see-through in one screenshot: the open animation caught mid-fade. Settled, it is
  opaque.

## Round 2

- `npm run check`: 371 unit tests pass, build clean. Full e2e: 48 of 48.
- The Android build passes on CI from the branch (run 45060874019) with the three new plugins.
- Nothing new found on the web. What is left can only be found on a phone.

## Phone checks (Evgeny)

1. Install the test APK over the current app. Home: both routes are there, nothing to download.
2. Routes on Wi-Fi: once a third route or a changed story is on the site, opening the app on Wi-Fi brings it in by
   itself; on mobile data the card offers Download with its size. Play a downloaded story and skip back in it
   (seeking in a file the app downloaded).
3. Start a ride away from stop 1: the sheet asks where to start; Back to the routes works.
4. Turns: the map zooms in on each junction and back out after.
5. Lock screen: allow notifications; with the screen off the next turn and distance show and update; ending the ride
   removes it.
6. Nearby places: the list and map around you; Play; "Play when I get there".
7. Pocket alerts: switch on "Tell me when I pass a place", lock the phone, walk past a place: one notification; tap
   it and the story plays. Battery after an hour.
8. After a real ride: Sound and settings, then Ride recordings, then Save file: send it to Claude, and it becomes a
   replay test.

## Open

- Everything Android-only needs a phone: downloads and updates on Wi-Fi, audio seeking in a downloaded route
  (served from the app's data folder), the lock screen notice, pocket alerts, battery. See the phone check list.
- Places shared by two routes appear twice; merging is for later.
- The map offline on the phone (Evgeny: not now).
