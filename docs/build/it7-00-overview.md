# Iteration 7: a main menu, a tutorial, sound that stops, tap to move on (spec)

Status: asked for by Evgeny late on 22 November 2026, scope settled on 23 November. Briefs `it7-31` to `it7-34`.
Built on 23 November: all four tasks merged, two review rounds (`iteration-7-rounds.md`). Waiting on the phone checks.

## What Evgeny asked for

- A proper main menu: settings, the list of rides, and so on.
- A tutorial in that menu that walks people through the features, interactively.
- Sounds do not stop when you go back; they hang on and keep playing in many situations. Clean it up.
- When a story shows a series of phrases, tap to go to the next one.

His choices (23 November), each the recommended option:

1. The app opens on a menu: Continue ride (when one is saved), Routes, Nearby places, Settings, Tutorial, About.
2. The tutorial is a practice ride with sound on the real ride screens. One part lights up at a time with a small
   card (tiny picture, title, one line). You hear a real turn and a real story and try the controls yourself.
3. Back (the phone's and the one on screen) stops a story; its music and soundscape fade within 2 s. A separate Map
   button keeps it playing over the map, with Stop in the bar at the bottom.
4. Tap the right two thirds of a story for the next paragraph, the left third to go back one. The voice jumps with
   the text. The same in route stories, Nearby and the tutorial.

## What is wrong or missing today (traced in the code)

- Home is the route list (`src/ui/Home.tsx`). Settings exist only as the ride's "Sound and settings" sheet
  (`SoundSheet.tsx`, from the dock): nothing can be set before a ride. Sound check, Ride recordings, the Android link
  and Simulate a ride are links in Home's footer.
- No tutorial.
- Sound outlives what the rider did (`src/story/director.ts`, `src/audio/`, `src/ui/back.ts`):
  - Back on a story (`closeTopOverlay`) and "Back to map" only hide the scene; voice, soundscape and music carry on.
  - After "Back to map" at a stop, the stop sheet (z 30) covers the dock, so the mini bar, the only control of the
    playing story, is hidden. The mini bar has no Stop anyway.
  - "Close story" (`skip` with nothing queued) plays the close signal, then the soundscape and music linger 20 s
    and fade over 6 s: 26 s of sound after the rider closed it.
  - Pause silences only the voice; the soundscape and music play on.
  - An arrival that starts no story plays the stop's soundscape for 30 s, then fades over 6 s.
  - A story's effects (up to 6.5 s) are not stopped with it.
  - The Sound check over a ride pauses a story but not a passing-by story, and stops the ride's bed behind the
    director's back, so the bed never comes back on Resume.
  - Nothing checks that a sound ends when what started it closes. A disposed mixer logs no `off` on its timeline.
  - No mixer is ever left undisposed: every screen that makes one disposes it on close. The fault is policy and
    controls, not a missing dispose; the hunt below keeps it that way.
- A story shows one paragraph at a time with ticks like phone stories (`Scene.tsx`), but only a story read by
  tapping can be moved on; a recorded one only follows the voice.

## Design

### 1. The menu and its pages (task 31)

- A page stack on the home side: menu, routes, settings, about (`src/ui/uistate.ts`). Nearby, Sound check, Ride
  recordings and the first-ride sheet stay overlays over whatever page shows. A ride leaves the stack alone, so ending
  one returns to the page it was started from.
- Menu: the header as today, a Continue card when a ride is saved, then one row each for Routes, Nearby places,
  Settings, Tutorial ("2 min", a pulsing dot until opened once) and About. Rows are big buttons with an icon, a title
  and one line.
- Routes: today's route cards, unchanged in behaviour. Settings: today's sound sheet content as a page, the same body
  as the ride's sheet. About: what Versta is, privacy, credits, the Android app link, Simulate a ride.
- Every page but the menu has a Back button at the top left. `?page=routes|settings|about` opens a page at start.

### 2. Sound that stops (task 32 engine, task 33 controls)

The policy:

1. Every sound belongs to what started it: a story, a passing-by story, a turn, an arrival, the Sound check, Nearby,
   the tutorial. When the rider stops or leaves it, its sound stops: voice in 0.15 s, soundscape and music within
   1.5 s, effects within 0.3 s.
2. A stop the rider asks for is silent: no close signal, no linger.
3. Only a story that ends by itself gets the close signal; its bed then lingers 8 s and fades over 4 s (was 20 + 6).
4. An arrival that starts no story: the stop's soundscape for 15 s, then a 4 s fade (was 30 + 6).
5. Pause fades the soundscape, music and effects with the voice; Resume brings them back.
6. Turn instructions already queued are never cut by the rider's stop.
7. Every sound that plays has a stop on screen, and the phone's Back stops it.
8. Riding away from a stop still lets its story play on (Stop is in the mini bar); the bed fades over 4 s as now.

Story controls: the scene gets Back (top left: stops the story) and Map (top right: keeps it playing, closes the stop
sheet so the map and the mini bar show). The mini bar gets Stop. Every mixer registers in a live list with its owner;
`window.__verstaSound.live()` shows what each is sounding, and a disposed mixer closes its timeline with `off`s.

Back, top-most first: the tour, the start choice, the first-ride sheet, Ride recordings, Sound check, a story scene
(stops the story), Nearby (stops its story, then closes), the logbook (hides it), the sound sheet, the stops list,
the stop sheet, a story or passing-by story still playing (stops it), a page (back to the menu). Then, in the Android
app, the ride screen stays and the menu goes to the background, as today.

### 3. Tap to move on (task 32 engine, task 33 screens)

`Director.stepPara(+1 | -1)`: the voice jumps to the start of the next or previous paragraph (`Mixer.seekVoiceTo`),
the text follows. +1 on the last paragraph does what the second button does (next story, or close). -1 on the first
restarts it. Effects of paragraphs jumped over never sound. The scene's text area takes the taps: the left third goes
back, the rest goes on. Nearby's story panel does the same with its own mixer.

### 4. The tutorial (task 34)

A spotlight tour of a practice ride: `startPractice(pack)` in `src/ride.ts` (done) runs the real ride screen,
director and mixer with no position source; the tour hands it nav states and events, so the turn is spoken, the
arrival rings and the story plays exactly as on a ride. Simulated, so nothing is saved, recorded or notified, and a
saved ride is never touched. Eight steps: the turn banner, the map buttons, the dock, tap to move on, the story
controls, Map, the mini bar, a passing-by story. Closing at any point ends the practice ride and every sound with it.

## Contracts (master, done before wave 1)

- `src/types.ts`: `Director.stepPara?`, new docs for `togglePause`, `skip`, `stopAll`; `Mixer.seekVoiceTo?`,
  `Mixer.stopEffects?`, `dispose` doc; `MixerOptions.owner`, `MixerOwner`, `LiveMixer`.
- `src/state.ts`: `practice`.
- `src/ride.ts`: `startPractice`, `Practice`, one event path for rides and practice (`deliver`); `endRide` never
  forgets the saved ride for a practice ride; `rideStartedAt` is null during practice; the ride's mixer is owned
  "ride".
- `src/tour/index.ts` and `src/tour/Tour.tsx`: stubs with the interface task 31 calls (`tutorialSeen`, `tourActive`,
  `startTutorial`, `endTutorial`, `Tour`). `src/styles/menu.css` and `tour.css`, imported by `main.tsx`.

## Tasks

| No. | Task | Wave |
| --- | --- | --- |
| 31 | The main menu, its pages and Back | 1 |
| 32 | Sound that stops, and paragraph steps (mixer, director) | 1 |
| 33 | Story controls: Back and Map, tap to move on, Stop in the mini bar, Sound check and Nearby | 1 |
| 34 | The tutorial: tour engine and the practice ride | 2 (after 31 to 33) |

## Acceptance

- `npm run check` and the full e2e suite pass.
- Dead-end hunt, new class "sound that outlives its owner": for every way out (scene Back, Close story, mini Stop,
  aside Stop, End ride, the phone's Back at each level, closing Nearby, Sound check and the tutorial at every step),
  within 2 s nothing is sounding but queued turn speech, and no mixer is live but the ride's (during a ride).
  Unit level on the virtual mixer, e2e on real audio in headless Chromium.
- Tap through a whole story: every paragraph reached, the voice at each mark, no burst of effects, the last tap
  closes it. A paused story stays paused.
- Tutorial: every step lights its part with the card on screen at 360 by 740, 390 by 844, 412 by 915 and 768 by
  1024, light and dark; Next and Previous through it all; leaving at any step leaves nothing sounding.
- Rider's seat: every new screen and state at phone size, light and dark, every line read in place.

## Not in this iteration

- Browser history for pages: on the web the system back gesture still leaves the site from any page, as it does from
  Nearby today. The Android app's Back is handled.
- A tour of the menu pages themselves.

## Rules for every executor

- Work only in your owned paths (your brief lists them). Never edit `src/types.ts`, `src/state.ts`, `src/ride.ts`,
  `CLAUDE.md`, `package.json`, `vite.config.ts`, `playwright.config.ts` or another task's paths. If a contract is
  wrong or missing something, build the closest thing and report it under "Contract issues".
- You are in your own git worktree. First `git merge --no-edit claude/funny-clarke-2ev6f1` (the master's working
  branch) so you have the contracts, then `ln -s /home/user/versta/node_modules node_modules` if it is missing. Use
  absolute paths inside your worktree.
- Other wave 1 tasks' work is not in your worktree. Build against the contracts and test your part alone.
- e2e in this container: `npm run build`, then `CHROME_PATH=/opt/pw-browsers/chromium E2E_PORT=<your port> npx
  playwright test <files> --trace off`. Ports: task 31 4181, task 32 4182, task 33 4183, task 34 4184. Headless
  Chromium plays real audio to a null sink, so the mixer timeline (`window.__versta.timeline()`) is real.
- Before reporting: `npm run check` (typecheck, lint, unit tests, build) passes, and the e2e files you touched pass.
- Commit on your branch with `git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit`, a plain
  message, ending with these two lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Up67uvLBquDwLprxpu8n4X`
- Report: branch, commit hash, worktree path, what you built, how you tested it, screenshots (paths), what you could
  not verify, contract issues. Be factual and short.
- House rules (CLAUDE.md): no em dashes or en dashes anywhere (code, comments, copy, commit messages); UI copy plain
  and short, buttons say exactly what happens, no exclamation marks; every colour from `src/styles/tokens.css`, the
  story scene always dark; touch targets at least 48 px.
