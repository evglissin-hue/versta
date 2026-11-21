# Task 15: the mixer yields gracefully

Owned paths: `src/audio/mixer.ts`, `src/audio/clips.ts`, `src/audio/graph.ts`, `src/audio/bed.ts`,
`src/audio/loops.ts`, `src/audio/synth.ts`, `tests/unit/mixer.test.ts`.
Not yours: `src/audio/soundscapes.ts` (task 16 owns the recipes and removes the generated music), `src/types.ts`
(master; the contract is already in place), `src/story/director.ts` (task 18).

Read first: `docs/build/it5-00-audio.md` sections 2, 3 and 7, then the `Mixer`, `MixerOptions`, `SoundEvent` and
`SignalName` contracts in `src/types.ts`, and `src/audio/catalogue.json`. The master branch carries an interim shim in
`mixer.ts` (signal, playEffect, preload); replace it.

## Goal

No hard cuts anywhere, no speech over speech, and a turn cue that waits for the end of a sentence when there is time.
Real sound files for signals, effects and music. A sound timeline that the tests and the dead-end hunt can read.

## Decisions

### Voice channel (stories and asides)

Constants: fade out 0.15 s, fade in 0.20 s, wait for a break at most 3 s of clip time, replay at most 6 s back,
fixed step back 1.5 s, long pause 20 s (mixer clock), resume 250 ms after the nav queue empties.

- Every start, pause, resume, stop, seek and yield is a gain ramp: on a per-bus fader `GainNode` in the graph when the
  element is routed through Web Audio (`linearRampToValueAtTime`), else on `element.volume` in small steps
  (iOS ignores `volume`; that is accepted).
- `playVoice` while a clip is loaded: the old clip fades out, then the new one fades in. Never both at once.
- `stopVoice(fade = 0.15)`: `done` rejects with "stopped" at once; the sound fades over `fade` and the clip is then
  dropped. The director uses 0.4 s when an arrival cuts an aside.
- Breaks: `opts.breaks` (seconds where a phrase starts, speech onset). The fades sit in the pause before an onset:
  - yield at break `b`: start fading out at clip time `b - 0.20`, silent by `b - 0.05`;
  - resume from break `b`: seek to `max(0, b - 0.25)` and fade in over 0.20 s.
- `pauseVoice` (the rider): fade out, remember the position where the fade began and the clock time.
  `resumeVoice`: if the pause lasted more than 20 s on the mixer clock, resume from the replay point (below) of that
  position; else from the position itself. Fade in.
- `seekVoice(delta)`: fade out, seek, fade in. Going back with breaks known: land on the last break at or before
  `position + delta` (resume form, `b - 0.25`), or 0 when there is none. Forward: plain. Report `onTime` at once.
- Replay point of a cut position `c`: the last break `b <= c` with `c - b <= 6` gives `b - 0.25`; with no such
  break (or no breaks at all) `max(0, c - 1.5)`.

### Nav channel (cues, system clips, signals)

- A FIFO queue as now (keep the "at most three waiting" rule). Signals (`signal(name)`) are queue entries too, file
  `${import.meta.env.BASE_URL}sounds/signals/<name>.mp3`. A signal that fails to load counts as sounded (resolves).
- A nav entry arriving while the voice is sounding:
  - `urgent: true`, or the clip has no breaks, or the next break is more than 3 s of clip time ahead: fade the voice
    out at once; when it is silent, the nav queue speaks; the voice resumes from the replay point of the position
    where the fade began.
  - otherwise: let the narration run to that next break (yield form above), then the queue speaks, then the voice
    resumes from that break (resume form).
  - an urgent entry arriving while the mixer waits for a break cuts the wait short (fade at once, replay point).
- Nothing on the nav channel starts until the voice is silent (its fade has finished). The voice comes back 250 ms
  after the queue empties, with its fade in. A voice clip started while the queue is busy waits (as now).
- Gapless pairs: the distance call ("In one hundred metres,") and its cue must sound as one utterance, at most
  150 ms apart. Use two nav elements in turn: while one plays, the next waiting entry is loaded on the other
  (`src` set, `preload = "auto"`, `load()`), and it starts on the first one's `ended`. Route both through Web Audio
  (`graph.route(el, "nav")` works for each). `unlock()` primes all three elements.
- `navBusy` is true while a nav entry (cue or signal) is sounding or waiting.

### Signals and effects

- `signal(name)`: enqueue as above; the promise resolves when it has ended (or failed). No generated chime any more.
  `tick()` stays generated, as now.
- `playEffect(name, { level })`: a one-shot decoded buffer (`fx/<name>`) on the bed bus input, so the pocket carves it.
  Designed level `EFFECT_LEVEL` (start at 0.7; the master tunes it in the quality check) times `level`. If the buffer
  is not decoded yet, load it and play it only if it is ready within 0.5 s; else drop it. Effects do not hold the voice.
- In real mode `unlock()` starts decoding every signal and every effect in the background (they are small).

### The bed

- `startBed(ambience, music)` compares with what is playing, per layer:
  - same name: leave the layer alone (no restart, no fade);
  - changed: the old layer fades out and the new one fades in over about 2.5 s (crossfade);
  - from nothing: fade in over about 3 s;
  - null: that layer fades out over 2.5 s.
- `stopBed(fade = 1)`: every layer reaches silence `fade` seconds after the call (use a ramp that really ends there;
  today `endSession` uses `fade` as a time constant, so silence takes five times as long). Sources stop just after.
