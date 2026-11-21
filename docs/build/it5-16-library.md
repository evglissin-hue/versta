# Task 16: a real sound library

Owned paths: `tools/sound/**` (except `check-mix.mjs` and `find_breaks.py`), `public/sounds/*.mp3`,
`public/sounds/fx/**`, `public/sounds/signals/aside.mp3`, `src/audio/soundscapes.ts`, `src/audio/credits-sounds.json`
(new), `docs/sound-credits.md`, `tests/unit/sounds.test.ts` (new), and in `src/audio/catalogue.json` only the
`seconds` of the effects and of the `aside` signal.
Not yours: `public/sounds/music/**` and `public/sounds/signals/{arrive,close,finish}.mp3` (task 17), the mixer files.

Read first: `docs/build/it5-00-audio.md` sections 4 and 7, `docs/sound-credits.md`, `tools/sound/build_sounds.py`,
`src/audio/soundscapes.ts`, `src/audio/catalogue.json`.

## Goal

Replace every synthesised layer with a recording, lengthen the staples, add what the two routes lack, give Royal
Docks its own soundscapes, and record the one-shots the stories and signals need. Everything credited.

## Decisions

### Sources and licences

- Wikimedia Commons only: there is no Freesound token for this session. Commons mirrors many Freesound uploads.
- Allowed: CC0, public domain, CC BY (any version). Not allowed: CC BY-SA, any NC or ND, GFDL, "attribution required"
  without a CC BY tag, anything unclear. Read `LicenseShortName` and `Artist` from `extmetadata`; keep the page URL.
- Commons rate limits: space API calls at least 2 s apart, downloads at least 5 s apart, honour `retry-after` on 429,
  User-Agent `Versta/0.3 (sound library build)` (no personal details). Search with
  `list=search&srnamespace=6&srsearch=filetype:audio <words>`, and also read likely categories
  (`Category:Audio files of ...`). Listen-free judgement: use the description, duration, sample rate and the
  measured levels; prefer field recordings over sound design, 44.1 or 48 kHz, no voices you can make out, no music.
- Raw downloads go in a scratch folder outside the repo (default `/tmp/versta-sound-raw`), never in the repo.

### What to find

Loops (mono, 64 kbps, about -26 LUFS integrated, high-pass 60 Hz unless the brief for that sound says otherwise):

| Need | Used by | Length |
| --- | --- | --- |
| water (a wider river than now: the Thames is tidal and broad) | river, solemn, canal | 60 to 90 s |
| shore, wharf, wind, gulls, murmur | several | 60 to 90 s each |
| lapping at a dock wall | dock, basin, wharf | 45 to 60 s |
| wood and rope creaking (a moored wooden ship) | ship, wharf, sail, arctic | 45 to 60 s |
| sails and rigging in wind | sail, ship | 45 to 60 s |
| ice and Arctic wind (ice creaking, floes) | arctic | 45 to 60 s |
| shipyard hammering on timber, a working yard | yard | 45 to 60 s |
| dripping in a tunnel, with its echo | tunnel | 30 to 45 s |
| tunnel air and footsteps in a tiled tunnel | tunnel | 30 to 45 s |
| pub clatter: glasses, voices you cannot make out | tavern | 45 to 60 s |
| a quiet church interior (room tone, distant footsteps) | solemn | 30 to 45 s |
| a working dock: cranes, chains, distant machinery | working-dock, yard | 45 to 60 s |
| birdsong in a city garden or park (blackbird, robin) | burial, park, towpath | 45 to 60 s |
| a big crowd outdoors, murmur without words | rally | 45 to 60 s |
| horses and carts on cobbles | oldstreet, sailortown | 45 to 60 s |
| a mill race or weir, rushing water | mill | 30 to 45 s |
| deep machinery hum (engine room, pumps) | pumping | 30 to 45 s |
| an office of old: a wall clock, a distant typewriter | office | 30 to 45 s |
| wading birds on mud (curlew, redshank) | basin | 30 to 45 s |
| tick, bells | clock, solemn, sailortown | keep or improve |

One-shots, `public/sounds/fx/<name>.mp3`, mono, peak under -3 dBFS, about -27 LUFS over the sounding part, a short fade
at both ends, no silence longer than 0.2 s at the start: every effect in `catalogue.json` (`ship-horn`, `steam-engine`,
`sail-flap`, `ice-creak`, `hammer`, `adze`, `tankards`, `oars`, `distant-cannon`, `chain`, `water-lap`, `crowd`,
`parrots`, `big-bell`, `fire-crackle`, `telegraph`, `crates`, `waders`, `water-wheel`, `bubbling`, `water-flow`).
Length within half of the catalogue `seconds` either way; then write the real length (one decimal) back into
`catalogue.json`. Nothing that could be mistaken for traffic: no car or lorry horns, sirens, bicycle bells, engines
that sound like a motorbike. `distant-cannon` must be far off and muffled, never a close bang.

