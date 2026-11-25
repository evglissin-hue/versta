# Iteration 7: what each round found

Tasks: 31 (a steady position), 32 (GPS jitter in the hunt), 33 (stops you can see), 34 (routes reach the phone),
35 (app updates without reinstalling), 36 (longer core stories). Briefs in `docs/build/it7-*.md`.

## Round 1

### Quality check

- `npm run check` passes: typecheck, lint, 462 unit tests (3 on demand only), build.
- The briefs were followed, with these design changes found in the hunt and written back into briefs 31 and 32: the
  gate measures a fix against what it claims and the update trusts it half as much (`rScale` 2); the re-acquire
  rule with device velocity needs a steady pull away; refused fixes on the line reset the estimate only while the
  estimate itself is off the line; the drawn marker holds rather than slides back.

### Dead-end hunt: GPS jitter (engine sweep over 15 whole rides, then the whole-ride tests)

The sweep (`tests/unit/jitter-sweep.test.ts`, every pack at 3, 4.5 and 7 m/s, five seeds) at the start of the round
and at its end:

| | false alarms | turns unsaid | turns first said at the turn | leaps over 15 m | back-slides over 10 m | marker p95, worst ride | mean |
|---|---|---|---|---|---|---|---|
| start | 1 | 6 | 5 | 0 (worst 12 m) | 88 (worst 28 m) | 15.8 m | 12.7 m |
| end | 0 | 6, all in GPS gaps | 5 | 0 (worst 12 m) | 0 (worst 2 m) | 14.2 m | 11.3 m |

Found and fixed:

1. A false off route (Chelsea Loop, 3 m/s, seed 5): multipath ramping in over 3 s looked like a rider pulling away
   from the dead reckoning, the track jumped onto it and stuck 85 m off. The pull-away rule now needs 6 fixes over
   5 s, each step outwards and none far bigger than the average, from under 0.7 of the final offset.
2. Multipath along the street itself (50 m ahead, on the line) took over a correct estimate through the snap-back
   rules, then the marker slid back 30 to 50 m when the multipath ended. Refused fixes on the line now reset the
   estimate only while the estimate is more than 20 m off the line. Back-slides fell from 88 to 0.
3. A rider standing at a stop through a story was moved 55 m by multipath and "left" the stop: standing still the
   phone's velocity was not counted as fresh, so a cluster of fixes was taken. Device velocity standing still now
   counts.
4. The marker slid back along the line in small steps when the estimate fell back. It now holds while the rider
   rides forward, judged against the line where the marker is and where the estimate projects (a dogleg).
5. Turns unsaid: every one of the 6 lies in a GPS gap of 4 to 8 s at 7 m/s, the rider already 30 to 50 m past the
   turn when the next fix comes. Saying it then would send the rider down the wrong street, so it stays unsaid; the
   rider is never told off route for it. The checks allow at most 3 such turns a ride and name them.
6. The recorded-ride test doctored with a 300 m jump no longer failed, because the filter rightly ignores ten fixes
   300 m out. It now doctors a real 300 m wander with the speed and bearing a phone would report, which is caught.
7. The approach cap test rode at 30 m/s, which the filter rightly refuses as no bicycle: it now runs with the filter
   told to take every fix.

New checks: the jittered whole rides (4 per pack) and a real detour in jitter (`tests/unit/ride.integration.test.ts`),
a jittered browser ride per pack (`tests/e2e/ride.spec.ts`), a recorded jittered ride
(`tests/fixtures/rides/chelsea-loop-urban-jitter.json`) replayed with the rest, and the model's own test
(`tests/unit/jitter.test.ts`).

### Stops you can see (task 33)

Line of sight from each core stop's point to its subject over OpenStreetMap buildings (height, else levels) and
street trees, at several heights of the subject, then a judgement.

