# Task 33: story controls: Back and Map, tap to move on, Stop in the mini bar

Owned paths: `src/ui/Scene.tsx`, `src/ui/Dock.tsx`, `src/ui/AsideCard.tsx`, `src/ui/Ride.tsx` (only if needed),
`src/ui/Nearby.tsx` (its story panel and its mixer's owner), `src/ui/SoundCheck.tsx`, the scene, mini bar, dock,
aside and Nearby panel rules of `src/styles/app.css`, new `tests/e2e/story.spec.ts`, and in `tests/e2e/smoke.spec.ts`
only the tests that click "Back to map", the mini bar or the Sound check's effect on a ride.

Not: `src/ui/back.ts`, `Home.tsx`, `Demo.tsx` (task 31: use the demo steps that exist), `src/audio`, `src/story`
(task 32), `src/tour`, `src/types.ts`, `src/state.ts`, `src/ride.ts`.

Read first: `docs/build/it7-00-overview.md` (sections 2 and 3, the executor rules), the Director contract in
`src/types.ts` (new `stepPara`, and the docs of `togglePause`, `skip`, `stopAll`), `Mixer.seekVoiceTo`, `src/ui/Scene.tsx`,
`src/ui/Dock.tsx`, `src/ui/Ride.tsx`, `src/ui/Nearby.tsx`, `src/ui/SoundCheck.tsx`, `src/ui/uistate.ts` (`canRewind`).

Your worktree has the old director and mixer: `stepPara` and `seekVoiceTo` are absent there (the contract makes them
optional). Call them as `d?.stepPara?.(1)` and `mixer.seekVoiceTo?.(t)`. Task 32 builds them; the master tests the
real jumps after the merge. Test what you can: the demo, and stopping on a simulated ride.

## Goal

Back stops a story and Map keeps it playing over the map. A tap on the story text moves it on or back by a paragraph.
Every story that plays can be stopped from what is on screen.

## Decisions

### The story scene (`Scene.tsx`)

- Top bar: "Back" on the left (stops the story: `currentDirector()?.stopAll()`; in the demo, with no director,
  `nowPlaying.value = null`), the stop's label in the middle (may wrap to two lines), "Map" on the right
  (`sceneOpen.value = false` and `openStop.value = null`, so the map, the banner and the dock with the mini bar show).
  Both in the scene's button style, 48 px. testids `scene-back`, `scene-map`. "Back to map" goes.
- Tap to move on: the scene body (tags, title and text: everything between the top bar and the foot, full width)
  takes taps. A click in its left third calls `stepPara(-1)`, anywhere else `stepPara(+1)`. Use the click's
  `clientX` against the body's box; a handler on the body, not a layer over it, so a long paragraph still scrolls.
  The side tapped shows a chevron that fades over 300 ms (none under reduced motion). Keyboard: Right and Left
  arrows on the scene do the same. Screen readers: two visually hidden buttons in the body, "Next part" and
  "Previous part". testid `scene-tap` on the body.
- In the demo there is no director: the scene moves `nowPlaying.para` itself (+1 up to the last paragraph, -1 down to
  0), so the preview can be tried.
- Foot: unchanged (ticks, time left, Back 15 s, the main button, Next story or Close story), with testid
  `scene-foot`.

### The mini bar (`Dock.tsx`)

Two rows. First: the label "Story playing" and the title on one line with an ellipsis. Second: Back 15 s (when
`canRewind`), Pause or Resume (Next for a story read by tapping), Stop (`currentDirector()?.stopAll()`, testid
`mini-stop`), Open. Equal widths, 48 px tall, no overflow at 360 px wide.

### The passing-by card (`AsideCard.tsx`)

Stop stays (`stopAll`); add testid `aside-stop`.

### Nearby's story panel (`Nearby.tsx`)

- The same tap areas on the panel body: +1 and -1 paragraph. With marks, the voice jumps with
  `mixer.seekVoiceTo?.(max(0, marks[p] - 0.1))` and `para` follows; a paused story stays paused. +1 on the last
  paragraph does what Stop does; -1 on the first restarts it. A story with no marks (a passing-by text) has one
  paragraph: +1 stops it, -1 restarts it.
- The panel's top gets "Back" at the left (the same as Stop) beside the place's name. Pause and Stop stay at the
  bottom.
- Its mixer: `createMixer({ ..., owner: "nearby" })`.

### Sound check (`SoundCheck.tsx`)

- Its mixer: `owner: "soundcheck"`.
- Opened over a ride: pause a playing story (as now) and stop a passing-by story (`stopAll` when `nowPlaying` is an
  aside). Remove `currentMixer()?.stopBed(0.5)`: pausing now fades the ride's bed (task 32), and the bed comes back on
  Resume.
- When the app goes to the background (`visibilitychange` to hidden), stop everything the Sound check is playing.

### Copy and look

Labels exactly as above. The scene stays dark. 48 px targets. No dashes, no exclamation marks.

## Acceptance checks

1. e2e `story.spec.ts` on the demo: `?demo=ride&step=story`, a tap on the right of the text shows the next paragraph
   and a tick more, a tap on the left goes back; Right and Left arrows do the same; Map hides the scene and shows the
   mini bar with Stop; Back on the scene closes it (`nowPlaying` null); on `scene-hidden` the mini bar's four buttons
   are at least 48 px and fit at 360 px wide.
2. e2e on a simulated ride (`?sim=1&speed=5&scale=8&virtual=1`, wait for the first story at stop 1): the scene's Back
   ends the story and its voice (the timeline has the voice `off`); a second story started from the stop sheet, then
   Map, then the mini bar's Stop, does the same.
3. Nearby (geolocation near Tower Bridge, as the existing Nearby test): Play, a right tap moves the text on, Back on
   the panel stops it.
4. Every smoke test you touched passes. Screenshots at 390 by 844, light and dark: `story`, `scene-hidden`, `aside`,
   `story-manual`, `nearby-playing`.
5. `npm run check` passes.
