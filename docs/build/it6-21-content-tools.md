# Task 21: content tooling, manifests, places.json, sounds credits

Owned paths: `tools/pack_manifest.py` (new), `tools/places.py` (new), `tools/build_pack.py` and `tools/pack_sound.py`
(call the two new tools last), `tools/sound/build_sounds.py` and `tools/music/render.py` (also write
`public/sounds/credits.json`), `public/packs/**` (written only by the tools), `public/places.json`,
`public/sounds/credits.json`, `tests/unit/packs.test.ts`, `tests/unit/places.test.ts` (new), `docs/adding-a-route.md`.

Read first: `docs/build/it6-00-overview.md` sections 1 and 6, the new types in `src/types.ts` (`PackIndexEntry`,
`PackManifest`, `Place`, `PlaceStory`, `PlacesFile`), `tools/build_pack.py` (how it writes index.json), `tools/pack_sound.py`,
`public/packs/*/pack.json`, `tests/unit/packs.ts`.

## Goal

Every route on the site carries a version, so an app can tell a new copy from the one it has; every place and story
of every route is in one library; and a downloaded sound can be credited.

## Decisions

- `tools/pack_manifest.py <id> [<id> ...]` (no argument: every pack in index.json):
  - Lists every file under `public/packs/<id>/` except `manifest.json`, paths relative to the pack folder with `/`,
    sorted. For each: bytes and sha256 (hex).
  - `version` = the first 16 hex characters of sha256 over the lines `path:sha256\n` in that order.
  - Writes `public/packs/<id>/manifest.json` as `{ "id", "version", "format": 1, "files": [...] }`, one file object
    per line (readable diffs).
  - Updates that pack's entry in `public/packs/index.json` in place (keep entry order and existing fields): `version`,
    `bytes` (sum), `format` 1, and `updated`: a UTC ISO date-time ("2026-11-22T15:24:00Z"), changed only when
    `version` changes (keep the old one otherwise, so rerunning is a no-op).
- `tools/places.py` writes `public/places.json` from every pack in index.json, in index order:
  - One place per stop: id `<pack>:<stop id>`, name, at, radius = the stop's `arriveRadius`, kind "stop", stories =
    the stop's stories in order (id, title, kind, audio = `audio.src`, dur = `audio.dur`, pic = `pic.src` if any).
    Stories without audio are left out; a stop left with none is left out.
  - One place per aside: id `<pack>:<aside id>`, name = the aside's title or name field (read the pack), at = its
    anchor, radius 60, kind "aside", one story (the aside, kind "aside").
  - `version` as for manifests: first 16 hex of sha256 of the places JSON without the version field (sorted keys).
  - Each place on one line.
- `build_pack.py` and `pack_sound.py` call `pack_manifest` for the pack they wrote, then `places`, as their last step.
  Run both tools now for both packs and commit the results. The only changes to existing files must be the new
  index fields.
- `public/sounds/credits.json`: the merged credits of `src/audio/credits-sounds.json` and `credits-music.json`
  (same objects), written by `build_sounds.py credits` and by `tools/music/render.py` after rendering. A unit test
  checks it equals the two source files merged, so a forgotten run fails `npm run check`.
- `docs/adding-a-route.md`: one short section: the manifest and places steps run by themselves; never edit those
  files by hand; what `updated` means.

## Acceptance checks

1. `tests/unit/packs.test.ts`: for every pack, the manifest lists exactly the files on disk with the right sizes
   and hashes (compute sha256 in the test with node:crypto), its `version` follows the rule, and the index entry's
   `version`, `bytes` and `format` match the manifest.
2. `tests/unit/places.test.ts`: places.json has a place for every stop with audio and every aside of every pack,
   ids unique, every `audio` path exists in its pack, radius > 0, version follows the rule.
3. Rerunning both tools changes nothing (check with git diff).
4. `npm run check` passes.
