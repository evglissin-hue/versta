# Iteration 1: what the review rounds found

Round 1 (after merging the four tasks):

- Dead-end hunt, engine and director together: at Deptford the rider was treated as having left the stop the moment
  they arrived, because the approach to the stop lies along the start of the next segment. The second core story was
  then cut off by the next arrival in simulated rides. Fixed: leaving is decided by distance from the stop. Added a
  test that stands at every stop for a minute and expects no leave.
- Three turns sit within 80 m of a stop (s03-003, s09-002, s11-003). They are announced as the rider sets off, with no
  earlier warning. Accepted and pinned in a test.
- Rider's seat: the stop sheet opened on arrival and stayed over the map, the turn banner and the passing-by card for
  the rest of the ride until closed by hand. Fixed: riding away closes it.
- Rider's seat: the map credit sat behind the dock. Fixed: it is lifted by the real height of the bottom area.
- GPS errors were never cleared once fixes arrived. Fixed.
- Browser rides (Playwright, simulator, virtual sound): full ride, joining part way, fast rider. All pass.
- Real narration in the browser: checked that a story plays from its recording and the paragraph follows the audio.

Not yet proven, needs a real ride: GPS accuracy and battery on the phone, sound in a pocket with the screen on,
offline riding after "Save for offline", the feel of the turn timing, and the generated ambience and music.
