# Iteration 5: what the review rounds found

Request: the sound of the ride (`it5-00-audio.md`): narration that yields to a turn at the end of a phrase, a bed of
soundscape and music around each stop, signals, effects in the stories' pauses, a real sound library, and a Sound
check screen. Seven tasks, 14 to 20, each merged after review against its brief.

## What changed from the spec

- Task 16 (library) is half done. Wikimedia's download host answered every request with 429 and retry-after 600 for
  the whole build (about 18:15 to 20:00 UTC, retried once more by the master): no new recording was downloaded. The
  library is still the eight loops of iteration 2. What is in:
  - `build_sounds.py` with fetch, process, check and credits.
  - 35 sources chosen and licence-checked in `tools/sound/sources.json`.
  - Recipes for all 23 soundscapes, with gentle panning.
  - Credits for every file.
  - `tools/sound/planned-recipes.txt` for when the recordings land.
- The 21 effects have no files. They are written into the route files (19 stories). `pack_sound.py` leaves an effect
  out of `pack.json` until its file exists, so rerunning it fills them in, and `packs.test.ts` fails if a rerun is
  forgotten. The Sound check screen marks them "Not recorded yet".
- The ship's bell before a passing-by story was also to be a recording. Without a file it was silent, so a two-stroke
  bell is rendered with the other signals (`tools/music/signals.py`) as a stand-in. When the recording is fetched,
  drop the stand-in and its credit line: `sounds.test.ts` fails on two credits for one file.
- "Save for offline" saves every sound a pack can play, but a sound that fails to save does not fail the save
  (the effect files are missing for now).

## Round 1

Quality check:

- Tasks 14, 15, 17, 18, 20: as briefed.
- Task 19 changed `tests/unit/director.test.ts` outside its paths: the new themes replaced the mood fallback in 7
  expectations. Kept.
- Task 16 and task 17 credits disagreed: a composed theme has no source page. Composed entries now name their
  script and carry a plain note, which is what the screen shows.

Dead-end hunt (the sound timeline of the virtual mixer, whole rides of both packs at walking, riding and fast speeds,
a start part way and a detour; `tests/unit/timeline.ts` and `tests/unit/ride.integration.test.ts`):

- Found: simulated riders rode on during the new 3 s between arriving and the story starting, because nothing was
  playing. Real riders stand there. The simulators now stand through it.
- Found: the rule for whether a cue may wait for a phrase break assumed 3 s of speech. It now counts the real
  length of the distance call plus the cue.
- Hunt false positives fixed in the checks: a clip that reached its own end looked like an interruption (the
  timeline now marks natural ends), and a wait was measured from the cue clip instead of the distance call.
- Found, and the old e2e failure explained: at East India Dock the cycle path passes 45 m from the stop before the
  line turns down a spur to it. The engine called the arrival on that pass, 158 m early. The turn onto the spur was
  never spoken, the rider heard the next leg's turns, then "wrong way" on the spur. Whitechapel (Thames Loop) has the
  same layout. Fixed in the engine: a radius arrival needs the rest of the line to stay within 15 m beyond the
  radius, unless the rider has left the line.
- New check for the whole class, `tests/unit/arrival.test.ts`: every segment of every pack is ridden with each fix
  pulled 15 m towards the stop, and again 8 m to each side of the line. It fails on an early arrival, an unspoken
  turn, wrong way or off route.
- Found by that check: the Twelvetrees Crescent hairpin (Royal Docks), where the line comes back 11 m from where it
  went out. With 6 m of GPS error the engine matched the leg coming back, so the sharp left was never spoken, and
  then took the rider for riding the first leg backwards ("wrong way"). Fixed: matching counts a leg that runs
  against a moving rider's heading as 20 m further away, and searches ahead only as far as the rider could have got
  since the last fix. The check now passes with up to 12 m to either side.
- Found: the simulator's arrival hold never released at a stop with only optional stories (it checked the wrong
  segment), so the simulated rider stood there for ever. Simulator only.
- Found: the finish flourish sounded on arriving at the last stop, before the home story and its close signal. It
  now follows the last story, in place of the close.
- The e2e full ride stopped watching the moment the ride said finished, a second before the home story started. It
  now waits for 2 s of quiet. The e2e full ride also fails on "wrong way" now.

Mix (`tools/sound/check-mix.mjs`, real audio in headless Chrome, one story from each route):

- Thames Loop passed every target. Royal Docks failed the pocket targets at its first stop: the new burial
  soundscape sat 23.6 dB under the voice in speech (target 14 to 18) and 13.9 dB in gaps (target about 8).
- Measured all 23 soundscapes and 6 themes alone through the real mixer. The ten new soundscapes were up to 9 dB
  quieter in the speech band than the first thirteen. Each soundscape now has a level trim (`TRIM_DB` in
  `src/audio/soundscapes.ts`) so all sit near -21.5 dBFS in that band. The tunnel and the pumping station are mostly
  low rumble and are capped at +5 dB.
- The music sat 14 dB under the soundscapes, too quiet to hear on a bike. It now sits about 8 dB under. This is a
  taste call to confirm by ear.
- After both: both routes pass every target, including:

  | Check | Thames Loop | Royal Docks |
  | --- | --- | --- |
  | Bed mid band under the voice in speech | 16.6 dB | 16.3 dB |
  | Bed mid band under the voice in gaps | 6.6 dB | 7.4 dB |
  | Voice over the bed in the phone band | 13.5 dB | 14.6 dB |

  Also: left, right and mono within 3 dB, and signals more than 6 dB under the voice peak.
- Not tuned: effects (no files), so `EFFECT_LEVEL` is untested against the 10 to 14 dB target.
- The voyage theme leans 4 dB to the right when played alone. It passes inside the full bed.

Rider's seat (`?demo=ride&step=soundcheck`, `sound`, `story` and Home, 390 by 844, light and dark):

- The Sound check screen offered Play on 21 effects with no file: silence, no explanation. Now "Not recorded yet".
- The credits showed script paths and file extensions. Now plain titles, and a sound font note for the music.
- "Plays through this device only" did not say anything a rider needed. Now "Nothing here changes your settings."
- The Home link "Sound check" had no hint beside it, unlike the Android link. Now "lets you hear every sound before
  you ride".
- The Soundscape switch also governs the signals at stops. Its hint now says so.

## Round 2

- `npm run check`: 279 unit tests pass, build clean.
- Full e2e on the final state: 34 of 34 pass. These include the Royal Docks full ride, which had failed since before
  this iteration (the East India Dock arrival).
- `python3 tools/music/render.py check` and `python3 tools/sound/build_sounds.py check` hold. The sounds reach
  `dist/` and so the Android build.
- Nothing new found.

## Open

- The recordings: rerun `python3 tools/sound/build_sounds.py fetch`, then `process`, `check` and `credits` when
  Wikimedia lets requests through, then the steps listed at the top of `tests/unit/sounds.test.ts`, then
  `python3 tools/pack_sound.py thames-loop` and `royal-docks`. A Freesound token would widen the choice: eight
  effects and five loops had no candidate on Commons at the licence bar.
- Nobody has listened to any of it. Before the PR, Evgeny needs about an hour with the Sound check screen and the
  narrator switch: every soundscape, theme and signal, and the level of the music.
- A turn spoken the moment the rider leaves a stop can come about 3 s after the depart cue at 9 m/s. This was the
  case before this iteration.