| Stop | Subject | Seen from the old point | Decision | Note now says |
|---|---|---|---|---|
| Chelsea: Holford Gardens (start) | Bevin Court, 8 storeys | No: hidden by the houses of Great Percy Street | Start moved 85 m to Holford Street, 14 of 16 sight lines clear | Start on Holford Street, look west across the garden |
| Chelsea: Senate House | the tower, 64 m | No, at any height, from Torrington Place | Moved to a viewpoint on Malet Street at Keppel Street, a spur of 270 m each way, every sight line clear | Stand opposite the forecourt, look east; the route goes back up Malet Street |
| Chelsea: BT Tower | the tower | Yes, at its foot | Kept | Look up |
| Chelsea: Marylebone | the buried Tyburn | A street, no line of sight needed | Kept | Marylebone Lane leaves the high street 50 m south |
| Chelsea: Portman Square | Home House, No. 20 | Yes, 39 m | Kept | Unchanged (already says where) |
| Chelsea: Symons Street | the King's Road, two fictional addresses | A direction | Kept | The King's Road runs west from the end of the street |
| Chelsea: Vauxhall | MI6 across the river | Yes from the river wall (street trees on the road side) | Kept | Unchanged |
| Thames: Tower Bridge (start) | the Pool, downstream | Yes, on the bridge | Kept | Look downstream, east |
| Thames: Shad Thames | the street | The street itself | Kept | Unchanged |
| Thames: Mayflower | the river and St Mary's | The point is at the pub door; Church Stairs beside it give the rail and the river | Kept | Stand at the top of Church Stairs by the rail; the churchyard is across the lane |
| Thames: Peter the Great | the statue | Yes, 3 m | Kept | Unchanged |
| Thames: Greenwich | the Cutty Sark | Yes, beside it | Kept | The Cutty Sark is the ship beside you |
| Thames: Foot tunnel | the tunnel | Inside it | Kept | Unchanged |
| Thames: Prospect of Whitby | the floor and the noose | Inside the pub, the terrace behind | Kept | Go in; the noose hangs from the terrace at the back |
| Thames: Whitechapel | Tower House | No: 138 m away down Greenfield Road | Moved 129 m back along the line to the top of Settles Street, 17 of 22 sight lines clear | Tower House is across Fieldgate Street, ahead and to your right |
| Thames: Wenlock Basin (end) | the basin | Yes, 5 m | Kept | The water in front of you is Wenlock Basin |
| Royal Docks: Bunhill Fields | Defoe's obelisk | Through trees from the gate; the note sends the rider in | Kept | Unchanged |
| Royal Docks: Soviet House | 49 Moorgate | An address | Kept | Unchanged |
| Royal Docks: Cable Street | the mural | Yes | Kept | Unchanged |
| Royal Docks: Poplar | the memorial | Yes, 59 m into the park, as the note says | Kept | Unchanged |
| Royal Docks: East India Dock | the basin | Yes | Kept | Unchanged |
| Royal Docks: Royal Victoria Dock | the dock | Yes | Kept | Unchanged |
| Royal Docks: Abbey Mills | the pumping station | Yes, from the Greenway | Kept | Unchanged |
| Royal Docks: Mile End | the railway bridge | Yes | Kept | Unchanged |
| Royal Docks: Sidney Street | Wexford House | Yes, 21 m | Kept | Unchanged |

Pipeline: `plan_line.py` gained `from` and `to` (a moved stop takes the line with it), `splits` (a stop that slides
along its own line), `--only` and a continuity check; `build_pack.py` says "Turn back along <street>." when a segment
starts back the way the last one came. The Chelsea Loop and the Thames Loop were rebuilt with today's map data.
Rebuilding also changed a few cues away from the moved stops; every cue whose words changed under the same id was
recorded again, with the new ones: Chelsea 17 (among them "Head along Marylebone High Street." where it said
Blandford Street), Thames 30 (among them "Turn back along Narrow Street." and "Turn back along the path." where the
route really does double back; and in Island Gardens the map now marks the path for bikes, so the "Walk the bike"
cue there is gone).

### Rider's seat (phone size, light and dark: Home in the three update states, the go-back question, the moved stops' sheets)

- "Download the new version" looked the same as "Check for updates": it is now the filled button, as the route
  Download is.
- "Use the installed version" switched back at once and set the downloaded version aside for good, from a footer
  link: it now asks first ("Go back" or "Keep this version").
- Every new line read in place. The map attribution links are under 48 px; they are attribution, kept visible as
  required, and not something a rider taps.

## Round 2 (after the packs were rebuilt and the stories made longer)

1. The marker's 95th percentile reached 15.5 to 17.5 m in three 7 m/s rides. Traced in the worst: 13 s without a
   fix, then fixes 54 m out in a multipath spell, which the estimate (uncertain after the gap) followed for about
   15 s. No alarm followed. The bound is 18 m at 7 m/s (15 m at 4.5); a route-aware weighting of the first fixes after a gap is the
   next step if real rides show it.
2. "Continue onto the cycle path." (Royal Docks, after East India Dock) was first said at the junction in one
   jittered ride. A straight-on cue asks nothing of the rider, so it no longer counts as a late turn.
