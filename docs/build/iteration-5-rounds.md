# Iteration 5: what the review rounds found

Request: the sound of the ride (`it5-00-audio.md`): narration that yields to a turn at the end of a phrase, a bed of
soundscape and music around each stop, signals, effects in the stories' pauses, a real sound library, and a Sound
check screen. Seven tasks, 14 to 20, each merged after review against its brief.

## What changed from the spec

- Wikimedia's download host refused every request from the build container (429, retry-after 600) for the whole
  build. Task 16 delivered the tooling, 35 licence-checked sources, recipes and credits, but no new recording. The
  recordings were then fetched on Evgeny's own connection (branch `sounds-recordings`, 22 November) and wired in by
  the master in round 3.
- 12 of the 21 effects have a recording. Nine have no source under the licence bar (CC0, public domain, CC BY):
  sail-flap, tankards, oars, distant-cannon, parrots, big-bell, crates, waders, water-flow. They stay in the route
  files; `pack_sound.py` leaves an effect out of `pack.json` until its file exists, `packs.test.ts` fails if a rerun
  is forgotten, and the Sound check screen marks them "Not recorded yet".
- Soundscape layers with no recording (rigging, cobbles, the foot tunnel, wading birds, a dockyard) keep a generated
  stand-in or were dropped.
- "Save for offline" saves every sound a pack can play, but a sound that fails to save does not fail the save.

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

## Round 3: the recordings (22 November)

Evgeny fetched the recordings on his own connection (branch `sounds-recordings`, 15 new loops, 12 effects, the
ship's bell). Wired in by the master:

- Recipes rebuilt from `tools/sound/planned-recipes.txt` (now deleted), with sparse one-shot layers where an effect
  fits the place: a ship's horn on the river, ice in the Arctic, a hammer in the yard, a chain at the working dock,
  the water wheel at the mill.
- The rendered bell stand-in is gone. The effect lengths are in the catalogue. Both packs rebuilt with
  `pack_sound.py`: 14 stories carry 19 effects. The diff shows only `sfx`.
- `build_sounds.py check` failed on seven files:
  - Fire crackle and water lap were 6 and 2 dB under the effect loudness target. They were compressed and raised
    10 dB, and their credits say so.
  - Two effect lengths differed from the catalogue.
  - The three signals from the music tool were held to this tool's targets. The check now leaves them to the music
    tool.
- Credits: CC BY 4.0 asks that changes be indicated, so every recording's line on the Sound check screen now says
  "Cut and levelled for Versta".

Mix:

- Found: with the recordings in, both routes failed. The story effects fire in the pauses, right where the check
  measures the gaps, so the check counted them as bed. Now samples are kept out of the bed figures while a story
  effect or a soundscape's own one-shot is sounding. Those one-shots are on the sound timeline as `bed:<name>`.
  The check also measures the effects themselves.
- Found: birdsong. "Birds singing in garden" was the base of the burial and park soundscapes, so Bunhill Fields
  had song bursts reaching -20 dBFS in the band the pocket does not reach (it only cuts the speech band). The phone
  band there was 5.6 dB under the voice, against a target of 12. Burial, park and towpath now rest on wind or water,
  with the birds underneath.
- Trims measured again. Each soundscape is measured alone over 24 one-second readings, and the trim respects five
  limits: speech band, overall, phone band, and two caps on bursts (`TRIM_DB` explains them).
- The low and high band checks are judged only when the bed is steady by itself. Birdsong in a gap moved the high
  band by up to 15 dB with no help from the pocket.
- Effects were 14 to 16 dB under the voice, at or past the quiet edge. `EFFECT_LEVEL` went from 0.7 to 1.1, and
  they now sit 11.7 to 12.7 dB under.
- Result, two runs each, every target passes:

  | Check | Thames Loop | Royal Docks |
  | --- | --- | --- |
  | Bed mid band under the voice in speech | 16.5 to 16.9 dB | 16.3 to 16.7 dB |
  | Bed mid band under the voice in gaps | 6.3 to 7.0 dB | 6.9 to 7.1 dB |
  | Voice over the bed in the phone band | 13.7 to 13.9 dB | 13.3 to 13.9 dB |

- Borderline: on the Thames the low band moves 4.7 to 5.4 dB between speech and gaps, against a 5 dB limit. That
  is the iteration 2 pocket (a 2 dB drop of the whole bed and the lower edge of the 500 Hz cut) meeting the new
  river recording. Not retuned before anyone has listened.

## Round 4: the synthesised sounds (22 November)

Made in their own session with sfx-skill (MIT), synthesis only, all CC0: nine effects and five 30 s loops
(`tools/sound/sfx/`). Recipes: rigging under ship and sail, cobbles in sailortown and oldstreet, the foot tunnel
replaces the generated rumble, waders in basin, the dockyard in working-dock; sparse sail-flap, tankards (in place of
the generated clink), water-flow, waders and crates. Both packs rebuilt: nine stories gain their effects. Trims
measured again.

- `build_sounds.py check`: every file passes, 8.84 MB in all.
- check-mix: Royal Docks passes every target. The Thames passes all but the low band, at 5.2 and 5.9 dB against 5 in
  two runs. The base commit fails it too (5.0 and 5.1): it is the river borderline of round 3, not the new sounds.
- Effects under the voice on the Thames: 14.2 and 11.7 dB in two runs (the same recorded effects as before).
- The new effects are mastered like the recorded ones but are not in the stories check-mix measures.
- Nobody has listened. sfx-skill's own check flags short clicks at the wood strikes of oars and crates (intended
  contact) and quieter sub-layers in the loops; each loop's events stand 7 to 28 dB over its bed.

## Open

- The nine effects with no recording (sail-flap, tankards, oars, distant-cannon, parrots, big-bell, crates, waders,
  water-flow) and five loops (rigging, cobbles, tunnel, waders, dockyard) are now synthesised with sfx-skill, see
  round 4. A recording found later can replace any of them through `tools/sound/sources.json`.
- Nobody has listened to any of it. Before the PR, Evgeny needs about an hour with the Sound check screen and the
  narrator switch: every soundscape, theme, signal and effect, the level of the music and of the effects, and
  whether the Thames bed pumps under speech.
- A turn spoken the moment the rider leaves a stop can come about 3 s after the depart cue at 9 m/s. This was the
  case before this iteration.
