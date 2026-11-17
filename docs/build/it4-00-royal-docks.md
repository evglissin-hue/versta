# Iteration 4: second route, "Royal Docks Loop" (pack id `royal-docks`)

Request (Evgeny, 17 Nov 2026): after riding the Thames Loop he wants more rides like it: mostly on bike lanes, open to
the sun, in a different direction, 1.5 to 2 hours of riding. He picked the east ride: out on Cycleway 3 through Cable
Street and Poplar to the Royal Docks, back on the Greenway and Cycleway 2. He rides it in the next few days. He wants
quality, not quantity.

Read first: `CLAUDE.md`, `docs/adding-a-route.md`, and for the content shape `tools/content/thames-loop.route.json`
and `tools/content/thames-loop.asides.json`.

## Master decisions

- Pack id `royal-docks`, name "Royal Docks Loop", mode bicycling. About 26 km. Starts at Bunhill Fields (1 km from
  home), ends at home, like the Thames Loop.
- Legs: "Out: Cable Street and the docks" stops 0 to 5; "Back: the Greenway and the East End" stops 6 to 11.
- Stops, in order. Segment i leads to stop i. Coordinates are approximate until task 1 fixes them.

| # | id | name | about (lat, lng) | amb | stories (kind, tags) |
|---|---|---|---|---|---|
| 0 | bunhill-fields | Bunhill Fields | 51.5236, -0.0889 (City Road gate) | solemn | Defoe the government secret agent (core, Spies) |
| 1 | soviet-house | Soviet House, Moorgate | 49 Moorgate, about 51.5163, -0.0889 | clock | The Arcos raid, May 1927 (core, Spies, Russia) |
| 2 | cable-street | Cable Street | mural on St George's Town Hall, 236 Cable Street, about 51.5108, -0.0585 | sailortown | The Battle of Cable Street, 4 Oct 1936 (core) |
| 3 | poplar | Poplar | Poplar Recreation Ground memorial and the old town hall, about 51.5092, -0.0165 | solemn | The Gotha raid and Upper North Street School, 13 June 1917 (core); Lansbury, the Daily Herald and the "Russian gold" of 1920, with the 1921 rates rebellion (core, Russia, Spies) |
| 4 | east-india-dock | East India Dock Basin | about 51.5088, -0.0015 | dock | The Jolly George, May 1920 (core, Russia); the Company's dock and the Virginia settlers of 1606 (optional) |
| 5 | royal-victoria-dock | Royal Victoria Dock | north quay by the cranes, about 51.5083, 0.0195 | dock | The dock built on a marsh: 1855, steam, rail, frozen meat, 7 Sept 1940 (core); the Silvertown explosion, 19 Jan 1917 (optional, amb solemn) |
| 6 | abbey-mills | Abbey Mills, on the Greenway | on the Greenway above the pumping station, about 51.5310, 0.0005 | tunnel | The Great Stink, Bazalgette and the outfall sewer you are riding on (core) |
| 7 | three-mills | Three Mills | House Mill, about 51.5275, -0.0075 | canal | Weizmann's acetone at the gin distillery, 1915 to 1916 (optional, Russia) |
| 8 | mile-end | Mile End, Grove Road bridge | plaque on the railway bridge, about 51.5285, -0.0372 | clock | The first flying bomb, 13 June 1944, and the double agents who moved the aim (core, Spies) |
| 9 | sidney-street | Sidney Street | siege site, about 51.5178, -0.0547 | sailortown | The Siege of Sidney Street, Jan 1911 (core, Russia) |
| 10 | bethnal-green | Bethnal Green | Stairway to Heaven memorial by the station, about 51.5270, -0.0553 | solemn | The stairway, 3 March 1943, and the silence after (optional) |
| 11 | home | Wenlock Basin, home | 51.531585, -0.095309 | canal | A short closer on City Road, for example the Eagle of the nursery rhyme (optional, bright, about 100 words) |

- Ambience names must come from `src/audio/soundscapes.ts` (river, wharf, ship, arctic, yard, sail, solemn, tunnel,
  dock, tavern, sailortown, canal, clock). A story may override its stop with its own `amb`.
