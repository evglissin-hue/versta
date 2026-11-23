# Task 31: the main menu, its pages, and Back

Owned paths: `src/ui/Home.tsx` (becomes the page switch of the home side), new `src/ui/Menu.tsx`, `src/ui/Routes.tsx`,
`src/ui/SettingsPage.tsx`, `src/ui/About.tsx`, `src/ui/Settings.tsx` (the settings body both places share),
`src/ui/icons.tsx` (menu icons), `src/ui/SoundSheet.tsx`, `src/ui/uistate.ts` (the page stack), `src/ui/back.ts`,
`src/app.tsx`, `src/ui/Demo.tsx`, `src/styles/menu.css`, the `/* home */` section and the `.nb-entry` and `.foot` rules of
`src/styles/app.css`, `src/native/back.test.ts`, new `tests/e2e/menu.spec.ts`, and in `tests/e2e/smoke.spec.ts` and
`tests/e2e/ride.spec.ts` only the lines that start from Home (they must now open Routes first).

Not: `src/ride.ts`, `src/types.ts`, `src/state.ts`, `src/tour/*` (stubs: import them, do not edit), `Scene.tsx`,
`Dock.tsx`, `AsideCard.tsx`, `Nearby.tsx`, `SoundCheck.tsx` and the scene, mini bar and aside rules of `app.css`
(task 33), `src/audio`, `src/story` (task 32).

Read first: `docs/build/it7-00-overview.md` (sections 1 and 2, the executor rules), CLAUDE.md, `src/ui/Home.tsx`,
`src/ui/SoundSheet.tsx`, `src/ui/back.ts`, `src/native/index.ts` (`handleBack`), `src/app.tsx`, `src/ui/Demo.tsx`,
`src/tour/index.ts`, `src/ride.ts` (`savedRide`, `loadPack`, `startRide`, `endRide`, `currentDirector`),
`src/ui/MapControls.tsx` (the icon drawing style), `tests/e2e/smoke.spec.ts`.

## Goal

The app opens on a menu. From it: the routes, Nearby places, Settings (reachable before a ride for the first time),
the tutorial and About. Every page has a way back, and the phone's Back walks back through everything in order.

## Decisions

### Pages

- `uistate.ts`: `export type Page = "menu" | "routes" | "settings" | "about"`, `export const pages =
  signal<Page[]>(["menu"])`, `openPage(p)` pushes (no-op when `p` is already on top), `backPage(): boolean` pops and
  returns false on the menu. The top page shows.
- Nearby, Sound check, Ride recordings and the first-ride sheet stay overlays opened by their signals, over whatever
  page shows. A ride does not touch the stack, so ending a ride returns to the page it started from.
- At start, `?page=routes`, `?page=settings` or `?page=about` gives `pages = ["menu", that page]`. Tests use it.
- `Home.tsx` renders the top page (Menu, Routes, SettingsPage, About) and the FirstRide sheet (it serves Menu's
  Continue and Routes' Ride). Move the route cards and their logic (Card, Continue, UpdateLine, saving, `ride`,
  `requestRide`, FirstRide) into `Routes.tsx` unchanged in behaviour, exporting what Menu needs.
- Every page but the menu starts with a top bar: a "Back" button at the top left (ghost style, 48 px) and the page
  title (h2, the display face as sheet titles are now). Back pops to the menu.

### Menu (`Menu.tsx`)

- Header as Home's today: VERSTA, "Rides and walks that tell you their stories as you pass.", the rule under it.
- Continue card, only when `savedRide()` is set: a big "Continue ride" button (as `.btn.play.big`), and under it the
  route and where the rider got to, "Thames Loop. You reached 05 Deptford & the Tsar." (reuse Home's reached-stop
  logic). While starting: "Loading the route" / "Starting the ride", disabled. On failure the same line and Try again
  as on the route card. No Start again here; it stays on the route card. testid `menu-continue`.
- Rows, in this order, each one big button:
  1. Routes. "Bike rides and walks, with their stories." Right side: the number of routes, once the index has loaded.
     testid `menu-routes`.
  2. Nearby places. "Stories of the places around you, off any route." Opens the Nearby overlay. testid
     `menu-nearby`.
  3. Settings. "Voices, soundscape, map and riding." testid `menu-settings`.
  4. Tutorial. "A practice ride with sound, step by step." Right side: "2 min", and while `tutorialSeen` is false a
     dot in the mark colour that pulses (a slow halo; still under reduced motion), testid `menu-dot`. Tapping calls
     `startTutorial()`. testid `menu-tutorial`.
  5. About. "Credits, privacy and the Android app." In the Android app: "Credits and privacy." testid `menu-about`.
