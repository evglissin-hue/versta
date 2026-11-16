# Task 11: guidance you can follow without looking

Owned paths: `src/nav/engine.ts`, `src/geo.ts`, `src/story/director.ts`, `src/audio/mixer.ts`, `src/audio/graph.ts`,
`src/audio/clips.ts`, `src/audio/bed.ts`, `tests/unit/nav.test.ts`, `tests/unit/director.test.ts`,
`tests/unit/mixer.test.ts`.

## Goal

With the phone in a pocket, the spoken guidance is all the rider has. Today a turn is announced once, with no
distance, and nothing marks the turn itself. Make it say how far, mark the moment, and notice a rider going the
wrong way.

## Decisions

Engine (`src/nav/engine.ts`, still pure):

- `state.speedAvg`: an exponential average of speed with a time constant of about 20 s. Use `fix.speed` when given,
  else distance over time between fixes. Null until 5 s of data. Ignore fixes worse than `maxAccuracy`.
- Approach distance for a cue becomes `max(cueApproachMin, speedAvg * cueApproachSeconds)` with the options changed
  to `cueApproachSeconds: 15` and `cueApproachMin: 70` (4 m/s when `speedAvg` is null), capped at 320 m and at the
  distance from the previous cue minus 15 m (never announce a turn before the one in front of it has been reached).
- `state.thenCue` and `state.toThen`: the cue after `nextCue` when it lies within 120 m of it, else null.
- Wrong way: while `riding` and not off route, if for 10 s of fixes the rider moves faster than 1.5 m/s with a
  heading (from `fix.heading`, else the bearing between fixes) more than 135 degrees from `routeBearing`, and
  `alongSeg` has gone back by at least 40 m in that spell, set `state.wrongWay` and emit `wrong_way` once. Clear it
  after 5 s within 60 degrees of the route, or on arrival, jump or going off route. Not within 60 m of a stop, where
  people circle about.
- The `cue` events are unchanged, but the `approach` event must be emitted with the state already updated, so
  `state.toCue` is the distance at the moment of the announcement (the director reads it from `nav`).

Director (`src/story/director.ts`):

- Approach announcement: when `pack.system.distances` exists and `nav.toCue` is 40 m or more, first play the
  distance clip for the largest key not above `nav.toCue + 15`, then the cue's own clip; both through `playNav`, in
  that order. Under 40 m, or with no distances in the pack, just the cue clip as now.
- At the turn (`phase: "now"`): for a cue whose approach was spoken, call `mixer.tick?.()` and say nothing. For a
  cue never announced, speak it as now. Depart cues unchanged.
- `wrong_way`: speak `pack.system.wrongWay` when present and `navVoice` is on; log `wrong_way`.
- A found detour is announced ("rerouting") at most once every 60 s on the director's clock, however often the
  engine recomputes.
- `rewind(seconds)`: `mixer.seekVoice?.(-seconds)` for the story or aside that is playing; the paragraph follows
  the new playhead. Does nothing in read-by-tapping mode.

Mixer (`src/audio/**`):

- `tick()`: two short soft clicks about 120 ms apart on the nav bus (generated; in virtual mode a no-op that counts
  calls for tests). It must not pause the voice channel.
- `seekVoice(delta)`: move the voice playhead, clamped to the clip. Virtual mode too.
- `setBedLevel(level)`: scales the bed bus (soundscape and music) around its designed level, smoothed over 300 ms,
  remembered across beds. The pocket still works on top of it.

## Acceptance checks

Unit tests (the engine tests run on the frozen fixture pack, as now):

1. `speedAvg` settles near 5 on a 5 m/s ride and near 0 when standing.
2. Approach distances grow with speed: at 3 m/s about 70 m, at 8 m/s about 120 m, never before the previous cue.
3. `thenCue` is set for two cues 80 m apart and null for two 300 m apart.
4. Riding a segment backwards for 15 s gives one `wrong_way` and `state.wrongWay`; turning round clears it; no
   `wrong_way` on a normal ride, at a stop, or when off route.
5. Director: a 110 m approach plays "in-100" then the cue clip, in order; a 30 m approach plays only the cue; the
   `now` phase ticks and stays silent; an unannounced cue is spoken at `now`; rerouting is not repeated within 60 s;
   wrong-way clip once.
6. `rewind(15)` moves the playhead back and the paragraph follows; mixer `seekVoice` clamps at both ends.
7. Every existing test still passes, including `tests/unit/ride.integration.test.ts` and `reroute.real.test.ts`
   untouched. If the whole-ride tests need the new behaviour reflected (they assert every cue is spoken once), keep
   their meaning: every spoken cue still logs `cue_spoken` exactly once.
