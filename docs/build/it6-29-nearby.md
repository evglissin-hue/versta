# Task 29: Nearby mode

Owned paths: `src/places/` (new: `library.ts`, `nearby.ts`, tests beside them), `src/ui/Nearby.tsx` (new),
`src/ui/Home.tsx` (one entry button), `src/ui/uistate.ts` (one signal), `src/ui/back.ts` (one line), `src/app.tsx`
(one render line), `src/ui/Demo.tsx` (steps), `src/styles/app.css`, `tests/e2e/smoke.spec.ts` (tests). Starts after
tasks 21 and 22 are merged. Not `src/ride.ts`, `src/types.ts`, `src/state.ts`.

Read first: `docs/build/it6-00-overview.md` section 6, `Place`, `PlaceStory`, `PlacesFile` in `src/types.ts`,
`public/places.json` (task 21), `src/routes/store.ts` (task 22: `routeStatus`, `routeStore.fetch`), `packBase`,
`src/ui/SoundCheck.tsx` (a standalone mixer made on a tap), `src/map/style.ts` (the app's map style) and
`src/map/MapView.tsx` (how the map is created; Nearby makes its own simpler map), `src/nav/sources.ts`
(`createGpsSource`), `src/ui/Scene.tsx` (how a story is shown), CLAUDE.md copy rules.

## Goal

A way to use Versta off a route: a map of the places around you, each with its stories, that plays a story when you
tap it or walk up to it.

## Decisions

- `library.ts`: `loadPlaces()`: on the web fetch `places.json` (the site's own); on the Android app read the site's
  `SITE_URL + "places.json"` when reachable (10 s timeout), keep the last good copy in `localStorage`
  `versta:places`, and fall back to the copy inside the APK. Returns `PlacesFile`.
- `nearby.ts` (pure): `nearbyPlaces(places, here, within = 3000)` sorted by distance; `arrivals(prev, here,
  places)` for "Play when I get there": the places whose radius the rider has just entered, once each per session.
- `Nearby.tsx`, a full screen reached from Home by a button "Nearby places" under the header (hint under it: "Stories
  of the places around you, off any route."):
  - A map (MapLibre, the app's style, the rider's position as on a ride) with a marker for each place within 3 km;
    under it a list by distance: place name, the route it belongs to, distance, first story title, a "Play" button.
  - Tapping Play (or a marker, then Play): plays the first story through a mixer made on that tap (as SoundCheck
    does), shows a panel with the title, picture, the text by paragraph as it plays, and Pause and Stop. One story at
    a time; the next tap replaces it.
  - A switch "Play when I get there", hint "Plays a place's story once when you reach it, with the app open."
  - On the Android app, a place whose route is not on the phone shows "Download the route to hear this" and a button
    "Download route" (`routeStore.fetch`). On the web, everything plays online.
  - Location: the GPS source while the screen is open; denied or unavailable: a note "Allow location to see places
    near you." and the list sorted from the first place of the first route.
  - "Close" and Back return to Home. Not reachable during a ride.
- `Demo.tsx`: steps `nearby` (a fake position in central London, the real places) and `nearby-playing`.
- Copy plain, no dashes, no exclamation marks; 48 px targets; colours from tokens; the story panel is dark as the
  story scene always is.

## Acceptance checks

1. Unit: `nearbyPlaces` sorting and range; `arrivals` fires once per place and not again until the session ends.
2. e2e: with geolocation near Tower Bridge, Home, then Nearby places, lists Tower Bridge first; Play starts a
   story (headless audio is fine: check the panel and the mixer timeline); Close returns Home.
3. Screenshots of `nearby` and `nearby-playing`, 390 by 844, light and dark, in the report.
4. `npm run check` and the smoke e2e pass.
