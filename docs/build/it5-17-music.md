# Task 17: music, composed and rendered

Owned paths: `tools/music/**` (new), `public/sounds/music/*.mp3` (new), `public/sounds/signals/arrive.mp3`,
`close.mp3`, `finish.mp3` (new), `src/audio/credits-music.json` (new), and in `src/audio/catalogue.json` only the
`seconds` of the `arrive`, `close` and `finish` signals.

Read first: `docs/build/it5-00-audio.md` sections 5 and 7, `src/audio/catalogue.json`.

## Goal

Real music under the stories: six themes written as notes in the repo and rendered offline through a free sampled
soundfont into loops that sit under the narrator without competing. Plus three short signature motifs.

## Decisions

### Tools

- Soundfont: FluidR3_GM (Frank Wen, MIT licence), from the Debian/Ubuntu package `fluid-soundfont-gm`
  (`/usr/share/sounds/sf2/FluidR3_GM.sf2`). Renderer: the `fluidsynth` command line
  (`apt-get install -y fluidsynth fluid-soundfont-gm`; both are already installed in this container). MIDI is written
  with `mido` (`pip install mido`). Document the setup at the top of `tools/music/render.py`. Never commit the
  soundfont.
- Each theme is one data file, `tools/music/themes/<name>.json` (or `.py` if a little code makes the patterns far
  clearer): tempo, metre, key and mode, length in bars, and parts (GM program, channel, register, velocity range,
  pan, notes). Design a compact note notation and document it in `render.py`. Readable by a person who wants to
  change one bar.
- `python3 tools/music/render.py [theme ...]` renders one or all themes and signals.

### The loop

- A theme is one loop of 64 to 80 s. Render three cycles back to back, take the second cycle plus the first 1.5 s
  of the third, so reverb and release tails cross the seam exactly as they will in the app. The file is therefore
  loop + 1.5 s; the app joins the tail over the start with a linear crossfade (task 15).
- Stereo, 96 kbps mp3, 48 kHz, about -28 LUFS integrated, peak under -3 dBFS. Mono-safe: the mono sum within 3 dB
  of the stereo loudness, pans within 0.5 either side, no phase tricks.
- Sit under speech: after rendering apply a broad dip (about -5 dB at 1 kHz, Q about 0.5) and a gentle high shelf
  cut above 6 kHz. Report per theme the energy in 60 to 300 Hz, 300 Hz to 3 kHz and above 3 kHz; the middle band must
  not exceed the low band by more than 3 dB.
- Writing: slow (54 to 76 bpm), sparse, modal, long notes. No melody that competes with the narrator: a melodic
  figure is short, low or mid register, and leaves bars of rest. Nothing percussive louder than the pad. No sudden
  dynamics: a theme can be faded in at any bar.

### The six themes

| Theme | Character | Instruments (GM) |
| --- | --- | --- |
| `noir` | spies and secrets, 1910s to 1940s London: smoky, patient, a little dangerous | acoustic bass 33 (walking slowly or pedal), electric piano 5, brushes (drum channel, brush kit if the soundfont has one, else soft ride and hi-hat), muted trumpet 60, sparse |
| `river` | the working Thames, taverns, watermen | accordion 22 (or concertina-like reed), nylon guitar 25, perhaps fretless bass 36 |
| `solemn` | loss and remembrance | cello 43, piano 1, low strings 49 pad |
| `russia` | Russian history: Peter's shipyard, revolutionaries | plucked strings played as tremolo (rapid repeated notes on nylon guitar 25 or similar, the nearest thing to a balalaika), low choir 52, a low bass drone |
| `bright` | light and forward, the jolly stories | guitar 25 or 26, clarinet 71 (low register), pizzicato strings 46 |
| `voyage` | ships and exploration | French horn 61, strings 49, a slow swell |

### Signals (`public/sounds/signals/<name>.mp3`)

Mono (render stereo, sum to mono), peak under -6 dBFS, about -24 LUFS, a natural ring-out, no silence at the start
longer than 30 ms. Distinct from the ship's bell (task 16) and from each other:

- `arrive`, about 2 s: a gentle rising figure of three notes (celesta 9, harp 47 or vibraphone 12) over a soft chord.
- `close`, about 2.5 s: a soft falling two-note figure, resolving, quieter than `arrive`.
- `finish`, about 4 s: a short flourish, a rising arpeggio into a held major chord.

Write the real lengths (one decimal) into the catalogue `seconds` for these three.

### Credits

`src/audio/credits-music.json`, one entry per file, same shape as task 16's
(`{ "file", "title", "author", "licence", "source", "cut" }`): author "Composed for Versta", licence "CC0" for the
compositions, and a `soundfont` note: "Rendered with FluidR3_GM by Frank Wen (MIT licence)". Task 16 generates
`docs/sound-credits.md` from both files.

## Acceptance checks

1. `python3 tools/music/render.py` renders everything from scratch, deterministic (same input, same output).
2. Six themes and three signals in place; a check command (`render.py check`) prints for each: length, LUFS, peak,
   mono-sum difference, band energies, and the loop seam error (the RMS difference between the tail and the start
   it repeats, which must be small), and exits 1 when a limit is broken.
3. `public/sounds/music/` at most 5 MB in total.
4. `npm run check` passes.
5. The report describes each theme in two lines (harmony, texture), so the master can judge it before listening.
