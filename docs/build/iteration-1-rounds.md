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

# Iteration 2: what the review rounds found

- Sound: the first version's bed was playing but inaudible on a phone: nearly all its energy sat below 250 Hz and it
  was halved whenever the narrator spoke. The new mix carves a pocket for the voice in the speech band and keeps the
  bed's lows and highs. Measured in a browser on the assembled app: bed 15 dB under the voice in speech, 8 dB in gaps.
- The line: segment 4 now follows the river through Deptford; segment 10 goes through King Edward Memorial Park but
  still has about 190 m of The Highway (no connected bike path); segment 11 goes by Wapping High Street and Wapping
  Lane; segment 8 stays on Westferry Road (the west-side river path is closed to bikes). A first plan for segment 11
  looped off Wapping Lane and back because a via point sat off the street: via points now come from the map data.
- Two asides spoke of "this road" for a street the new line no longer uses, and one played 170 m before its
  crossroads. Texts and anchors fixed.
- Merging the new line broke engine tests tuned to the old geometry. They now run on a frozen copy of the first pack;
  the shipped pack is ridden end to end in the integration tests, the browser rides and the real-graph reroute tests.
- The narrator was processed twice (mastered in the files and again in the app). The in-app tone shaping is now flat.

Not proven, needs Evgeny: how the mix and the recorded soundscapes actually sound; the Android app on the phone
(GPS and sound with the screen locked, HyperOS battery rules); rerouting on a real detour; the new line on the ground.
