# Task 3: the mixer and the director

Owned paths: `src/audio/**`, `src/story/**`, `tests/unit/mixer.test.ts`, `tests/unit/director.test.ts`.

## Goal

Everything the rider hears. The mixer plays sound; the director decides what and when. Contracts: `Mixer`,
`MixerOptions`, `Director`, `DirectorDeps`, `NowPlaying`, `DirectorLogEntry` in `src/types.ts`.

## Mixer (`createMixer(opts)` in `src/audio/mixer.ts`)

- Real mode: two `HTMLAudioElement`s, one for the voice channel (stories, asides) and one for the nav channel (turn
  cues, system clips), plus a Web Audio bed (generated ambience and music). Paths are pack-relative; resolve against
  `opts.baseUrl`.
- `unlock()`: called from a tap. Create or resume the `AudioContext` and prime both elements (play then pause a short
  silent clip) so later playback without a tap is allowed.
- `playVoice`: starts a clip, replacing whatever the voice channel was playing (the replaced handle rejects with
  "stopped"). `onTime` gets the playhead about four times a second. `done` resolves at the natural end, rejects with
  "stopped" on `stop()` or replacement, and rejects with "error" if the clip cannot play.
- `playNav`: clips queue first in, first out, at most three waiting (drop the oldest waiting one beyond that). While
  the nav channel speaks, the voice channel is paused if it was playing, and resumes 250 ms after the nav queue
  empties. A voice clip started while nav is speaking waits until nav has finished.
- `chime()`: two strokes of a ship's bell on Web Audio, about 1.2 s.
- Bed: port the generated soundscapes and music from `docs/legacy/artifact-v1.html` (the block between the comments
  "generated sound" and "playback": layers, the `AMB` presets, `startAmbience`, `startMusic`, `duck`) into typed
  modules under `src/audio/`. `startBed(ambience, mood)` starts either or both (null means off), replacing a running
  bed; unknown ambience names fall back to `river`. The bed ducks to about half while either channel speaks.
  `stopBed(fade)` fades out. Do not ring the opening bell that `startAmbience` had; `chime()` covers that.
- Virtual mode (`opts.virtual`): no audio elements, no `AudioContext`. A clip "plays" for
  `estimatedSeconds / timeScale` real seconds (default 3 s when not given), `onTime` reports the scaled playhead, and
  pause, resume, stop and the nav rules behave exactly as in real mode. This is what unit tests and fast simulated
  rides use, so it must run under Node (no `window`).
- `navBusy`, `voiceBusy` as documented in the contract.

## Director (`createDirector(deps)` in `src/story/director.ts`)

- Turn cues: on `cue` with phase `approach`, speak `cue.audio` through `playNav` unless `cue.quiet` or
  `settings.navVoice` is off (log `cue_spoken` or `cue_shown`). On phase `now`, speak only if it is a `depart` cue or
  the approach for that cue was never spoken. Never speak the same cue twice.
- `off_route`: speak `pack.system.offRoute`. `back_on_route`: speak `pack.system.backOnRoute`. Log both.
- `arrive`: stop an aside if one is playing, speak `pack.system.arrive[stop]` (when `navVoice`), log `arrive`. Then, if
  `settings.autoPlayStories` and the stop has unheard core stories, play them (same as `playStop`). `finished`: log.
- Stories:
  - `playStop(stop)`: play the stop's unheard core stories in order. `playStory(stop, id)`: play that story now, then
    the stop's remaining unheard core stories. Starting a story stops whatever story or aside was playing.
  - With `settings.storyVoice` on and `story.audio` present: `playVoice(story.audio.src, { onTime, estimatedSeconds:
    story.audio.dur })`. The current paragraph is the last `i` with `time >= marks[i] - 0.15`. Report every change
    through `onNowPlaying({ kind: "story", stop, story, para, paused, manual: false })`.
  - Start the bed with the story's ambience (falling back to the stop's) when `settings.ambience` is on, and the
    story's mood when `settings.music` is on.
  - Read-by-tapping mode (`manual: true`): when `storyVoice` is off, the story has no audio, or playback fails with
    anything other than "stopped". Start at paragraph 0; `nextParagraph()` moves on; after the last paragraph the
    story ends.
  - When a story ends: log `story_end`, wait 2.5 s (divided by `deps.timeScale`), then start the next queued story,
    or if none is left call `onNowPlaying(null)` and fade the bed out over 1.5 s.
  - `togglePause()` pauses or resumes the voice channel and the `paused` flag. `skip()` ends the current story (log
    `story_stopped`, reason `skip`) and moves to the next queued one. `stopAll()` ends everything, clears the queue,
    stops the bed and calls `onNowPlaying(null)`.
  - `heard` holds the ids of stories and asides that have started.
- Passing-by stories: on an `aside` event, play it only if all of these hold, else log `aside_skipped` with the first
  failing reason:
  - `off`: `settings.asides` is not "off";
  - `heard`: not heard before;
  - `busy`: nothing is playing (`NowPlaying` is null and the mixer's voice channel is idle);
  - `not_riding`: `nav.status` is `riding` and `nav.offRoute` is false;
  - `near_stop`: `nav.toStop` is more than 150 m;
  - `near_turn`: `nav.toCue` is null or more than 80 m;
  - `too_soon`: at least 300 s (sparse) or 90 s (rich) on `deps.clock()` since the last aside ended, and at least 60 s
    since the ride's first `riding` state or the last `leave`.
  Playing an aside: `await mixer.chime()`, then `playVoice(aside.audio, { estimatedSeconds: words / 2.6 })` with
  `onNowPlaying({ kind: "aside", aside })`; when it ends `onNowPlaying(null)`. Log `aside_played`.
- Media Session: when a story starts in real mode, set title (story title), artist (stop name), album (pack name)
  and wire pause and play to `togglePause`. Guard every browser global so the director runs under Node.
- `dispose()` clears timers and handlers.

## Acceptance checks

Unit tests with the virtual mixer, a fake clock and the real pack JSON:

1. Arrival at stop 4 (Deptford, two core stories) with auto-play on plays both in order, with paragraph updates, then
   `onNowPlaying(null)`. With auto-play off nothing plays.
2. A cue arriving mid-story pauses the voice, speaks, and the story resumes and still finishes. Total story playhead
   is not shortened.
3. Each aside rule: one test per skip reason, and one aside that plays. Two asides 100 s apart: the second is skipped
   `too_soon` in sparse and played in rich.
4. `skip()` moves to the next queued story; `stopAll()` leaves nothing playing and the bed stopped.
5. Story voice off: manual mode, `nextParagraph()` walks to the end and the story ends.
6. The same cue is never spoken twice; a quiet cue is logged `cue_shown`.
7. Mixer: nav queue order and the cap of three; voice replaced rejects "stopped"; virtual timing respects `timeScale`.
