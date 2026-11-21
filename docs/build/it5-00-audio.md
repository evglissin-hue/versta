# Iteration 5: the sound of the ride (spec)

Status: spec agreed with Evgeny on 21 November 2026. Briefs cut the same day (`it5-14-breaks.md` to
`it5-20-soundcheck.md`), contracts settled in `src/types.ts` and `src/audio/catalogue.json`. Built on 21 November:
all seven tasks merged, two review rounds (`iteration-5-rounds.md`). The recordings are still to be fetched (Wikimedia
refused downloads throughout), so the 21 effects are written into the route files but have no sound yet.

## Decisions made when tracing (master, 21 November)

- Breaks live in `tools/content/<id>.breaks.json`, keyed by clip file, not in `<id>.audio.json`: narration rewrites
  that file, and two stories can share a clip.
- `tools/pack_sound.py` writes every sound field (breaks, music, sfx, ambience) into an existing `pack.json`, and
  `build_pack.py` calls it. A full `build_pack.py` run needs cached OpenStreetMap extracts that are not in the repo, and
  a fresh download would move lines and cues.
- `src/audio/catalogue.json` names every soundscape, theme, signal and effect, with labels for the Sound check screen
  and nominal lengths for the virtual mixer. The validators read it.
- The aside bell is a recording (task 16); the arrival, close and finish motifs are rendered with the music (task 17).
- Effects: 21 names over 19 of the 32 stories. Besides traffic sounds, no close gunshots or explosions: a bang in one
  earbud on a bike is a hazard. The execution and explosion stories have none.
- The voice fades sit inside the pause before a phrase: a yield fades out from 0.20 s to 0.05 s before the onset, a
  resume starts 0.25 s before it.
- A cue may wait only when the turn is at least 11 s away (3 s wait, about 3 s of speech, 5 s to spare).
- `leave` fades the bed over 4 s even if a story is still playing: the soundscape belongs to the place.
- Freesound: no token, so the library comes from Wikimedia Commons alone.
- Sound budget: loops, effects and the bell 8.5 MB, music 5 MB.

## What Evgeny asked for

Two things bother him today: the soundscape and music, and how sounds meet each other. The narrator's voice and the
phone side (loudness, other apps, lock screen) are not in this iteration.

His decisions:

| Question | Decision |
| --- | --- |
| Listening | A mix of one earbud, open-ear headphones and the phone speaker. Tune for the first two, stay acceptable on the speaker. |
| Budget | Free only. No paid voice, no paid libraries. |
| Size | Full overhaul of the two areas. |
| Music | Generated, not downloaded: themes composed as notes in the repo and rendered offline through a free sampled-instrument soundfont into loopable files. |
| Music style | Per theme, about six themes. |
| Licences | CC0, public domain and now CC BY. No non-commercial, no share-alike. Authors are credited in the app. |
| When the soundscape plays | Around stories: it rises on arrival before the narrator, holds between a stop's stories, lingers after the last one. Silent while riding. |
| Effects timed to the text | Sparing: 1 to 3 in the stories that earn it, placed in pauses. |
| A turn cue during a story | Finish the sentence when there is time, then the cue, then the next sentence. Otherwise fade at once and replay the cut sentence. |
| Signature sounds | A recorded set: ship's bell before a passing-by story, an arrival motif, a soft close, a finish flourish. |

## What is wrong today (traced in the code)

- Music is live synthesis from raw oscillators: four chords and random scale notes (`buildMusic` in
  `src/audio/soundscapes.ts`). It reads as a pad, not as music.
- The soundscape library is 8 mono loops of 18 to 40 s (`public/sounds/`). Creaks, hammering, drips, the tunnel
  rumble, the foghorn and glass clinks are synthesised because nothing CC0 was found. Royal Docks reuses 6 recipes
  for 11 stops.
- The bed starts with a story and stops with it (`startBed` and `fadeBed` in `src/story/director.ts`). Nothing
  reacts to the text.
- A turn cue pauses the story with `el.pause()`: no fade, mid-word, and the story resumes 250 ms after the cue at
  the same sample (`applyVoice` and `pumpNav` in `src/audio/mixer.ts`). The cut word is lost.
- Stop, skip, an arrival cutting an aside, and `stopAll` are hard cuts.
- "In one hundred metres," and the cue are two files played back to back on one audio element, with a load gap.
- The chime is a synthesised double bell. Arrivals, the end of a stop's stories and the finish have no sound.
- Clips are fetched when they are needed, so a story can start late on a slow connection.
- Three iterations of round notes say the same thing: nobody has heard the sounds before Evgeny rides.

## Design

### 1. Phrase marks in the narration

No re-recording. A tools script finds the pauses in the existing story and aside files (ffmpeg `silencedetect`, about
-38 dB for 0.28 s or more; tried on `greenwich-0.mp3`: 26 pauses in 71 s, 16 sentences) and writes, per clip, the
times where a phrase begins. The pack carries them:

- `StoryAudio.breaks?: number[]` and `Aside.breaks?: number[]`: seconds at which a new phrase starts, ascending.
  Absent means "no marks": the mixer then behaves as in "fade at once" below with a fixed 1.5 s step back.
