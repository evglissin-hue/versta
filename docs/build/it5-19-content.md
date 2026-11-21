# Task 19: music and effects for every story, validator, offline list

Owned paths: `tools/content/*.route.json` (story `music` and `sfx`, Royal Docks stop `amb`), `tools/pack_sound.py`
(add `apply_music`, `apply_sfx`, `apply_ambience`), `tools/build_pack.py` (ambience names from the catalogue),
`public/packs/*/pack.json` (written only by `tools/pack_sound.py`), `src/offline.ts`, `src/offline.test.ts`,
`tests/unit/packs.test.ts`, `docs/adding-a-route.md`.
Starts after tasks 14, 16 and 17 are merged (it needs `pack_sound.py`, the recipes and the effect and music files).

Read first: `docs/build/it5-00-audio.md` sections 5 and 6, `src/types.ts` (`Story.music`, `Story.sfx`),
`src/audio/catalogue.json`, `tools/pack_sound.py`, `src/audio/soundscapes.ts` (`loopsFor`), `src/offline.ts`.

## Goal

Every story names its music theme; the stories that earn one get one to three effects in their pauses; Royal Docks
gets its own soundscapes; the packs are rebuilt with all of it, validated; and "Save for offline" saves every sound a
pack can play.

## Decisions

### Content (authored by the master: enter exactly this)

Story keys are the pack story ids. `sfx` entries are `[para, effect]`, written in the route file as
`{"para": p, "name": "<effect>"}`. In the route files the last stop of both routes has content id `home`
(pack id `wenlock-basin`).

| Story | music | sfx |
| --- | --- | --- |
| thames-loop / tower-bridge-0 | voyage | 1 ship-horn, 2 steam-engine |
| tower-bridge-1 | noir | |
| shad-thames-0 | river | |
| mayflower-0 | voyage | 2 sail-flap |
| greenland-dock-0 | voyage | 2 ice-creak |
| peter-the-great-0 | russia | 3 hammer, 7 adze |
| peter-the-great-1 | noir | 4 tankards |
| greenwich-0 | voyage | |
| greenwich-1 | solemn | 1 oars, 5 distant-cannon |
| greenwich-2 | noir | |
| foot-tunnel-0 | river | |
| great-eastern-0 | voyage | 3 chain, 6 ship-horn |
| canary-wharf-0 | solemn | |
| the-grapes-0 | river | 2 water-lap, 5 tankards |
| prospect-of-whitby-0 | solemn | 3 crowd, 6 tankards |
| whitechapel-0 | russia | |
| whitechapel-1 | bright | 2 parrots, 4 big-bell |
| wenlock-basin-0 (Thames) | bright | |
| royal-docks / bunhill-fields-0 | solemn | |
| soviet-house-0 | noir | 2 fire-crackle, 4 telegraph |
| cable-street-0 | bright | 3 crowd |
| poplar-0 | solemn | |
| poplar-1 | noir | |
| east-india-dock-0 | russia | 2 crates, 5 ship-horn |
| east-india-dock-1 | voyage | 2 sail-flap, 4 waders |
| royal-victoria-dock-0 | voyage | 3 ship-horn |
| royal-victoria-dock-1 | solemn | |
| three-mills-0 | bright | 1 water-wheel, 4 bubbling |
| abbey-mills-0 | river | 4 steam-engine, 5 water-flow |
| mile-end-0 | noir | 4 telegraph |
| sidney-street-0 | russia | 4 fire-crackle |
| wenlock-basin-0 (Royal Docks) | bright | |

Royal Docks soundscapes (route file `amb`): bunhill-fields `burial`, soviet-house `office`, cable-street `rally`,
poplar `park`, east-india-dock `basin`, royal-victoria-dock `working-dock`, three-mills `mill`, abbey-mills `pumping`,
mile-end `towpath`, sidney-street `oldstreet`, home `canal` (unchanged). Story overrides: poplar-1 `clock` becomes
`office`; royal-victoria-dock-1 stays `solemn`; the home story stays `tavern`. Thames Loop soundscapes are unchanged.

If task 16 reported an effect as not found, leave that one entry out and say so.

### `tools/pack_sound.py`

- `apply_music`: copies `music` from the route file to each pack story; a name not in `catalogue.json` `music` is a
  problem; a story without one is a warning (the app falls back to the mood).
- `apply_sfx`: copies `sfx`; problems: `para` outside the story's paragraphs, a name not in the catalogue `effects`,
  `public/sounds/fx/<name>.mp3` missing, more than three, two effects whose places (`marks[para] - 1.2`) are less than
  10 s apart, a place before 0.
- `apply_ambience`: copies stop `amb` and story `amb` to `ambience`; a name not in the catalogue `soundscapes` is a
  problem.
- Run `python3 tools/pack_sound.py thames-loop` and `... royal-docks`. The pack JSON diff must show only these fields
  and the breaks of task 14.
- `tools/build_pack.py`: read soundscape names from `src/audio/catalogue.json` instead of parsing `soundscapes.ts`.

### Offline (`src/offline.ts`)

- Export `packSounds(pack: Pack): string[]`: paths under `sounds/` (no extension, as the loop library names them) of
  every sound the pack can play: the loops and sparse `fx/` layers of every soundscape used by a stop or a story
  (`loopsFor`), the music theme of every story (with the mood fallback), every story effect, and every signal.
- `savePackOffline` also saves these, as `${import.meta.env.BASE_URL}sounds/<path>.mp3`, into the `versta-sounds`
  cache the loop library reads (`src/audio/loops.ts`). Count them in the progress and the total.
- `removePackOffline`: sounds are shared; clear `versta-sounds` only when no pack is left saved (as with tiles).
- Unit test `packSounds` for both packs: every path exists under `public/sounds/`, every story's theme and effects
  are in, all four signals are in.

### Tests (`tests/unit/packs.test.ts`)

- For every pack: every story has a `music` in the catalogue; every `sfx` passes the rules above; every ambience
  name is in the catalogue and has a recipe.

### Docs

- `docs/adding-a-route.md`: a short section on sound: choosing `amb` from the catalogue, `music` per story, `sfx`
  rules (only sounds true to what the text says is happening, nothing that could be mistaken for traffic, no close
  gunshots or explosions, at least 10 s apart, at most three), then `find_breaks.py` and `pack_sound.py`.

## Acceptance checks

1. Both packs rebuilt with `pack_sound.py`; their JSON diff shows only `breaks`, `music`, `sfx` and `ambience` changes.
2. `npm run check` passes, including the new tests.
3. The report lists the number of stories with effects per pack and anything left out.
