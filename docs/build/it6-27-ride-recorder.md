# Task 27: the ride recorder and replay

Owned paths: `src/record/` (new: `recorder.ts`, `store.ts`, tests beside them), `src/ui/Recordings.tsx` (new),
`src/ui/SoundSheet.tsx` (one row that opens it), `src/ui/Home.tsx` (one footer link that opens it),
`src/ui/uistate.ts` (one signal), `src/ui/back.ts` (one line), `src/app.tsx` (one line that renders the sheet,
beside the Sound check line: task 22 edits another part of this file), `src/ui/Demo.tsx` (one step),
`src/styles/app.css`, `tests/unit/replay.test.ts` (new), `tests/fixtures/rides/` (new), `tests/e2e/smoke.spec.ts`
(one test).
Not: `src/ride.ts`, `src/types.ts` (master). Do not add dependencies.

Read first: `docs/build/it6-00-overview.md` section 7, `RideRecording` in `src/types.ts`, `src/ride.ts` (where fixes,
events, log entries and taps happen: the master wires your hooks there), `tests/unit/ride.integration.test.ts` and
`tests/unit/timeline.ts` (the dead-end checks to reuse), `src/ui/SoundSheet.tsx`, `src/ui/SoundCheck.tsx` (how a
full-height sheet is opened and closed).

## Goal

Every real ride leaves a recording on the phone; the rider can send it; dropping it into the repo turns it into a
test that replays the ride through the engine and director.

## Decisions

- `recorder.ts` exports `beginRecording(meta: { packId; version; startAt; app }): RideRecorder` with `fix(f)`,
  `events(at, evs)`, `log(entry)`, `tap(what, arg?)`, `end()`. It builds a `RideRecording` in memory and saves it to
  IndexedDB (`store.ts`, database `versta-rides`, one record per ride keyed by `startedAt`) every 30 s and at `end()`.
  Keep the last 10 rides; delete older ones. Never throws into the ride: every storage error is swallowed.
- `store.ts`: `listRecordings()` (newest first: startedAt, packId, endedAt, fixes count, km ridden), `getRecording(id)`,
  `deleteRecording(id)`, `recordingFile(r)` → `{ name: "versta-ride-<pack>-<yyyy-mm-dd-hhmm>.json", text }`.
- The master wires the hooks in `src/ride.ts` after merging (real rides only, not simulated ones).
- `Recordings.tsx`: a full-height sheet "Ride recordings", opened from Sound and settings by a row "Ride recordings"
  and from the Home footer by a link "Ride recordings" (after the Sound check link), with hint
  "What the phone saw on your last rides. Send one when something went wrong." Each recording: route name, date and
  time, duration, km. Buttons: "Save file" (on the web: download the JSON; on the Android app call
  `exportRecordingNative(file)`, a function you leave in `src/record/store.ts` that throws "not yet": the master
  fills it with a share sheet) and "Delete". Empty state: "No rides recorded yet. Your next ride will be."
- `tests/unit/replay.test.ts`: for every `tests/fixtures/rides/*.json`, build the engine and the director with the
  virtual mixer and a fake clock at the recording's times, feed its fixes (with `startAt` if not 0), and check:
  the dead-end checks of `ride.integration` (no speech overlaps, late cues, held voice, bed after leave), no
  `wrong_way` or `off_route` the recording itself did not have, every stop the recording arrived at is arrived at.
  Print a short divergence report (events the replay produced that the recording did not, and the reverse).
- Seed `tests/fixtures/rides/` with one recording made from a simulated Royal Docks ride at 5 m/s with 4 m GPS
  noise (generate it in the test helper once and commit the JSON, under 2 MB; thin the fixes to one per second).

## Acceptance checks

1. Unit: the recorder keeps every fix and event, saves on its timer and at end, keeps only 10, survives a store
   that throws.
2. Replay passes on the seeded fixture and fails on a doctored copy where a fix jumps 300 m.
3. e2e: Sound and settings, then Ride recordings, shows the empty state; Back closes it.
4. Screenshot of the sheet with two fake recordings (demo step `recordings`) at 390 by 844, light and dark.
5. `npm run check` passes.