- A row: min-height 72 px, full width, a 1 px line between rows and the 2 px ink rule above the first (as
  `.switchlist`); an icon on the left (32 px drawing in a 44 px box, ink), the title in the display face (24 px,
  uppercase, 700), the line under it in the body face (17 px, muted), and on the right the extra (count, "2 min")
  and a chevron. The whole row is the button.
- Icons (`icons.tsx`): one family, drawn like `MapControls`' Squiggle: `currentColor` strokes 2.4 wide, round caps and
  joins, 32 by 32 view box, no fills except small dots. Routes: the Squiggle itself (move it into `icons.tsx` and use
  it in both places). Nearby: a map pin with a small ring under it. Settings: three slider lines with knobs. Tutorial:
  a play triangle in a circle. About: a lowercase i in a circle. Chevron: a thin right angle.

### Routes (`Routes.tsx`)

Top bar "Back" and "Routes", then the route cards exactly as Home shows them today (every state: continue, saving,
downloads, failures, offline note). No footer.

### Settings (`Settings.tsx`, `SettingsPage.tsx`, `SoundSheet.tsx`)

- `Settings.tsx` exports `SettingsBody`: today's sound sheet content, same groups, rows, order, hints and testids
  (`bed-level`, `asides-pick`), including Sound check and Ride recordings under "Sounds".
- `SoundSheet.tsx`: the ride's sheet, title "Sound and settings", with `SettingsBody`.
- `SettingsPage.tsx`: top bar "Back" and "Settings", then `SettingsBody`.

### About (`About.tsx`)

Top bar "Back" and "About", then, in the body face:
- "Versta is the old Russian measure of road, a little over a kilometre. The app follows your ride by GPS, speaks the
  turns and tells the stories of the places as you pass."
- "Your progress and ride recordings stay on this device."
- The credits line from Home's footer, plus "Sound credits are in Sound check, under Settings."
- On the web only: the Android app line and link from Home's footer.
- The Simulate a ride link, or "Simulation is on" with Use real GPS, as in Home's footer.

### Back (`back.ts`)

`closeTopOverlay()` closes or stops the top-most thing and returns true, in this order:

1. `tourActive` → `endTutorial()`.
2. The start choice → `endRide(false)` (as now).
3. The first-ride sheet → close.
4. Ride recordings → close. 5. Sound check → close.
6. A story scene open with a story (`nowPlaying` story and `sceneOpen`) → `currentDirector()?.stopAll()`; with no
   director (the demo) set `nowPlaying.value = null`. This is the change: Back stops the story, it no longer hides it.
7. Nearby: a story playing → stop it (as now); else close.
8. The finish logbook showing (the condition in `Ride.tsx`: status finished, nothing playing, `finishOpen`, no stops
   list or sound sheet) → `finishOpen.value = false`.
9. The sound sheet → close. 10. The stops list → close. 11. The stop sheet → close.
12. A story (scene hidden) or a passing-by story still playing → `currentDirector()?.stopAll()`.
13. On the home side with more than the menu → `backPage()`.
14. Else false: `handleBack` keeps the ride screen and sends the menu to the background, as now.

### Demo (`Demo.tsx`)

`demoState` resets `pages`. The Home steps (`continue`, `first-ride`, `loading`, `load-failed`, `offline`, `routes`,
`routes-held`) show the Routes page (`["menu", "routes"]`); `nearby` and `nearby-playing` show Nearby over the menu.
New steps: `menu`, `menu-continue` (a saved ride as the `continue` step makes one), `menu-new` (`tutorialSeen` false),
`settings`, `about`. Add them to `DEMO_STEPS` and the home steps.

### Copy and look

Copy exactly as above. Plain, no dashes, no exclamation marks. Colours from tokens only, light and dark. 48 px
targets. The menu reads at a glance: Continue (when there) stands out first, then the rows.

## Acceptance checks

1. Unit: `openPage` and `backPage`; `closeTopOverlay` closes in the order above with each level set by hand.
2. e2e `menu.spec.ts`: the menu shows its rows in order; each row opens its page or overlay, and both the on-screen
   Back and a `versta:back` event (dispatch a cancelable `CustomEvent("versta:back")` on window) come back to the menu;
   Continue shows only with a saved ride and starts it (on `?sim=1&speed=5&scale=8&virtual=1`); a switch on the
   Settings page writes `versta:settings`; the dot shows until `versta:tutorial` is "1"; at 360 by 740 every button
   of the menu, Routes, Settings and About is at least 48 px tall and nothing scrolls sideways, light and dark.
3. The existing smoke and ride specs pass after opening Routes where they used to start from Home.
4. Screenshots at 390 by 844, light and dark: `menu`, `menu-continue`, `menu-new`, `routes`, `settings`, `about`.
5. `npm run check` passes.
