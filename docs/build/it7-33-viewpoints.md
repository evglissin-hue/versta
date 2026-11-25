# Task 33: stops you can see

Goal: at every core stop the rider can see what the story is about from the stop point, and the stop note says
where to look. Where the view is off the main line, the route takes a short spur to it.

Owned paths: `tools/build_pack.py`, `tools/plan_line.py`, `tools/content/*` (route, plan, track), `public/packs/*`
(rebuilt by the pipeline only), `docs/adding-a-route.md`.

## Decisions

- A stop's point is its viewpoint: where its stories start and where the line goes. A viewpoint off the main line
  is reached by a spur that is part of the line: the segment to the stop runs down the side street to it, and the
  next segment starts there, back along the same street or on round a short loop, whichever the router finds
  better. The engine needs nothing new: a spur is a stretch of route like any other, so the cue to turn into it is
  spoken, the arrival fires at the viewpoint, leaving works as at any stop, and off route and wrong way cannot fire
  on it. Rejected: a stop point off the line with its own approach drawn and guided by the engine (a second kind of
  leg in every module, and alarms to switch off near it), and an arrival radius big enough to reach the line (the
  story would start where the thing cannot be seen, which is the complaint).
- Builder: a segment whose first stretch doubles back on the end of the segment before it (bearings more than 150
  degrees apart) gets a depart cue "Turn back along <street>." (or "along the path" and so on). Viewpoint stops
  get `arrive_radius` 25 m, so the story starts where the view is.
- `plan_line.py`: a plan entry may give `from` and `to` ([lng, lat]) for the segment's ends, so a stop that moves
  takes the line ends with it; continuity with the neighbouring segments is checked and printed.
- Audit: every core stop in the three packs, line of sight from the stop point to its subject over OpenStreetMap
  buildings (height from `height`, else `building:levels` times 3.4 m plus 2 m, else 4 storeys) and street trees
  (18 m tall, 4.5 m crown), at several heights of the subject. Then a judgement for each: subjects that are the
  street itself, an address or a pub door need no line of sight. Findings and the decision per stop go in the
  rounds file.
- Senate House: the point moves to Malet Street just north of the Keppel Street corner (51.52075, -0.12952),
  opposite the forecourt, the first place down Malet Street where neither the buildings nor the plane trees hide the
  tower. The segments either side are planned again through it. Note: where to stand and to look east across the
  forecourt.
- Every core stop's note says where to look, in the same plain style.
- Rebuild only the packs whose line changes; a pack whose stop notes change and whose line does not gets its
  content refreshed without the map work (task 36's `tools/pack_content.py`). After a rebuild, re-record the
  changed cues and the arrival clips with `tools/narrate.py`, and check the cue list reads like directions.

## Acceptance

- `npm run check` (the pack integrity tests), the whole-ride tests and the browser rides on every pack.
- In the Chelsea Loop: the line runs down Malet Street to the viewpoint and on; the cue list reads like directions;
  the arrival at Senate House is at the viewpoint; no off route or wrong way on the spur in any ride test.
- The rounds file has the audit table: stop, subject, visible from the old point, decision, new note.
