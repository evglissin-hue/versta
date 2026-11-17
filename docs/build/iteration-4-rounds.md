# Iteration 4: what the review rounds found

Request: a second ride like the Thames Loop, mostly on bike lanes, open to the sun, in another direction. Brief:
`it4-00-royal-docks.md`. Result: the pack `royal-docks`, "Royal Docks Loop", 26.8 km, 11 stops, 14 stories, 20
passing-by stories, 32 minutes of listening.

## What changed from the brief

- The Greenway is closed from Upper Road to Channelsea Path until 2028 (Thames Water). The return was planned again:
  Royal Victoria Dock is the turnaround, then Silvertown Way, back streets round the gap in the Leaway, Cody Dock and
  the riverside path to Three Mills, and only the last open 450 m of the Greenway, out and back, at Abbey Mills.
- Three Mills (stop 6) now comes before Abbey Mills (stop 7).
- Bethnal Green was cut to keep the ride near two hours. Its story was written and is not in the repo.
- Cody Dock is open from 9am to sunset only: the ride needs daylight on that stretch.
- 48% of the line is traffic free or on a segregated track, about 10% is on main roads.

## Round 1

Quality check:

- Task 2 (tools and app for more than one pack): as briefed. Kept from the executor: saving a route for offline now
  includes the turn, distance, rerouting and wrong-way clips and `graph.json`, which it used to skip.
- Task 1 (the line): three plans, because of the closure and the length. `render_line.py` and `plan_line.py` got small
  fixes (any segment count, streets in ride order).
- Stories: an independent fact check of every story and aside by agents that did not write them, about 300 claims,
  29 findings, all applied. The ones that mattered: 100 Sidney Street stood 370 m north of the first stop position
  (the stop moved to Wexford House); Lansbury was Poplar's mayor in 1920, not its former mayor, and met Lenin in
  February; a line presented as Baldwin's words in the Commons could not be found in Hansard and was removed; the
  V-1 estimate was wrongly credited to R. V. Jones; seven asides were anchored off the line and were moved onto it.
- The Thames Loop asides `defoe` and `cable-street` touch the same subjects as two stops here. Left as they are.

Dead-end hunt (whole simulated rides of every pack at 4.5 and 9 m/s, a start part way, a detour):

- Found: the first turn after the Mile End stop (s09-001) was first heard at the turn. The stop sat on a 50 m out and
  back to the Grove Road bridge, about as long as the 45 m arrival radius, so the rider arrived at the corner, was
  already at the next turn, and would not have heard it again on the way back. Fixed in the content: the stop is now
  at the corner of Lichfield Road and Grove Road with the bridge in view, and there is no out and back.
- New check for the whole class in `tools/build_pack.py`: it warns when the first turn after a stop is inside or
  near that stop's arrival radius. A stop can also set `arrive_radius` in the route file.
- After moving the Sidney Street stop, the way home began with 370 m south, a 70 m walking path and a turn back
  north. Planned again from the new stop: Stepney Way to Turner Street, 453 m shorter, no walking.

Narration:

- `tools/content/royal-docks.say.json` holds the respellings the voice needs (Bazalgette, Weizmann, Mosley,
  Whitechapel, Plaistow and others) and the house numbers and years outside 1500 to 1999. Nobody has listened to
  these recordings yet: they need a human ear on the first ride.

Not done:

- Three stories have no picture: the flying bomb at Mile End (Wikimedia refused the download; a public domain file is
  noted in `royal-docks.sources.json`), Silvertown, and the home closer.
- No new soundscapes: the stops use the existing ambience names.
- The repository is public, and `docs/android.md` says the committed signing key is only acceptable while it is
  private. Raised with Evgeny; not changed here.
