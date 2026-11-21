# Task 14: phrase marks in the narration

Owned paths: `tools/sound/find_breaks.py` (new), `tools/pack_sound.py` (new), `tools/build_pack.py` (one call),
`tools/content/<id>.breaks.json` (new, generated), `public/packs/*/pack.json` (written only by `tools/pack_sound.py`),
`tests/unit/packs.test.ts`, `docs/adding-a-route.md` (a short section).

Read first: `docs/build/it5-00-audio.md` sections 1 and 2, `src/types.ts` (`StoryAudio.breaks`, `Aside.breaks`).

## Goal

The mixer needs to know where each phrase of the narration starts, so a turn cue can wait for the end of a sentence
and the story can resume from the start of the one it cut. Find the pauses in the recordings we have (no
re-recording) and put them in both packs.

## Decisions

- A break is the second at which speech resumes after a pause: the `silence_end` of ffmpeg
  `silencedetect=noise=-38dB:d=0.28`, rounded to 0.01 s. Keep the leading silence (the first onset of the clip).
  Drop a silence that ends within 0.3 s of the end of the clip (that is the tail, not a phrase). Tried on
  `thames-loop/audio/greenwich-0.mp3`: the paragraph marks sit 0.00 to 0.05 s before a break.
- For every story, each paragraph mark is a phrase start by definition. If no break lies within 0.15 s of a mark,
  add the mark itself as a break and print a line saying so.
- `tools/sound/find_breaks.py <pack_id>` writes `tools/content/<pack_id>.breaks.json`:
  `{ "<path in the pack folder>": { "dur": 71.14, "breaks": [1.63, 3.34, ...] }, ... }` for every story clip
  (`audio/*.mp3` used by a story) and every aside clip (`asides/<id>.mp3`). Keyed by file, not by story id: two stories
  can share a clip (`home-0.mp3`) and pack ids can differ from content ids. `dur` comes from ffprobe. Sorted keys,
  one file per line so diffs stay readable.
- `tools/pack_sound.py`: the single place that writes sound fields into a pack, used two ways:
  - as a module: `apply(pack: dict, pack_id: str) -> list[str]` returns problems (empty when fine) and fills
    `story.audio.breaks` and `aside.breaks` from the breaks file. Keep it as separate steps
    (`apply_breaks`, and leave room for task 19 to add `apply_music`, `apply_sfx`, `apply_ambience`).
  - as a command: `python3 tools/pack_sound.py <pack_id>` loads `public/packs/<id>/pack.json`, applies, and writes it
    back with `json.dump(..., separators=(",", ":"), ensure_ascii=False)` like `build_pack.py` does. On any problem
    it prints them and writes nothing. Check first that loading and dumping an unchanged pack is byte-identical, so
    the command changes nothing but the sound fields.
  - Why: a full `build_pack.py` run needs the cached OpenStreetMap extracts, which are not in the repo, and a fresh
    download would move lines and cues. Sound fields must be updatable without touching the map work.
- `tools/build_pack.py` calls `pack_sound.apply(pack, PACK_ID)` just before it writes `pack.json`, adding any problems
  to its list and stopping the same way it does for other content problems.
- Validation in `apply_breaks`: ascending; every break in `[0, dur)`; every paragraph mark of a story within 0.15 s of
  a break; a story or aside clip with no entry in the breaks file is a problem (run `find_breaks.py`).
- Run both: `python3 tools/sound/find_breaks.py thames-loop`, `... royal-docks`, then `tools/pack_sound.py` for each.

## Acceptance checks

1. Both packs: every story's `audio.breaks` and every aside's `breaks` present, ascending, inside the clip.
2. Unit test in `tests/unit/packs.test.ts`, for every pack in the index: the checks of item 1; every paragraph mark
   within 0.15 s of a break; on average at least one break per 12 s of clip (a sanity check that the finder ran).
3. `git diff --stat public/packs` shows only `pack.json` changes, and a JSON diff of each pack before and after shows
   only added `breaks` keys (show this in the report).
4. `docs/adding-a-route.md`: after narration, run `find_breaks.py` then `pack_sound.py`.
5. `npm run check` passes.