- `build_pack.py` passes them through and checks them (ascending, inside the clip, paragraph marks are a subset
  within 0.15 s).

### 2. The mixer learns to yield gracefully

Contract changes (master edits `src/types.ts`):

- `playVoice(src, { breaks?, ... })`.
- `playNav(src, { urgent?, ... })`. Not urgent: approach cues, arrival, off route, back on route, rerouting, wrong
  way. Urgent: a cue spoken at the turn itself and detour turns.
- `signal(name)`: replaces `chime()`. Names: `aside`, `arrive`, `close`, `finish`. Resolves when it has sounded.
- `playEffect(name, { level? })`: a one-shot on the bed bus, carved by the pocket like the rest of the bed.
- `startBed(ambience, music)` takes a music theme name in place of the mood. `stopBed(fadeSeconds)` stays.
- `preload(srcs)`: fetch clips ahead of need.

Behaviour:

- Every start, pause, resume, stop and skip of the voice channel is a gain ramp (about 150 ms out, 200 ms in), on the
  voice bus when routed through Web Audio and on element volume otherwise. No hard cuts anywhere.
- A cue that is not urgent, arriving while narration plays: if the next break is within 3 s, the narration runs to
  it, fades, the cue speaks, and the narration resumes from that break. The director only allows the wait when the
  turn is still at least 8 s away at the rider's speed after waiting.
- Otherwise (urgent, or no break in reach): fade at once, speak, then resume from the last break before the cut,
  at most 6 s back.
- The rider's own Pause follows the same rule on resume: after a pause longer than 20 s the story picks up from the
  start of the phrase. "Back 15 s" lands on a break.
- The distance call and its cue sound as one utterance: at most 150 ms between them. The master chooses the method
  when tracing (decoded buffers scheduled back to back, or a second preloaded element).
- Signals never sound over speech. They use the nav queue's ordering: the arrival motif plays, then "Arriving at".

### 3. The bed lives around stories

Director changes:

- On `arrive`: the arrival signal, then the stop's soundscape fades in over about 3 s while "Arriving at" is spoken,
  then the story. With "Start stories on arrival" off, the soundscape plays for 30 s and fades unless a story starts.
- Between a stop's stories the bed holds. If the next story has another soundscape or theme, they crossfade over
  2 to 3 s. The 2.5 s pause between stories stays.
- After the last story: the `close` signal, the bed lingers 20 s, then fades over 6 s. A `leave` event fades it over
  4 s at once. The dead-end hunt checks it never outlives the stop.
- Passing-by stories: ship's bell, a soft bed under them as now, faded in and out. An arrival during one fades it
  over 400 ms.
- `finished`: the finish flourish.
- Prefetch: the stop's first story within 150 m of the stop, an aside's clip when it is offered, the next cue's clip
  when it becomes `nextCue`.
- The "Soundscape" switch governs soundscape, effects and signals other than the aside bell. "Music" governs music.
  No new settings.

### 4. A real sound library

`tools/sound/build_sounds.py` and `sources.json` grow; `docs/sound-credits.md` lists every file with source page,
author and licence, and the app gets a credits list (see task 19).

- Sources: Wikimedia Commons and Freesound. Licences: CC0, public domain, CC BY only.
- Replace every synthesised layer with a recording: wood and rope creaking, shipyard hammering, dripping in a tunnel,
  tunnel air and footsteps, a ship's horn, glasses and pub clatter.
- Lengthen the staples to 60 to 120 s and add what the two routes lack: a wider river, lapping at a dock wall, sails
  and rigging, ice and Arctic wind, a working dock, a quiet church interior, a street of the sailing-ship era.
