# Adding a route

A route pack is built by Claude in a working session, then committed. The app only reads `public/packs/<id>/`.

1. Plan the line with the router (our own, over OpenStreetMap data), not with Komoot.
   - Put a first line in `tools/content/<id>.track.json`: `{"segments": {"1": [[lng, lat], ...], ...}, "old": {}}`, one
     polyline per segment, segment i leading to stop i, points about 12 m apart. A first line can come from any
     planner (Komoot planning was used for the Thames Loop); the router then improves the stretches you list.
   - List the segments to re-plan in `tools/content/<id>.plan.json`: for each, `why`, approximate `via` points
     ([lng, lat], in order; each is a gate the line must pass within `gate` metres, default 60), optional `avoid`
     (street name to a cost multiplier for that segment only) and `keep_old: true` to keep the first line when the
     router's is worse. A via point in the water or in a closed site only makes the line wander: check the picture.
   - `OSM_DIR=/tmp/osm python3 tools/fetch_osm.py <id> 700` downloads the OpenStreetMap extracts within 700 m of the
     line, the old line and the via points (one request per cell, with a pause, reusing what is on disk; `--dry`
     counts the missing cells first). The corridor graph needs 500 m, so fetch for the whole route.
   - `OSM_DIR=/tmp/osm python3 tools/plan_line.py <id>` routes the listed segments (`tools/router.py`: cycle routes and
     cycleways 0.6 per metre, quiet streets 1.0, tertiary 1.6, secondary 2.5, primary 4, walking sections 5, steps 20,
     everything within 60 m of the river x 0.8, turns cost a little) and rewrites the track file, keeping the first
     line under `old`. It prints, for the old and the new line, the length, the share on cycle routes, the metres of
     walking sections and of main roads, and the streets used. Read it as a rider would.
   - `OSM_DIR=/tmp/osm python3 tools/render_line.py <id> --all` draws `/tmp/line-<seg>.png` (old line grey, new line
     magenta, water blue, cycle routes green, walking sections ochre, stops numbered, cue streets named). Look at every
     picture: fix lines through water, pointless loops, and walking sections that a nearby street would avoid.
     `--box=lng0,lat0,lng1,lat1` draws a zoomed view.
2. Write the content: `tools/content/<id>.route.json` (stops and stories, see the Thames Loop file for the shape) and
   `<id>.asides.json` (passing-by stories, each anchored to a segment and a street name the route really uses).
   Follow the house style in `CLAUDE.md`. Check every fact. The number of stops is whatever the route file lists: the
   track needs segments 1 to stops - 1. Optional route fields: `card_blurb` (a shorter blurb for the Home card); on a
   stop, `pack_id` and `pack_name` (the id and name the stop gets in the pack, as the Thames Loop's `home` becomes
   `wenlock-basin`) and `arrive_radius` (metres, default 45: make it smaller when the first turn after the stop is closer than that, as on a\n   short out and back; the builder warns) and `fixed_segment` (`{"name", "kind", "len", "say"}`: the segment to this stop is a straight walk
   from the previous stop with that one cue, as through the Greenwich Foot Tunnel). Ambience names come from
   `RECIPES` in `src/audio/soundscapes.ts`.
3. Pictures: public domain works only (Wikimedia Commons is a good source). Look at every image before using it.
   Put them in `public/packs/<id>/img/` at about 820px wide, and list them with captions in `<id>.pics.json`, keyed
   `<id>` for the hero and `<id>/<stop id>-<story index>` for a story; each value is `[file, caption]` or
   `{"file": ..., "caption": ...}`. A story without a picture simply has no entry.
4. Map data: already fetched in step 1 (re-run `fetch_osm.py` after changing the line or the via points).
5. Narration of the stories: `python3 tools/narrate_stories.py <id>` records them with their paragraph marks into
   `public/packs/<id>/audio/` and `tools/content/<id>.audio.json` (keyed `<id>/<stop id>-<story index>`). It records only
   stories with no entry or no file: delete both to re-record one. Run this before the build, because the pack
   carries the marks. Pronunciations for new names can go in `tools/content/<id>.say.json` as
   `[["written", "spoken"], ...]`; both narration tools read it.
6. Build: `OSM_DIR=/tmp/osm python3 tools/build_pack.py <id>` writes `pack.json` (track, turn cues, asides, system clips,
   km) and `graph.json` (the corridor road graph the app uses to find a way back, about 360 KB, with a check that every
   stop and every 100 m of the line has a node within 40 m) and creates or updates the pack's whole entry in
   `public/packs/index.json` (id, name, mode, km, stops, hero, blurb, stories, asides, minutes), keeping pack order.
   Before any map work it checks the content and stops, writing nothing, with a list of every problem: a missing
   segment, a story without audio, a picture file that is not there, an unknown ambience, an aside on a segment the
   route does not have. It warns when a stop is more than 30 m from the line. `--out=DIR` writes the pack and an index
   under `DIR` instead, for a trial build that leaves `public/` alone. Never rebuild a pack whose cue audio is
   already recorded unless you mean to re-record its cues: map data moves on, and cue ids follow the line. Asides are
   anchored by their `street` when the line uses it, else by their `near` point ([lng, lat]; the builder warns when
   the line is more than 250 m from it). Read the printed cue list: it should read like directions a person would give.
7. More narration: `python3 tools/narrate.py <id>` records the turn cues, the arrival, off route, back on route and
   rerouting clips, the generic turn clips and the asides, deletes cue files the pack no longer uses, and sets the
   listening minutes in the index from the recorded files. Pass `--force` to record everything again.
   Then find the phrase marks: `python3 tools/sound/find_breaks.py <id>` writes `tools/content/<id>.breaks.json` (the
   second each phrase starts in every story and aside clip, from the pauses in the recording), and
   `python3 tools/pack_sound.py <id>` puts them into `pack.json` without touching the map work. `build_pack.py` runs the
   same step, so a pack built after narration needs the breaks file first. Run both again after re-recording a clip.
8. Run `npm run check` and the simulated rides (`npm run e2e`). The pack integrity checks
   (`tests/unit/packs.test.ts`), the whole rides with a detour (`tests/unit/ride.integration.test.ts`), the way-back
   search (`tests/unit/reroute.real.test.ts`) and the browser rides (`tests/e2e/ride.spec.ts`) run over every pack in
   the index, so a new pack needs no test change. On Home the packs show in index order; the demo screens
   (`/?demo=ride&step=...`) show the first pack, or the one named by `&pack=<id>`.

The voice, speeds and ffmpeg chain are in `tools/voice.py`, the one place to change the narrator. The narration tools
need the Kokoro model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`, from the `model-files-v1.0` release of
kokoro-onnx on GitHub) in `KOKORO_DIR` (default `/home/claude/kokoro`), the `kokoro-onnx` and `soundfile` Python
packages (`pip install --break-system-packages kokoro-onnx soundfile`), and `ffmpeg`. Every pack tool takes the pack
id as its first argument and defaults to `thames-loop`.