- Music: `music/<theme>` from the loop library, a looping `AudioBufferSourceNode` on its own session at `MUS_LEVEL`
  (keep 0.55 to start; the master tunes it). A theme that fails to load means no music. Stop calling `buildMusic`
  (task 16 deletes it from `soundscapes.ts`); `bed.start` takes the theme name.
- Ambience: `buildAmbience(x, session, name, lib)` from `soundscapes.ts`, as now. Task 16 adds `pan` and sparse
  one-shot parts to the recipes and uses `lib.get("fx/<name>")` for them; keep `LoopLib.get` working for any path.

### The loop library (`loops.ts`)

- Names are paths under `sounds/` without `.mp3`: `water`, `music/noir`, `fx/ship-horn`, `signals/aside`.
  - plain names: a soundscape loop, joined with the equal-power crossfade as now;
  - `music/...`: the file is one loop plus a 1.5 s tail that repeats the loop's start (task 17 renders it so). Join
    with an equal-gain (linear) crossfade of the tail over the start, and drop the tail. Export the join as a pure
    function (`joinMusicLoop`) and unit test it: a signal made of a repeated pattern plus tail joins without a jump;
  - `fx/...` and `signals/...`: one-shots, kept as decoded.
- Memory: do not decode every loop at unlock any more (the new library is too large). Decode a soundscape's loops when
  its bed starts (wait up to 1.5 s as now) or when `preload("ambience:<name>")` / `preload("music:<theme>")` asks.
  Keep decoded buffers bounded: drop the least recently used ones not in the playing bed once more than about
  100 MB of samples are held.

### Preload

- `preload(srcs)`: clip paths are fetched once each (resolve like the clips; read the body so it lands in the HTTP
  cache and, through the service worker, in `versta-packs`); `ambience:` and `music:` entries decode as above.
  Remember what was asked so repeats are free. Errors are swallowed.
- Virtual mode: record the requests (dedupe) and expose them as `preloaded: readonly string[]` on `MixerWithBed`.

### The sound timeline

- `MixerWithBed.timeline: readonly SoundEvent[]` in both modes (cap at 5000 entries, drop the oldest), stamped with
  `opts.clock ?? Date.now`. Real mode also exposes it as `window.__verstaAudio.timeline()` next to `levels()`.
- voice: `on` when its fade in starts (with `pos`), `off` when its fade out has finished or the clip ended (with
  `pos`). nav: `on` at start, `off` at end, `src` the clip path. signal: `ch: "signal"`, `src` the name.
  effect: `on` at start, `off` after its length (virtual: catalogue `seconds`). ambience and music: `on` when the
  layer starts fading in, `off` when its fade out has finished (virtual: at call time plus the fade).
- `MixerWithBed.bed` stays `{ ambience, music } | null` (what the director asked for last).

### Virtual mode

- Fades take their time on the (fake) clock divided by `timeScale`. Clips play for `estimatedSeconds / timeScale`;
  signals and effects for the catalogue `seconds / timeScale` (import `catalogue.json`).
- Model the playhead exactly, so the break logic is testable: a virtual clip reports its position, can seek to an
  absolute second, and can fire a callback at a given clip time.

### Dispose

- `dispose()`: stop everything at once, detach the elements, `bed.dispose()` (closes the context). Safe to call twice.

## Acceptance checks (unit, virtual mode, fake timers)

1. A cue (not urgent) arriving 2 s before a break: the voice `off` lands at `b - 0.05` (within 0.05 s of clip time),
   the nav `on` is not before it, and after the nav `off` the voice `on` comes within 0.5 s with `pos` within 0.05 s
   of `b - 0.25`.
2. A cue (not urgent) with the next break 5 s ahead: the voice goes silent within 0.2 s of the call, and resumes at
   the last break at or before the cut when it is within 6 s; with none within 6 s, 1.5 s before the cut.
3. An urgent cue with a break 1 s ahead never waits. A clip with no breaks: fade at once, resume 1.5 s back.
4. An urgent cue arriving during a wait cuts the wait short.
5. Two nav clips queued together (distance call then cue): the second `on` is at most 150 ms after the first `off`.
6. `signal("arrive")` then `playNav("arrive.mp3")`: the signal sounds first, the clip after, the promise resolves at
   the end of the signal, and both hold the voice.
7. Pause for 30 s on the mixer clock: resume from the phrase start; pause for 5 s: resume where it paused.
8. `seekVoice(-15)` with breaks lands on a break (`b - 0.25`), without breaks on `position - 15`.
9. `stopVoice()` then `playVoice()`: the new `on` is not before the old `off`; `done` of the old one rejected at once.
10. Fuzz: a seeded random mix of playVoice (with and without breaks), playNav (urgent or not), signal, pause,
    resume, seek, stopVoice over 3 minutes, 200 seeds: on the timeline no two of voice, nav and signal are ever
    `on` at the same time, every `on` has its `off`, and the voice is never left held once the queue is empty.
11. Bed: same ambience with a new theme leaves the ambience untouched and crossfades the music; `stopBed(6)` puts
    every layer `off` 6 s after the call; `startBed(null, null)` fades everything.
12. `preload` dedupes and records; `playEffect` writes `effect` on/off with the catalogue length; `dispose` twice is safe.
13. Existing mixer tests still pass where the behaviour did not change (adapt the ones about the 250 ms resume and
    the old chime).
14. `npm run check` passes. In the report, say how a real browser was or was not exercised.