- Give Royal Docks its own recipes so its 11 stops do not share 6.
- One-shots for signals (a real ship's bell) and for story effects, as the stories need them.
- Format: loops mono 64 kbps at about -26 LUFS; one-shots mono, peak under -3 dBFS. Layers may be panned up to 0.3
  either way so a single earbud never loses one. `public/sounds/` stays under 14 MB in total (now 2 MB).
- The synthesised layers stay only as the fallback for a file that fails to load.

### 5. Music: composed, rendered, per theme

- `tools/music/`: each theme is note data in the repo (tempo, key, parts, instruments), rendered by a script through
  a free General MIDI soundfont (FluidR3 GM, MIT, or GeneralUser GS; record the licence in the credits) to
  `public/sounds/music/<theme>.mp3`: 60 to 120 s, seamless loop, stereo 96 kbps, about -28 LUFS, mono-safe.
- Themes: `noir` (spies: upright bass, electric piano, brushes, muted trumpet), `river` (concertina or accordion,
  guitar), `solemn` (cello, piano), `russia` (tremolo plucked strings as the nearest thing to a balalaika, low choir),
  `bright` (guitar, clarinet, light and forward), `voyage` (ships and exploration: horn, strings).
- Slow, sparse, modal, written to sit under speech: little between 300 Hz and 3 kHz, no melody that competes with
  the narrator, nothing percussive louder than the pad.
- Each story names its theme in the content files (`music`). Without one: `minor` gives `solemn`, `bright` gives
  `bright`. Pack type: `Story.music?: string`. The validator knows the theme names.
- `buildMusic` and the oscillator pad are removed. A theme that fails to load means no music.

### 6. Effects timed to the text

- Content: `sfx` on a story, a list of `{ para, name, level? }`. Pack type: `Story.sfx?`. The effect sounds in the
  pause before paragraph `para`, starting about 1.2 s before its mark, on the bed bus. In read-by-tapping mode it
  sounds when the paragraph appears.
- The master authors them for both routes: 1 to 3 in the stories that earn one, none where nothing fits. Aim for
  about half of the 32 stories. Only sounds true to what the text says is happening. Nothing that could be mistaken
  for traffic: no car horns, sirens or bicycle bells.
- Validator: `para` exists, the effect file exists, no two effects within 10 s of each other.

### 7. The mix, re-tuned for three ways of listening

- Keep the pocket. Re-measure with the new library and music: bed mid band 14 to 18 dB under the voice in speech,
  about 8 dB in gaps (the it2 targets).
- Effects 10 to 14 dB under the voice. Signals at least 6 dB under the voice peak.
- New measurements in `tools/sound/check-mix.mjs`: left only, right only and the mono sum of the bed within 3 dB of
  each other; in a phone-speaker band (300 Hz to 8 kHz) the voice at least 12 dB over the bed while speaking.

### 8. Sound check screen

A screen reached from "Sound and settings" by a button labelled "Sound check". It lists every soundscape, music theme,
signal and effect by name with a Play button each, and a switch "With the narrator" that plays a sample of narration
over it through the real mixer. This is how Evgeny signs the library off before a ride, and what step 5 of the loop
uses. It also carries the sound credits.

## Tasks

| No. | Task | Owned paths | Order |
| --- | --- | --- | --- |
| 14 | Phrase marks: the pause finder, `breaks` through `build_pack.py`, both packs rebuilt | `tools/sound/find_breaks.py`, `tools/build_pack.py`, `tools/content/*.audio.json`, `public/packs/**/pack.json` | first |
| 15 | Mixer: fades, yield at a break, replay, signals, effects, preload, gapless distance call, virtual mode and a sound timeline for tests | `src/audio/mixer.ts`, `clips.ts`, `graph.ts`, `bed.ts`, `tests/unit/mixer.test.ts` | with 14 |
| 16 | Sound library: recordings, one-shots, recipes, credits | `tools/sound/**`, `public/sounds/*.mp3`, `public/sounds/fx/**`, `src/audio/soundscapes.ts`, `src/audio/loops.ts`, `docs/sound-credits.md` | with 14 |
| 17 | Music: themes, renderer, files | `tools/music/**`, `public/sounds/music/**` | with 14 |
| 18 | Director: bed around stories, signals, effects, urgency, prefetch | `src/story/director.ts`, `tests/unit/director.test.ts` | after 15 |
| 19 | Content: `music` and `sfx` for every story of both routes, validator, offline list | `tools/content/**`, `tools/build_pack.py`, `src/offline.ts`, `docs/adding-a-route.md` | after 16, 17 |
| 20 | Sound check screen and credits | `src/ui/SoundCheck.tsx`, `src/ui/SoundSheet.tsx`, `src/styles/**` | after 15 |

Tasks 14 and 19 both touch `build_pack.py`: 19 merges 14 first. Mix tuning (section 7) is done by the master in the
quality check, when all sounds are in.

## Acceptance

- `npm run check` and the e2e rides pass.
- Unit, mixer: a cue 2 s before a break waits and the narration resumes at that break; a cue with no break in reach
  fades at once and resumes at most 6 s back at a break; an urgent cue never waits; no test hears two speech clips
  at once.
- Dead-end hunt, on the sound timeline the virtual mixer records, over full rides of both packs at walking, riding
  and fast speeds, a start part way and a detour:
  - no two speech clips overlap, and no signal overlaps speech;
  - every spoken cue starts within 3.5 s of its event, and a cue that waited still ends at least 5 s before its turn;
  - narration resumes within 1 s of the nav queue emptying, and nothing stays held;
  - the bed is never running more than 30 s after the rider has left a stop;
  - every effect fires once per pass, within 0.5 s of its place.
- Static: every soundscape, theme, effect and signal a pack or recipe names exists as a file; every file is within
  its loudness, peak and length limits; every file has a line in the credits; "Save for offline" saves them all and
  the Android build contains them.
- `check-mix.mjs` prints and passes the targets of section 7 for one story from each route.
- Rider's seat: the Sound check screen in light and dark at phone size, every row plays.

## Needs Evgeny

- A free Freesound API token for the executing session (its search needs one). Without it the library comes from
  Wikimedia Commons alone, which answered with a rate limit during planning, so the fetcher must pause between calls.
- His ears: before the PR, an hour with the Sound check screen. Anything he names is swapped or dropped.

## Not in this iteration

The narrator's voice, loudness outdoors, playing alongside other apps, lock screen and headphone controls, new routes.
