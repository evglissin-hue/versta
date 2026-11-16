# Adding a route

A route pack is built by Claude in a working session, then committed. The app only reads `public/packs/<id>/`.

1. Plan the line. Ask Komoot (planning only) for the bike or walking route through the stops, in one or two legs,
   and save the GPX tracks as `tools/content/<id>.out.gpx` and `<id>.back.gpx`.
2. Write the content: `tools/content/<id>.route.json` (stops and stories, see the Thames Loop file for the shape) and
   `<id>.asides.json` (passing-by stories, each anchored to a segment and a street name the route really uses).
   Follow the house style in `CLAUDE.md`. Check every fact.
3. Pictures: public domain works only (Wikimedia Commons is a good source). Look at every image before using it.
   Put them in `public/packs/<id>/img/` at about 820px wide, and list them with captions in `<id>.pics.json`.
4. Map data: `OSM_DIR=/tmp/osm python3 tools/fetch_osm.py <id>` downloads the OpenStreetMap extracts along the line.
5. Narration: `python3 tools/narrate_stories.py` records the stories and their paragraph marks.
6. Build: `OSM_DIR=/tmp/osm python3 tools/build_pack.py` writes `pack.json` with the track, the turn cues and the
   anchored asides. Read the printed cue list: it should read like directions a person would give.
7. More narration: `python3 tools/narrate.py <id>` records the turn cues, the arrival clips and the asides.
8. Add the pack to `public/packs/index.json`, run `npm run check` and the simulated ride (`npm run e2e`).

The narration tools need the Kokoro model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) in `KOKORO_DIR`, the
`kokoro-onnx` and `soundfile` Python packages, and `ffmpeg`. The pack tools are currently written for one pack id;
generalising the paths is a small job for the second route.