- The Thames Loop already tells: the Tower spies (Lody, Jakobs), Marlowe, Peter the Great at Deptford, the 1907
  congress and Tower House, Execution Dock, the West India Docks, the Grapes, the Great Eastern. Do not retell them.
- One working tree, no worktrees: each task owns different files. No git commands in any task: the master commits.
- Working files that are not part of the repo go in `/home/claude/work/`.

## Task 1: the line (owner of `tools/content/royal-docks.track.json`, `royal-docks.plan.json`)

Goal: a line a rider would be glad to follow, on cycleways wherever they exist, passing every stop.

- First line: Komoot planning is allowed for a first line. `curl` this URL with one `p=lat,lng` per waypoint to get a
  GPX: `https://mcp.main.komoot.net/gpx/plan.gpx?sport=touringbicycle&p=51.5236%2C-0.0889&p=...&name=x`. Plan stop to
  stop (add shaping points where needed), cut the result into one polyline per segment, resample to about 12 m.
- Intended way: Bunhill Fields, Moorgate, then by the calmest reasonable way to Tower Hill and Cycleway 3 on Royal
  Mint Street and Cable Street; C3 on through Limehouse and Poplar High Street; Naval Row and Blackwall to East India
  Dock Basin; the Lower Lea Crossing to Royal Victoria Dock, north quay; then north (Prince Regent Lane or better) to
  the Greenway and west along it to Abbey Mills; Three Mills; Bow and Cycleway 2 along Mile End Road; Grove Road
  bridge; C2 on to Sidney Street; Bethnal Green; then west to Wenlock Basin on the best cycle streets, not the same
  way the Thames Loop comes home (Brick Lane, Shoreditch, Hoxton) if a good other way exists.
- Then follow `docs/adding-a-route.md` step 1: `OSM_DIR=/home/claude/osm/royal-docks`, fetch (be gentle with the OSM
  API), plan with via gates where the first line is poor, render every segment and look at every picture.
- Fix the stop coordinates to real places a rider can stop at (use the OSM data for the memorial, the plaque, the
  mural, number 49 Moorgate). For the Grove Road bridge and Sidney Street, a short out and back is fine (under 700 m
  in all); if it reads badly, stop at the junction and say so.
- Check on the web that the Greenway between Prince Regent Lane and Stratford High Street is open now (it has had
  long closures for works) and that the Lower Lea Crossing path and the Royal Victoria Dock north quay are rideable.
  If a stretch is closed, route around it and report it.
- Do not edit `tools/router.py` or other tools. If one is wrong, report it.
- Deliver `/home/claude/work/line.json`: final `stops` (id, lat, lng), and per segment: metres, share on cycle
  routes, metres of walking sections and of main roads, the street names in ride order. Also total km, closures
  found, and anything a rider should be warned about. Acceptance: every picture looked at; no line through water, no
  pointless loop; walking sections only where there is no rideable way; every stop within 30 m of the line.

## Task 2: tools and app for more than one pack (owner of `tools/build_pack.py`, `tools/narrate_stories.py`, `tools/narrate.py`, `src/ui`, `tests`)

Goal: the second pack builds, lists, rides and is tested exactly like the first.

- `build_pack.py` and `narrate_stories.py` take the pack id as an argument (default `thames-loop`), with no fixed
  stop count. The builder creates or updates the whole index entry (id, name, mode, km, stops, hero, blurb, stories,
  asides, minutes), keeping pack order.
- Never rebuild or change `public/packs/thames-loop/` (its cue files match its recorded audio). Do not edit
  `tools/router.py` or `src/types.ts`; report if you need a change there.
- App: remove anything fixed to `thames-loop` where it should follow the chosen pack (`src/ui/Demo.tsx`, others you
  find). Check Home with two packs at phone size, and that saving for offline works per pack.
- Tests: the pack integrity checks, the simulated rides and the dead end hunt run over every pack in
  `public/packs/index.json` (several speeds, a start part way, an off route detour; every stop arrives, every cue has
  a file, every story has audio, nothing talks over itself). They must pass for `thames-loop` now and need no change
  when `royal-docks` appears.