Signal, `public/sounds/signals/aside.mp3`: a real ship's bell, two strokes ("two bells"), ringing out, 2.5 to 3.5 s,
mono, peak under -6 dBFS, about -24 LUFS. Update the `aside` `seconds` in the catalogue to its real length.

If a sound cannot be found under the licences above after a fair search, say so in the report and leave the
generated layer for it as the primary; do not lower the licence bar.

### Budget

- `public/sounds/` excluding `music/` and task 17's three signals: at most 8.5 MB. Task 17 has 5 MB for music.
- So keep the secondary layers short (30 to 45 s) and reuse layers across recipes; the app starts each loop at a
  random point and layers several, which hides the length.

### Recipes (`src/audio/soundscapes.ts`)

- One recipe per soundscape in `catalogue.json` (23 names). Keep the existing 13 names and add `burial`, `office`,
  `rally`, `park`, `basin`, `working-dock`, `mill`, `pumping`, `towpath`, `oldstreet` (Royal Docks moves onto these in
  task 19). Each recipe is a few recorded layers: a steady base, one or two texture layers, and at most one sparse
  one-shot layer.
- Extend `Part`: `pan?: number` (-0.3 to 0.3, `StereoPannerNode`; never more, so one earbud never loses a layer), and
  a sparse one-shot layer `{ fx: "<effect name>", every: [min, max], level }` that plays `lib.get("fx/<name>")` at
  random intervals (use `every()` from `synth.ts`). Ship's horns at the river, gulls, a church bell now and then.
- Generated layers stay only as `gen` fallbacks for a recording that fails to load. Delete `buildMusic`, the chord
  tables and anything only the old music used. Keep `L` helpers that a fallback still uses.
- `loopsFor(name)` returns the loop names (and `fx/...` names of sparse layers) a recipe needs, so the bed and the
  offline saver can load them. Keep `allLoops()`.
- Mood of the recipes, from the stories they sit under: quiet enough to talk over, no sudden loud events (a sparse
  layer at least 6 dB under the base), nothing sharp in the 1 to 4 kHz band louder than the base.

### Tools

- `build_sounds.py`: `fetch`, `process`, `report` as now, plus `check` (exit 1 when any file breaks its limits:
  integrated loudness within 1.5 LU of its target, peak, length, mono, bitrate; print a table) and `credits` (writes
  `docs/sound-credits.md` from `src/audio/credits-sounds.json` and, when present, `src/audio/credits-music.json`).
- `sources.json` grows: per file `name`, `file` (Commons title), `kind` (`loop`, `fx`, `signal`), optional `start`,
  `length`, `highpass`, `lowpass`, `gain`. Process into `public/sounds/<name>.mp3`, `public/sounds/fx/<name>.mp3` or
  `public/sounds/signals/<name>.mp3`.
- `src/audio/credits-sounds.json`: `[{ "file": "sounds/fx/oars.mp3", "title": "...", "author": "...",
  "licence": "CC BY 4.0", "source": "https://commons.wikimedia.org/wiki/File:...", "cut": "12 s from 40 s" }]`, one
  per file. CC BY needs the author and licence shown in the app: task 20 shows this list.

### Tests (`tests/unit/sounds.test.ts`, no audio decoding, just files and data)

- Every loop and `fx/` name any recipe uses exists in `public/sounds/`; every catalogue effect has its file; the
  aside signal exists; every recipe name is in the catalogue and every catalogue soundscape has a recipe.
- Every `.mp3` under `public/sounds/` has exactly one credits entry across `credits-sounds.json` and
  `credits-music.json` (load both with `import.meta.glob(..., { eager: true })` so a missing music file is no error),
  and every credits licence is CC0, public domain or CC BY.
- Sizes: the budget above.

## Acceptance checks

1. `python3 tools/sound/build_sounds.py check` passes and its table is in the report.
2. `tests/unit/sounds.test.ts` passes; `npm run check` passes.
3. The report lists each new file: what it is, its source page, licence, and which recipes use it; and every sound
   that could not be found.
4. `docs/sound-credits.md` regenerated; the old "Still generated" section reduced to what is really still generated.
