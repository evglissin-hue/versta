# Task 12: the polishing pass

Owned paths: `src/app.tsx`, `src/ui/**` except `src/ui/back.ts`, `src/styles/**`, `src/offline.ts`,
`tests/e2e/smoke.spec.ts`. Runs after task 10 is merged: start from the current `main`.

## Goal

Small things, done properly. A first-time rider should never wonder what is happening or what to press.

## Decisions

1. Before the first ride. Tapping Ride for the first time on a device shows one short sheet before any browser
   prompt: "Versta follows your ride by GPS and talks to you as you go." with three lines (allow location when
   asked; turn the volume up, earphones are best; keep the screen on, or use the Android app for the pocket) and one
   button "Start the ride". Remembered in localStorage; never shown again.
2. Loading and failure. Starting a ride shows "Loading the route" on the button until the pack is in; a failed load
   says "Could not load the route. Check your connection and try again." with a Try again button. With no network
   and no saved pack, the card says so before the rider taps Ride.
3. Sheets and scene move. Sheets slide up over 180 ms and fade their backdrop; the scene fades in over 250 ms; the
   aside card slides in from below. Respect `prefers-reduced-motion`. Buttons get a pressed state.
4. Go back 15 seconds. The story scene and the mini bar get a "Back 15 s" button calling `director.rewind?.(15)`.
   Hide it in read-by-tapping mode or when the director has no `rewind`.
5. Time left. The scene shows the time left in the story (from `story.audio.dur` and the paragraph marks: estimate
   by paragraph), as "3 min left", "under a minute left".
6. Sound sheet, regrouped under three headings: Voices (story voice, turn instructions), Atmosphere (soundscape,
   music, and a three-way "Soundscape level": Soft, Balanced, Rich, bound to `settings.bedLevel`), Riding (passing-by
   stories Off, Sparse, Rich; start stories on arrival; keep the screen awake; course up; recentre by itself;
   vibrate at turns). One line of plain explanation under each.
7. Stops list. Show each stop's distance along the route from the start and, for stops ahead, the time to it at the
   current average speed; mark pint stops; show which stories at each stop are heard (small filled or hollow dots).
8. Home. Under the route card's blurb, one line of what is inside: "13 stops, 18 stories, 21 passing-by stories,
   about 40 min of listening" computed from the pack index (add the counts and minutes to `public/packs/index.json`
   by hand for the Thames Loop; the pack tools are not yours). An "Android app" line in the footer linking to the
   releases page `https://github.com/evglissin-hue/versta/releases/tag/android-latest`, hidden inside the app.
9. Finish. Add the average speed and the number of passing-by stories heard to the logbook.
10. Read every line of copy in the app once more, in place, light and dark. Fix anything vague, clipped,
    inconsistent in capitalisation, or longer than it needs to be. List what you changed.

## Acceptance checks

- Demo steps for: first-ride sheet, loading, load failure, scene with Back 15 s and time left, the regrouped sound
  sheet, the stops list with times and dots, the finish with the new stats. Screenshots at 390 by 844, light and
  dark, each looked at with the Read tool.
- Smoke tests for the first-ride sheet (shown once, then not), the sound sheet's soundscape level writing the
  setting, Back 15 s present with a recorded story and absent in read-by-tapping mode, and the existing size and
  overflow checks.
- `npm run check` passes. Own preview on port 4177.
