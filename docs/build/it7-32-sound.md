# Task 32: sound that stops, and paragraph steps (mixer and director)

Owned paths: `src/audio/mixer.ts`, `src/audio/bed.ts`, `src/audio/clips.ts` (only if needed), `src/story/director.ts`,
`tests/unit/mixer.test.ts`, `tests/unit/director.test.ts`, `tests/unit/timeline.ts`, `tests/unit/ride.integration.test.ts`
(only where the new timings change an expectation), new `tests/unit/sound-policy.test.ts`.

Not: anything in `src/ui`, `src/tour`, `src/types.ts`, `src/state.ts`, `src/ride.ts`.

Read first: `docs/build/it7-00-overview.md` (sections 2 and 3, the executor rules), the Mixer and Director contracts
in `src/types.ts` (new: `seekVoiceTo`, `stopEffects`, `MixerOptions.owner`, `MixerOwner`, `LiveMixer`,
`Director.stepPara`, and the rewritten docs of `togglePause`, `skip`, `stopAll`, `dispose`), the header comment of
`src/audio/mixer.ts` (the voice state machine), `src/audio/bed.ts`, `src/story/director.ts`, `tests/unit/timeline.ts`,
`docs/build/it5-00-audio.md` (the sound design this task amends).

## Goal

A sound ends when the rider stops or leaves what started it, and a stop the rider asks for is silent. A story can be
moved on or back by a paragraph, with the voice jumping to the paragraph's start. Every mixer can say what it is
sounding, so the dead-end hunt can prove nothing is left playing.

## Decisions

### Mixer (`mixer.ts`, `bed.ts`)

1. `seekVoiceTo(seconds)`: the exact target, clamped to 0 and the clip's length; no snapping to breaks. Share the code
   with `seekVoice` (which becomes "work out the target, then seek to it"). In each phase: in or playing, fade out
   (reason seek) and come back in at the target; out for a seek, retarget; silent (held by nav or the rider's pause),
   set the cut to the exact target so it resumes there and stays paused if paused; loading (not started yet, for
   example waiting for a turn cue), start from the target when it starts. Report `onTime(target)` at once, as
   `seekVoice` does.
2. `stopEffects(fade = 0.3)`: `bed.ts` keeps each effect it starts (source and gain) until it ends; `stopEffects` ramps
   their gains to 0 over `fade` and stops them just after; each one's existing `onended` reports `effect off`. Effects
   still loading when it is called are dropped. Virtual mode: the mixer keeps its effect timers, cancels them and logs
   `effect off` at the end of the fade.
3. `dispose()`: first log `off` at that moment for everything on the timeline still on (voice, nav, signal,
   ambience, music, effect, the soundscape's own `bed:*` one-shots), then release as now, then leave the live list.
4. Live list: a module-level set of live mixers. `createMixer` adds itself with `opts.owner ?? "unknown"`; `dispose`
   removes it. Export `liveMixers(): LiveMixer[]` and set `window.__verstaSound = { live: liveMixers }` where `window`
   exists. `sounding` comes from a map of open sounds kept in `logEvent` (key `"<ch>:<src>"`, count of ons minus offs,
   listed while above 0), not from scanning the timeline, which is capped at 5000 entries.

### Director (`director.ts`)

1. `stopAll()` (the rider's Back or Stop, and `endRide`): as the contract says. Cut the story and its queue, cancel the
   arrival timer and a passing-by story that is chiming or playing, `stopVoice(0.15)`, `stopEffects(0.3)`, the bed
   over 1.5 s, no signal, `finishAfterStories = false`, clear the media session, `onNowPlaying(null)`. Log
   `story_stopped` with reason `stop_all` when a story was cut.
2. `skip()`: with another story queued, as now. With none, close in silence: log `story_stopped` `skip` (unless the
   story had already ended), `stopVoice`, `stopEffects(0.3)`, the bed over 1.5 s, no close signal, no linger, no
   finish flourish, `onNowPlaying(null)`. This holds in the 2.5 s gap after a story ended by itself too.
3. A story that ends by itself with nothing queued (the end gap runs out): the close signal (when the soundscape
   setting is on) and the linger, now `LINGER_SECONDS = 8` and `LINGER_FADE = 4`. The finish flourish at the last
   stop as now.
4. An arrival that starts no story: `ARRIVAL_BED_SECONDS = 15`, then the 4 s fade.
5. `togglePause()`: pausing also stops the story's effects (0.3 s) and fades the bed to silence over 1 s, forgetting
   `bedKey` and clearing the linger and soundscape-alone timers; resuming brings the story's bed back through
   `startBed` (the mixer's usual fade in), unless the rider has ridden away from the stop (`leftStop`). Read-by-tapping
   stories: unchanged (no pause).
6. `stepPara(delta)`:
   - Only for the story on screen while it has not ended; nothing for a passing-by story or with nothing on screen.
   - `delta = +1` on the last paragraph: `skip()`. `delta = -1` on the first: back to its start.
   - Read by tapping: show the paragraph (`para`), fire its effects as `nextParagraph` does, emit.
   - Recorded: target `p`; seek the voice with `seekVoiceTo(max(0, marks[p] - 0.1))`; set `para = p` and the
     playhead, emit at once.
   - Effects: those of paragraphs before `p` are marked fired (never sound); those after `p` are armed again; those of
     `p` sound at once if the story is playing, and are marked fired if it is paused. Set the marks before seeking,
     since the seek reports `onTime` at once.
   - A paused story stays paused at the new place.
7. Nothing else changes: turn cues, asides, arrivals, the yield to cues, leaving a stop.

## Acceptance checks

Unit, on the virtual mixer with fake timers (`tests/unit/sound-policy.test.ts` and the existing files):

1. `stopAll` at each moment of a stop (the arrival lead, a story playing, paused, held for a turn cue, an aside
   chiming, an aside playing): within 2 s every `on` on the timeline has its `off` except turn speech already queued,
   and no `signal` is logged after the stop.
2. `skip` with nothing queued: no close signal; ambience and music off within 2 s. With a story queued: it starts.
3. A story that ends by itself: the close signal, and the bed off within 12.5 s of the end gap running out.
4. An arrival with auto-play off: the bed off within 20 s.
5. Pause: the bed off within 1.2 s and effects within 0.5 s; Resume: the voice and the bed on again.
6. `stepPara`: +1 and -1 land the voice at the right mark (the timeline's `pos` at the next voice `on`) and set
   `para`; +1 on the last does what `skip` does; -1 on the first restarts; read-by-tapping moves `para`; a paused story
   stays paused; jumping over a paragraph with an effect never fires it; landing on one fires it (playing) or not
   (paused).
7. `seekVoiceTo` while playing, while held for a turn cue, while paused, before the clip has started.
8. `dispose` closes every open sound on the timeline; `liveMixers()` lists a mixer with its owner and what it sounds,
   and drops it on dispose.
9. The existing tests still pass: the no-overlap fuzz test, the whole-ride hunt in `ride.integration.test.ts` (adapt
   only expectations that encode the old 20 s and 30 s timings, and say which in the report).
10. `npm run check` passes.