3. Back-slides measured on the line's folds near stops (the line leaves a stop in a V) were a measuring artefact:
   the marker hardly moved but projected onto the other fold. A back-slide now counts only as far as the marker
   really moved. The worst left is 11 m, at a dogleg on The Highway.
4. The recorded Royal Docks ride now leaves East India Dock while the longer story still plays, so the depart cue
   and the next turn are decided together and the second waits for the first. The late-cue check counts such a
   pair from when the pair starts.
5. Longer stories and the next stop: in every ride test the rider stands through a stop's stories, and none was cut
   off. For a rider who rides on at once at 4.5 m/s, every first core story ends before the next stop, Senate House
   included (91 s of story, 185 s of riding, now that the spur adds 270 m); a new check in
   `tests/unit/packs.test.ts` keeps it so. One exception, older than this iteration: Peter the Great has two core
   stories, and a rider who rides on at once reaches Greenwich during the second (it was so before the stories grew).
6. A sound effect moved one paragraph with an added paragraph (Peter the Great, the adze): the director test follows.

## Core stories, longer (task 36)

| Pack | Story | Words | Recording |
|---|---|---|---|
| chelsea-loop | Mr and Mrs Richter | 250 to 330 (+32%) | 99.0 to 125.1 s |
| chelsea-loop | The Ministry of Truth | 156 to 209 (+34%) | 69.4 to 90.6 s |
| chelsea-loop | The tower that was a secret | 125 to 162 (+30%) | 55.1 to 71.3 s |
| chelsea-loop | The buried river | 115 to 144 (+25%) | 47.4 to 60.6 s |
| chelsea-loop | The confession upstairs | 208 to 272 (+31%) | 91.3 to 118.7 s |
| chelsea-loop | Two spies off the King's Road | 169 to 224 (+33%) | 69.4 to 90.1 s |
| chelsea-loop | The view across the water | 155 to 204 (+32%) | 67.3 to 88.6 s |
| thames-loop | The richest water on earth | 173 to 212 (+23%) | 67.4 to 83.5 s |
| thames-loop | The street that smelled of cinnamon | 154 to 190 (+23%) | 63.2 to 78.8 s |
| thames-loop | Captain Jones goes home | 166 to 219 (+32%) | 63.5 to 84.4 s |
| thames-loop | The tsar in the shipyard | 302 to 384 (+27%) | 121.3 to 153.1 s |
| thames-loop | The reckoning | 252 to 316 (+25%) | 100.8 to 126.3 s |
| thames-loop | The last of the racers | 180 to 240 (+33%) | 71.0 to 95.3 s |
| thames-loop | Under the river | 170 to 217 (+28%) | 64.0 to 84.0 s |
| thames-loop | Three tides | 220 to 273 (+24%) | 83.3 to 104.4 s |
| thames-loop | The doss house delegates | 257 to 334 (+30%) | 103.0 to 129.4 s |
| thames-loop | Where the cargo went | 101 to 134 (+33%) | 41.9 to 54.8 s |
| royal-docks | The double life of Daniel Defoe | 259 to 334 (+29%) | 107.1 to 133.7 s |
| royal-docks | The raid that blinded the codebreakers | 256 to 310 (+21%) | 107.5 to 128.2 s |
| royal-docks | The day the march turned back | 258 to 318 (+23%) | 107.5 to 132.9 s |
| royal-docks | The school in Upper North Street | 251 to 304 (+21%) | 102.0 to 123.3 s |
| royal-docks | The Russian jewels | 263 to 324 (+23%) | 108.7 to 133.3 s |
| royal-docks | The Jolly George | 258 to 321 (+24%) | 100.8 to 126.9 s |
| royal-docks | The dock on the marsh | 253 to 313 (+24%) | 104.6 to 128.7 s |
| royal-docks | The river that stank | 248 to 310 (+25%) | 99.8 to 123.7 s |
| royal-docks | The first flying bomb | 262 to 323 (+23%) | 106.4 to 127.7 s |
| royal-docks | The siege of Sidney Street | 257 to 316 (+23%) | 107.9 to 130.9 s |

Every new fact has its source in `tools/content/<id>.sources.json` (a new file for the Thames Loop). Two older
errors were put right on the way: the Whitechapel hostel is called Tower House only since 1961, so in 1907 it is the
Rowton House; and the Senate House story now looks across the forecourt, from the new viewpoint. Re-recorded with
`narrate_stories.py`, phrase marks from `find_breaks.py` (which now reads a re-recorded story's marks from the audio
manifest, so it no longer depends on the pack being rebuilt first), then `pack_content.py` (new: words only, no map
work) for the Royal Docks Loop and the rebuilds for the other two.
