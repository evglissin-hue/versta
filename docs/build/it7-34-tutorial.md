# Task 34: the tutorial: a spotlight tour of a practice ride

Owned paths: `src/tour/` (the stubs `index.ts` and `Tour.tsx`, and new files: the engine, the steps, the pictures,
the practice script, unit tests beside them), `src/styles/tour.css`, `src/ui/Banner.tsx` (the Practice tag), new
`tests/e2e/tour.spec.ts`.

Not: `src/ride.ts` (use `startPractice`, `Practice`, `endRide`, `loadPack`, `currentDirector`), `src/types.ts`,
`src/state.ts`, and every other file in `src/ui` (if a target you need has no stable hook, report it).

Starts after tasks 31 to 33 are merged into the master's working branch.

Read first: `docs/build/it7-00-overview.md` (section 4, the executor rules), Evgeny's tutorial principles below,
`src/ride.ts` (`startPractice` and its doc), `src/tour/index.ts`, `src/ui/Demo.tsx` (how hand-made nav states look),
`src/story/director.ts` (what `handle` does with `cue`, `arrive`, `leave` and `aside` events, and why an aside can be
skipped), `src/ui/Scene.tsx`, `src/ui/Dock.tsx`, `src/ui/Menu.tsx`, `src/ui/icons.tsx`, `src/ui/back.ts`.

## Evgeny's tutorial principles (from his design guide)

