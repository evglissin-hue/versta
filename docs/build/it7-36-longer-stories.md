# Task 36: core stories a little longer

Goal: every core story in the three packs is a little longer, by real detail that a rider would want to hear,
without breaking any rule of the house style or the ride.

Owned paths: `tools/content/<id>.route.json` (core stories only), `tools/content/<id>.sources.json`,
`public/packs/<id>/audio/` and `tools/content/<id>.audio.json` (re-recorded), `tools/content/<id>.breaks.json`,
`tools/pack_content.py` (new).

## Decisions

- Each core story grows by about a quarter to a third, usually one new paragraph, placed where it reads best (not
  always at the end). Optional stories and passing-by stories do not change.
- House style (`CLAUDE.md`): history first, present tense, as if it is happening now; spies, intelligence and
  Russian history first where true to the place; no invented quotes or people; legends hedged as legends; no em or
  en dashes; numbers in words where the narrator needs them (the narration tools refuse digits other than years).
- Every new fact is checked against a source, and the source goes in `<id>.sources.json` (created for the Thames
  Loop, which has none yet) under the story's key.
- Re-record each changed story with `tools/narrate_stories.py` (delete its entry in `<id>.audio.json` and its mp3
  first), then `tools/sound/find_breaks.py <id>`, then put the stories, breaks and sound into the pack.
- New tool `tools/pack_content.py <id>`: refreshes the content of an existing `pack.json` (stop names and notes,
  stories with their audio marks and pictures) from the route, audio and pictures files, without the map work, then
  applies the sound fields, the manifest, the index entry (stories, minutes) and the places library. It refuses when
  a stop was added, removed, renamed by id or moved: those need `build_pack.py`.
- Cue sheets (`sfx` paragraph numbers) are kept pointing at the same text when a paragraph is inserted before them.
- Close stops: a longer story must not be cut off by the next arrival. The whole-ride tests check that every story
  that starts also ends with no `story_stopped`; where it fails, the addition is shortened, not the rule.

## Acceptance

- `npm run check` and the whole-ride tests on every pack (no `story_stopped`), and the browser rides.
- Word counts before and after in the rounds file: each core story 20 to 40 percent longer.
- Every new fact has a source entry.