- Narration setup: install `kokoro-onnx` and `soundfile`, put the Kokoro model files in `/home/claude/kokoro`, and
  prove it by recording one test line to `/tmp` with `tools/voice.py`.
- Update `docs/adding-a-route.md` for the new arguments. `npm ci`, then `npm run check` and `npm run e2e` must pass.

## Tasks 3, 4, 5: stories, passing-by stories and pictures (writers; owners of `/home/claude/work/w<N>.json` and `/home/claude/work/img/`)

- Writer A: stops 0, 1, 2, 11 and asides for segments 1, 2, 11 and segment 3 as far as Limehouse Basin.
- Writer B: stops 3, 4, 5 and asides for segment 3 from Limehouse, segments 4 and 5, and segment 6 as far as the Greenway.
- Writer C: stops 6, 7, 8, 9, 10 and asides for segment 6 on the Greenway and segments 7, 8, 9, 10.

House style (see `CLAUDE.md` and read at least four Thames Loop stories first): history first, present tense, as if it
is happening now, written for the ear. Short sentences. Open on something the rider can see or do at the stop. Core
stories 170 to 260 words, optional 150 to 240, the home closer about 100. 4 to 8 short paragraphs. No dashes of any
kind, no exclamation marks, no bullet lists, numbers written the way a narrator says them ("the thirteenth of June
1917"). Each stop also gets a `note`: one or two plain sentences on where to stand and what to look at.

Facts: research each story on the web before writing and check every name, date, number and place against two
independent sources where possible. No invented quotes, no invented people. Hedge legends as legends and say when
something is disputed (sabotage rumours at Silvertown, who "Peter the Painter" was, how much the double agents
really moved the V-1s). Keep the sources.

Asides: 6 or 7 per writer, 45 to 75 words each, about what the rider is passing at that moment, each with `seg`, a
`street` the route is likely to use there, `near` ([lng, lat] of the thing), `frac` (0 to 1 along that street), `title`,
`tags`, `text`. Spread them out, about one per 1.3 km. Do not reuse subjects from the Thames Loop asides.

Pictures: one per story if a good one exists, public domain only (Wikimedia Commons: check the licence box says
public domain, not merely free). Download, look at each image, save at about 820 px wide as JPEG in
`/home/claude/work/img/`. Wikimedia rate-limits: send a descriptive User-Agent, pause, retry. If no public domain
picture fits, leave the story without one and say so. Captions follow the Thames Loop pattern: what, who, when.

Deliver `/home/claude/work/w<A|B|C>.json`:

```
{"stops": {"<stop id>": {"note": "...", "amb": "...", "stories": [{"title": "...", "kind": "core", "mood": "minor",
   "tags": ["Spies"], "amb": "solemn", "paras": ["...", "..."]}]}},
 "asides": [{"id": "...", "seg": 3, "street": "...", "near": [lng, lat], "frac": 0.5, "title": "...", "tags": [], "text": "..."}],
 "pics": {"<stop id>-<story index>": {"file": "x.jpg", "caption": "...", "source": "<Commons page URL>", "licence": "..."}},
 "hero": {"file": "...", "caption": "...", "source": "...", "licence": "..."},
 "sources": {"<stop id>-<story index>": ["url", "url"], "aside:<id>": ["url"]},
 "doubts": ["anything you could not confirm and how the text handles it"]}
```

`mood` is `minor` or `bright`. `tags` are from: Spies, Russia. Only writer B proposes the `hero` (the Royal Docks).
Report in under 200 words: what you wrote, what you could not confirm, pictures missing.

## Later tasks (master)

6. Merge the writers' files into `tools/content/royal-docks.route.json`, `.asides.json`, `.pics.json`, keep the
   sources in `tools/content/royal-docks.sources.json`; reconcile asides with the streets the line really uses.
7. Narrate stories, build the pack, read the cue list as a rider, narrate cues and asides, add to the index.
8. Independent fact check of every story by an agent that did not write it. Fix or cut.
9. `npm run check`, simulated rides and dead end hunt on the new pack, rider's seat screenshots. Fix every flag.