A Tutorial button starts a spotlight tour: the page dims, one real part lights up, and a small card shows a tiny
animated picture, a title and one line. Tour the real page. Minimal text, very visual: a title of two to five words,
one line of explanation, one small looping animation that mimics what the part does. Five to eight steps, in the
order things happen. Findable, then quiet (task 31's dot). Read-only: the tour changes nothing it does not put back.
Steps whose part is absent drop out; reduced motion gets still pictures; it works on a phone and by keyboard. One
shared engine plus a list of steps. Pictures are small SVGs moved with CSS transforms, so nothing on the page shifts.
An automated run checks that every step lights the right part with the card on screen at several screen sizes.

## Decisions

### The engine (generic)

- A step: `{ id, target: () => Element | null, title, line, picture, enter?, waitMs?, interactive?, done? }`.
  `enter()` puts the practice ride into the state the step needs and is idempotent, so Next, Previous and coming back
  all work. `waitMs` is how long to wait for the target to appear (default 0). `interactive` lets taps on the lit part
  through (default false: it is only shown). `done()` true moves the tour on by itself after 600 ms.
- The overlay sits above everything (`z-index: 60`): a full-screen SVG that dims all but a rounded hole 8 px around
  the target, drawn with `fill-rule="evenodd"` so the dim part catches taps (they do nothing) and the hole does not.
  On a step that is not interactive a transparent blocker covers the hole. The hole follows its target while the
  step shows (a `requestAnimationFrame` loop is fine) and eases 200 ms between steps (no easing under reduced
  motion).
- The card: above or below the hole, whichever side has more room, never over it, 16 px from the screen edges, full
  width at phone size and at most 420 px wide. In it: the picture (64 by 48), "3 of 8" (the label style), the title
  (display face, 24 px), the line (body face, 18 px), and Previous (from the second step), Next (Done on the last)
  and Close (top right). All 48 px. Light and dark from the tokens.
- A step whose target is not there after `waitMs` drops out, and "N of M" counts without it.
- Keyboard: focus goes to the card; Right or Enter is Next, Left is Previous, Escape is Close. The phone's Back
  calls `endTutorial()` (task 31's `back.ts`).
- Reduced motion: pictures stand still (their first frame), no easing.
- Read-only: the tour saves nothing but `versta:tutorial = "1"` (set as it opens; `tutorialSeen` goes true). Settings
  changed during it (the follow button flips course up) are put back when it closes.
- When the app is hidden mid-tour: `currentDirector()?.stopAll()`; when it is shown again, run the step's `enter()`
  again.
- `tourActive` is true from the intro card to the end card.

### The practice ride (the steps)

- The route: `thames-loop` when the index has it (it is built into the Android app), else the first route. The intro
  card's Start tap does `loadPack(id)` then `startPractice(pack)` (the tap unlocks audio). If the route cannot load,
  the card says "The practice ride needs a route. Connect and try again." with Close.
- From the route pick: stop `k`, the first stop from 1 whose first core story has audio and at least 3 paragraphs,
  and whose leg (segment `k`) has a spoken turn (left, right, slight or sharp; with audio; not quiet); the cue, the
  first such turn on segment `k`; the aside, the first aside with audio on segment `k + 1`, else any with audio (and
  another unheard one when the step is entered again).
- Nav states, made by hand like `Demo.tsx`: before the turn (riding, segment `k`, the rider 150 m before the cue
  along the segment, `toCue` 150, `speedAvg` 4.5, stops before `k` arrived, distances worked out from the segments);
  at the stop (`at_stop`, segment `k`, the fix at the stop, stops up to `k` arrived); after the stop (riding, segment
  `k + 1`, `toStop` over 150 m, no next cue).
- The intro card (no target, centred): picture of a speaker with sound arcs; "A practice ride"; "You hear a real
  turn and a real story. Nothing is saved. Turn the sound up."; buttons Start and Not now.
- The steps:

| # | Target | Title | Line | Enter, and when it is done |
| --- | --- | --- | --- | --- |
| 1 | the banner (`banner`) | The next turn | Spoken before you reach it. Tap the banner to see the turn. | Feed the before-turn state with the cue's `approach` event: the director says "In 150 metres, turn left onto ...". Interactive. |
| 2 | the map buttons (`map-controls`) | Map buttons | The arrow keeps the map on you. The line shows the whole route. | Interactive. |
| 3 | the dock (the `Ride controls` region) | Where you are heading | The next stop, how far and how long. End ride stops it all. | Not interactive. |
| 4 | the story text (`scene-tap`), wait up to 8 s | Tap to move on | Tap the right of the story for the next part, the left to go back. | Feed the at-stop state with the `arrive` event: the chime, "Arriving at", the soundscape, then the story after 3 s. Interactive; done when the paragraph has moved on. |
| 5 | the story's foot (`scene-foot`) | Pause or close | Pause holds the voice and the music. Back 15 s repeats the last words. | The story playing with the scene open (`playStory` if not). Interactive. |
| 6 | the Map button (`scene-map`) | Listen with the map | Map keeps the story playing. Back stops it. | As 5. Interactive; done when the scene is hidden. |
| 7 | the mini bar (`mini-bar`) | The story goes on | Pause it, stop it, or open it again here. | The story playing with the scene hidden and the stop sheet closed. Interactive. |
| 8 | the passing-by card (`aside-card`), wait up to 6 s | Passing by | A short story as you pass something. Stop ends it. | `stopAll`, feed the after-stop state with a `leave` event, `skipAhead` 10 minutes, then the `aside` event; if the director logs `aside_skipped`, try again each second for 5 s. Interactive. |

- The end card (centred): picture of a flag; "Ready to ride"; "Pick a route, or come back to this from the menu.";
  buttons Choose a route (ends the practice ride and opens Routes: `openPage("routes")`) and Back to the menu.
- Closing at any point (Close, Escape, the phone's Back, Done, End ride in the dock): `endRide()` ends the practice
  ride, which disposes its mixer: every sound stops. The tour also ends by itself when the practice ride ends
  (`practice` goes false). If the tour is closed while `loadPack` or `startPractice` is still pending (Close straight
  after Start), end the practice ride the moment it resolves, so no ride screen is left without its tour.
- `Banner.tsx`: the tag reads "Practice" when `practice` is true, else "Simulated" as now.

### Pictures

One small SVG per step, stroked like the menu icons (`src/ui/icons.tsx`) in ink with the mark colour for the moving
part, animated with CSS transforms and opacity only, loops of 2 to 3 s: an arrow bending with a distance ticking down
(1), a map arrow recentring (2), a progress bar filling (3), a finger tapping the right of a text block as the ticks
move on (4), a pause sign (5), a story card sliding down into a bar (6), the bar with a stop square (7), a marker
passing with three sound arcs (8), a speaker with arcs (intro), a flag (end).

## Acceptance checks

1. e2e `tour.spec.ts` (on `?virtual=1`, so the practice mixer is virtual and timing steady): open the tour from the
   menu and press Next through every step at 360 by 740, 390 by 844, 412 by 915 and 768 by 1024, light and dark. At
   each step the hole's box contains the target's box, the card is wholly on screen and does not overlap the hole,
   and there are no console errors.
2. The sound is real: the turn step puts the cue's clip on the timeline (`window.__versta.timeline()`); the arrive
   step the `arrive` signal and a story voice; a right tap on the story moves the paragraph and the voice's position
   to the next mark; Map hides the scene; the aside step puts the aside's clip on the timeline.
3. Closing at every step (Close, Escape, and a `versta:back` event): within 2 s `window.__verstaSound.live()` lists
   no mixer, the menu shows, and a saved ride set in `versta:ride` before the tour is still there after it.
4. The menu's dot is gone after the tour has opened once.
5. Unit: the step picker on both packs (it finds a stop, a cue and an aside), and the card placement (never over the
   hole, always on screen) on made-up boxes.
6. Screenshots of every step at 390 by 844, light and dark. `npm run check` passes.
