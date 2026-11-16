# Task 5: the mix

Owned paths: `src/audio/**`, `tests/unit/mixer.test.ts`, `public/sounds/**`, `docs/sound-credits.md`, `tools/sound/**`.

## Goal

Stories should sound like a produced piece: the narrator clear in front, and a living soundscape and music around the
voice, not silenced by it. Evgeny's words: think of the whole equaliser spectrum, where the voice takes only a part of
it, nicely mixed. On his ride he heard no sound effects under the voice at all. Find out why and fix it.

## Decisions

- Keep the `Mixer` contract exactly. Everything here is inside `src/audio`.
- Route both audio elements through Web Audio (`createMediaElementSource`) into buses: voice, nav, bed, then a master
  with a gentle limiter (`DynamicsCompressorNode`). If Web Audio is unavailable or the context will not start, fall
  back to playing the elements directly, as now.
- Voice chain: high-pass about 70 Hz, a little warmth around 200 Hz, a little presence around 3 kHz, light compression.
  Subtle. The narration files are already loudness-normalised to -16 LUFS.
- The pocket: the bed bus passes through a wide peaking cut centred about 1.5 kHz (Q about 0.6). An analyser on the
  voice and nav buses drives it: when speech is present the cut eases to about -10 dB and the whole bed drops about
  3 dB; in the gaps between sentences it eases back (attack about 80 ms, release about 600 ms). Lows (water, rumble)
  and highs (air, gulls) keep sounding around the voice. This replaces the old duck-to-half.
- Bed levels: the bed must be clearly audible on phone speakers and earbuds without masking the voice. Target the bed
  about 14 to 18 dB below the voice in the speech band while speech is present, and about 8 dB below when it is not.
- Recorded soundscapes: add support for looped recordings as bed layers next to the generated ones. A soundscape is
  now a recipe: zero or more recorded loops (`public/sounds/<name>.mp3`, decoded once and looped with a short
  crossfade) plus generated layers. Find recordings on Wikimedia Commons (the API is reachable from this machine with
  a descriptive User-Agent; pause between requests) that are CC0 or public domain only: river water lapping, harbour
  or seashore with gulls, wind, a wooden ship creaking, pub or tavern murmur, hammering or a workshop, dripping in a
  tunnel, a clock ticking, church or ship bells. For each: download, cut the cleanest 30 to 45 s, make it loop
  seamlessly, high-pass at 60 Hz, normalise to about -26 LUFS, mono, 64 kbps mp3. Keep the whole folder under 4 MB.
  Record source page, author and licence for every file in `docs/sound-credits.md`. You cannot listen, so check each
  file by measurement (duration, loudness, no clipping, no long silence, plausible spectrum) and say so in the report.
  Where no suitable recording exists, keep the generated layer for that sound. Put the fetch and processing script in
  `tools/sound/`.
- Music: keep it generated but make it musical: a slow modal pad that changes chord every 20 to 30 s, soft attack, a
  sparse plucked or reed-like line, different for `minor` and `bright`. It sits under the soundscape and is carved by
  the same pocket.
- `chime()` stays two bell strokes.
- Add a meter for development and tests: `window.__verstaAudio = { levels() }` returning the current RMS in dBFS of
  the voice bus and of the bed bus in three bands (below 250 Hz, 250 Hz to 4 kHz, above 4 kHz).

## Acceptance checks

- A Playwright script (keep it in `tools/sound/check-mix.mjs`) runs the production build in headless Chrome
  (`/usr/bin/google-chrome`, args `--no-sandbox --autoplay-policy=no-user-gesture-required`), starts a simulated ride
  with real audio (`/?sim=1&speed=5&scale=1`, tap Ride), and samples `levels()` for 30 s while the first story plays.
  It must show: the bed is audible the whole time (never below -55 dBFS overall while the story plays); while the
  voice speaks, the bed's middle band sits at least 8 dB under its own level in the gaps; the low and high bands move
  by no more than 5 dB. Print the numbers in your report. This is the proof that the bed plays under the voice.
- Unit tests for the virtual mixer still pass unchanged in behaviour.
- `npm run check` passes.
