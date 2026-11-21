# Task 18: the director, the bed around stories

Owned paths: `src/story/director.ts`, `tests/unit/director.test.ts`.
Starts after task 15 is merged into the master branch (it relies on the new mixer: fades, yields, signals, effects,
preload and the sound timeline).

Read first: `docs/build/it5-00-audio.md` sections 2, 3 and 6, `src/types.ts` (`Mixer`, `Story.music`, `Story.sfx`,
`StoryAudio.breaks`, `Aside.breaks`, the new `DirectorLogEntry` kinds), `src/audio/catalogue.json`, and the merged
`src/audio/mixer.ts`.

## Goal

The soundscape rises when the rider arrives, holds between a stop's stories, lingers a little after the last one and
is gone once they ride on. Signature sounds mark arrivals, the end of a stop and the finish. Effects land in the
pauses of the stories that have them. Turn cues tell the mixer whether they may wait for the end of a sentence.
Clips are fetched before they are needed.

## Decisions

Settings: the "Soundscape" switch (`ambience`) governs soundscapes, effects and the signals `arrive`, `close` and
`finish`. The aside bell always rings before an aside. "Music" (`music`) governs music. No new settings.

Constants (real time, divide waits by `timeScale` as the director does now): arrival lead 3 s, linger 20 s, linger
fade 6 s, leave fade 4 s, arrival without auto-play 30 s, effect lead 1.2 s, aside cut fade 0.4 s, crossfades as the
mixer does them.

### The bed

- Theme of a story: `story.music ?? (story.mood === "minor" ? "solemn" : "bright")`. Soundscape:
  `story.ambience ?? stop.ambience`. Both null when their setting is off.
- `arrive` at stop `s`:
  1. cut a playing aside: `stopVoice(0.4)`, end its bed (as now, but faded);
  2. `signal("arrive")` when `ambience` is on (it goes through the nav queue, so it sounds before "Arriving at");
  3. the arrival clip when `navVoice` is on (as now);
  4. with auto-play on and an unheard core story: start the bed of that story at once, so it fades in over about
     3 s under the signal and "Arriving at", and start the story itself 3 s after the arrival (the mixer holds the
     voice while the nav queue speaks, so it follows "Arriving at" in any case);
  5. with auto-play off (or nothing to play): the stop's soundscape alone (no music) for 30 s, then `stopBed(6)`,
     unless a story starts first.
- Between a stop's stories the bed holds: the next story calls `startBed` with its own pair and the mixer keeps a
  layer that did not change and crossfades one that did. The 2.5 s pause between stories stays.
- After the last story of the queue: `signal("close")` (if `ambience`), the bed lingers 20 s, then `stopBed(6)`.
  A story started during the linger cancels it.
- `leave` (the rider rides away from a stop): `stopBed(4)` at once, whatever is playing. A story still playing goes
  on without its bed. This is the rule "the bed never outlives the stop".
- A story the rider starts by tapping (`playStory`, `playStop`) away from a stop gets its bed as now.
- `skip` and `stopAll` use the mixer's fades (they are fades now in the mixer, nothing to do), and `stopAll` stops the
  bed with `stopBed(1)`.
- `finished`: `signal("finish")` when `ambience` is on, after whatever the nav queue holds.

### Passing-by stories

- The bell is `signal("aside")` (replaces `chime()`), then the aside clip with `breaks: aside.breaks`, a soft bed
  under it as now. The soft bed fades in and out with the mixer's bed fades (`stopBed(1.5)` at its end).
- An arrival during an aside fades it over 0.4 s (`stopVoice(0.4)`), and its bed with `stopBed(1)`.

### Turn cues and urgency

- Every `playNav` says whether it is urgent:
  - approach announcement (distance call and cue): urgent unless the rider will take at least 11 s to reach the
    turn: `toCue / speed >= 11`, with `speed = nav.speedAvg ?? nav.fix?.speed ?? 4` (never below 1 m/s). 11 s is the
    3 s the mixer may wait plus about 3 s of speech plus the 5 s that must remain;
  - a cue spoken at the turn itself (`phase: "now"` for an unannounced cue) and `detour_turn`: urgent;
  - depart, arrival, off route, back on route, rerouting, wrong way: not urgent.
- Story narration passes `breaks: story.audio.breaks` to `playVoice`.

### Effects timed to the text

- For a story with `sfx`, each entry fires once per play of the story, when the playhead (from `onTime`) first
  reaches `marks[para] - 1.2` (and not before 0): `mixer.playEffect(name, { level })` when `ambience` is on.
  Log `{ what: "effect", id: story.id, reason: "<para>:<name>" }`.
- A `rewind` to before an effect's place arms it again. A pause holds it (the playhead does not move).
- Read by tapping: the effect for paragraph `p` fires when paragraph `p` appears.

### Prefetch (`mixer.preload`)

- At the first `handle()` call: the pack's distance clips and system clips (off route, back on route, rerouting,
  wrong way, turns).
- While riding towards stop `s` and within 150 m of it (`nav.toStop <= 150`), once per stop: the arrival clip, the
  first unheard core story's audio, `ambience:<its soundscape>` and `music:<its theme>`.
- When an aside is offered and will play: its clip, before the bell.
- When `nav.nextCue` changes: that cue's clip (not quiet ones).

### Logging

- `signal`: log `{ what: "signal", id: name }` when the director asks for one.

## Acceptance checks (unit, virtual mixer, fake timers; extend `tests/unit/director.test.ts`)

1. Arrival at Deptford with auto-play: the timeline shows signal `arrive`, then the arrival clip, then the first story;
   the ambience and music `on` before the story's voice `on` by at least 2.5 s; the music theme is the story's.
2. Two stories at one stop with different themes: the ambience does not restart between them; the music crossfades.
3. After the last story: signal `close`, ambience `off` between 25 and 27 s after the story ends; with a `leave` 5 s
   after the story ends, `off` within 4.5 s of the leave.
4. Auto-play off: soundscape without music, `off` about 36 s after the arrival; a tap on a story within that time keeps
   it and adds the music.
5. An aside: signal `aside` then the clip; an arrival during it: voice `off` within 0.45 s of the arrival.
6. Urgency: an approach at 200 m and 5 m/s is not urgent; at 40 m and 5 m/s it is; a "now" cue and a detour turn are.
   (Spy on `playNav` and read the option.)
7. A story with `sfx` (build a small pack fixture by copying a real story and adding `sfx`): each effect fires once,
   within 0.3 s of `marks[para] - 1.2` of clip time; not with `ambience` off; again after a rewind past it; in read by
   tapping, when its paragraph shows.
8. Prefetch: within 150 m of a stop the first story's audio and its `ambience:` and `music:` entries are preloaded once;
   the next cue's clip is preloaded when it becomes `nextCue`.
9. `finished` with `ambience` on: signal `finish` after the nav queue; with it off: no signal.
10. Existing director tests still pass, adapted where the behaviour changed on purpose (say which in the report).
11. `npm run check` passes.
