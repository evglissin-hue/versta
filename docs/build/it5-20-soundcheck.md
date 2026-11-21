# Task 20: the Sound check screen

Owned paths: `src/ui/SoundCheck.tsx` (new), `src/ui/SoundSheet.tsx` (one button), `src/ui/Home.tsx` (one footer
link), `src/ui/uistate.ts` (one signal), `src/ui/back.ts` (one line), `src/app.tsx` and `src/ui/Ride.tsx` (render the
screen), `src/ui/Demo.tsx` (a demo step for screenshots), `src/styles/app.css`, `tests/e2e/smoke.spec.ts`.
Starts after task 15 is merged. Tasks 16 and 17 may land later: read names from `src/audio/catalogue.json` and
credits with `import.meta.glob("../audio/credits-*.json", { eager: true })` so missing files are no error.

Read first: `docs/build/it5-00-audio.md` section 8, `CLAUDE.md` rules (copy, tokens, 48 px targets, dark scene),
`src/ui/SoundSheet.tsx`, `src/ui/Sheet.tsx`, `src/styles/tokens.css`, the `Mixer` contract in `src/types.ts`.

## Goal

One screen where Evgeny can hear every soundscape, music theme, signal and effect, alone or under the narrator,
before a ride, and swap or drop what he does not like. It also carries the sound credits, which CC BY requires.

## Decisions

- Reached from "Sound and settings" (during a ride) by a button "Sound check", and from the Home footer by a link
  "Sound check", so it works before any ride. A `soundCheckOpen` signal in `uistate.ts`; Back (`back.ts`) and a
  "Close" button close it. It is a full-height sheet over whatever is under it.
- Its own mixer: on the first Play tap create `createMixer({ baseUrl: <first pack's base>, virtual: false })` and
  `await unlock()` inside that tap; `dispose()` it on close. If a ride is running (`currentDirector()`,
  `currentMixer()` from `src/ride.ts`), on open pause a playing story (`togglePause()` when it is playing and not
  paused) and fade the ride's bed (`currentMixer()?.stopBed(0.5)`); on close resume nothing (the rider taps Resume).
- Sections, in this order, each a list of rows (label from the catalogue, name in small type, one Play button per
  row that becomes Stop while it sounds):
  - Soundscapes (23): `startBed(name, null)`. One soundscape at a time: playing another replaces it.
  - Music (6): `startBed(null, theme)`; playing a soundscape and a theme together is allowed (one of each), which is
    how they meet on a ride: when both are chosen call `startBed(ambience, theme)`.
  - Signals (4): `signal(name)`; the row shows Stop until it resolves.
  - Effects (21): `playEffect(name)`; Stop is not needed, the row shows "Playing" for the catalogue length.
- A switch "With the narrator", hint "Plays a story over the sound, as on a ride.": while on, a story clip plays in a
  loop through `playVoice` (with its `breaks`): `thames-loop` story `tower-bridge-0` from that pack's `pack.json`
  (fetch it), so what you hear is the real mixer with its pocket. Off stops it with its fade.
- A "Stop all" button at the top while anything plays.
- Credits at the bottom: "Sound credits", one line per file: title, author, licence, a link "Source" to the page.
  Group music and sounds. Plain text, small.
- Copy: plain and short, no exclamation marks, no dashes. Buttons say what happens ("Play", "Stop", "Close").
- Look: colours only from `tokens.css`, light and dark themes both, rows at least 48 px high, Play buttons at least
  48 by 48 px, readable at phone width (390 px) in sunlight.
- `Demo.tsx`: a step `soundcheck` (`?demo=ride&step=soundcheck`) that opens it, for screenshots.

## Acceptance checks

1. `tests/e2e/smoke.spec.ts`: from Home, "Sound check" opens the screen; it lists 23 soundscapes, 6 themes, 4 signals
   and 21 effects, each with a Play button; "With the narrator" toggles; Close returns to Home; Back closes it.
   Tapping Play on one soundscape and one effect raises no page error (headless audio is fine).
2. From a simulated ride: Sound, then Sound check, opens it; closing it returns to the ride with the story paused.
3. Screenshots at 390 by 844 in light and dark (`colorScheme`), attached to the report as files in the scratchpad.
4. `npm run check` passes and `npx playwright test tests/e2e/smoke.spec.ts` passes.
