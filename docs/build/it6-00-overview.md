# Iteration 6: content that grows, and a better ride (spec)

Status: asked for by Evgeny on 22 November 2026, scope settled the same day. Briefs `it6-21` to `it6-30`.

## What Evgeny asked for

- New routes, and changes to routes, reach the Android app without a reinstall. Downloads happen by themselves on
  Wi-Fi; on mobile data a route shows a Download button with its size. Updates keep the rider's progress.
- Start a route from the nearest stop, not only from stop 1. The ride then ends at the last stop as usual.
- A library of places and their stories, built from every route, with a Nearby mode: a map of the places around
  you, a story when you tap one or walk up to it, and a notification when you pass one with the phone in your
  pocket.
- Navigation: zoom in on a junction as you come up to it; a ride recorder so a real ride can be replayed in the
  dead-end hunt; the next turn on the lock screen.
- Not now: the map offline on the phone (see below).

## What is wrong or missing today (traced in the code)

- The Android app reads routes only from its own assets (`capacitor.config.ts`: "loads packs from its own assets").
  `index.json` is fetched once from the app's own files (`src/app.tsx`); `packBase(id)` is a fixed path.
- The web app caches everything under `/packs/` CacheFirst for ever (`vite.config.ts`), `index.json` included: a
  returning visitor never sees a new route or a changed story.
- The Android app has no service worker (`android:sync` strips it), so "Save for offline" on the phone fills caches
  that nothing reads for map tiles. Narration and pictures are in the APK, so the ride works offline except the map.
  Out of scope by Evgeny's choice; noted for later.
- With the rider far from stop 1, the engine either joins the line silently where the rider is (within 60 m) or
  guides to stop 1 while showing the nearest point of the route (`toStart` in `src/nav/engine.ts`). There is no
  choice.
- `jumpToSegment` (used by resume and "Ride to this stop") counts the skipped stops as arrived.
- The follow camera zooms in by only 0.4 for a turn within 120 m (`cameraZoom` in `src/map/geometry.ts`).
- The GPS foreground service notification ("Following your ride.") cannot change its text after it starts.
- Nothing records a real ride.

## Design

### 1. Route content has versions (task 21)

- `tools/pack_manifest.py <id>` writes `public/packs/<id>/manifest.json`: `{ id, version, format, files: [{ path,
  bytes, sha256 }] }`, every file the pack folder holds except the manifest itself. `version` is the first 16 hex of
  the sha256 of the sorted list of `path:sha256` lines. `format` is 1.
- It also updates the pack's entry in `public/packs/index.json` with `version`, `bytes` (sum of file sizes),
  `updated` (UTC ISO date-time, changed only when `version` changes) and `format`.
- `build_pack.py` and `pack_sound.py` call it last, so a pack is never written without its manifest. A unit test
  fails when a manifest does not match the files on disk.
- `tools/places.py` writes `public/places.json` (section 6) from every pack listed in `index.json`. Also run last.
- `build_sounds.py credits` and `tools/music/render.py` also write `public/sounds/credits.json`: every sound file with
  its credit, so an app that downloads a sound it does not ship can credit it.

### 2. The phone keeps routes it downloaded (task 22)

- Storage: `@capacitor/filesystem` (new dependency: the only way to keep 15 MB per route on the phone and hand the
  WebView a plain URL for audio and pictures). Files go to `Directory.Data` under `packs/<id>/<version>/<path>`.
  `packBase(id)` returns `Capacitor.convertFileSrc(<that folder>)` for a downloaded route, so every existing caller
  (ride, mixer, pictures, Sound check) works unchanged.
- Network: `CapacitorHttp` from `@capacitor/core` (no CORS needed, no new dependency), from the site
  `SITE_URL` (`https://versta.evglissin.workers.dev/`, `VITE_SITE_URL` overrides).
- What is on the phone: the routes built into the APK (its own `packs/index.json`, now with versions) and the
  downloaded ones (a record in `localStorage` `versta:routes`: id, version, updated, the index entry). Of a built-in
  and a downloaded copy, the later `updated` wins; a downloaded copy older than the built-in one is deleted.
- The site's `index.json` is read on start, on resume, when the phone comes back online and when it joins Wi-Fi, at
  most once a minute. A route whose `format` is above `PACK_FORMAT` is never downloaded: "needs the newest app".
- Downloading writes a new version into its own folder, file by file, verifying size and sha256, reusing unchanged
  files from the current copy (so an update costs only what changed). Only when every file is in does the record
  switch; then the old folder goes. A download cut short leaves the old copy working; on the next start any folder
  the record does not name is deleted.
- Sounds: after a route lands, every sound it can play (`packSounds`) that the APK does not ship (not in the
  credits files) is fetched from the site into the `versta-sounds` cache under the app's own URL, where the loop
  library already looks. Their credits come from the site's `sounds/credits.json`, kept in `localStorage`.
- Automatic on Wi-Fi: `navigator.connection.type` is `wifi` or `ethernet`, `saveData` is off, and no ride is
  running. Otherwise a route waits for a tap. A route the rider removed is not downloaded again by itself.
- An update is never switched in while that route is being ridden ("riding"), nor while a saved ride of it exists
  and the new version's stop ids differ from the old ("saved-ride"). Either way it waits, downloaded, and switches
  in as soon as the reason goes.
- A ride starting pauses transfers after the current file; they resume when it ends.

### 3. Home shows what the phone has (task 23)

On the Android app each card shows one of: ready (Ride, as now); on the site (Download with size, or progress);
needs the newest app (with the Android link); and under a ready card a line for an update (progress, waiting for a
ride to end, waiting for Wi-Fi with a Download update button). A downloaded route has "On this phone, 15 MB. Remove".
The web app's cards are as now, plus a note when a saved route changed on the site.

### 4. The web app sees new routes (task 24)

`index.json`, `pack.json` and `manifest.json` go NetworkFirst (3 s, then the cache); the rest of `/packs/` stays
CacheFirst. When the network index shows a new `version` for a route, that route's cached files are dropped before
it is used, so stale narration never mixes with new text. A route that was saved for offline says so on its card.

### 5. Start from the nearest stop (task 25)

- When a real ride starts from the beginning with the rider more than 300 m from stop 1 and another stop nearer
  (never the last), a sheet asks: "Start at 01 Tower Bridge, 4.2 km" or "Start at 07 Foot Tunnel, 600 m, the nearest
  stop". Until the rider chooses, the engine sees no fix: no guidance, no speech (`src/ride.ts`, done by the master:
  `startOffer`, the `startChoice` signal, `chooseStart(stop)`). Distances are straight-line.
- The engine gets `startAt(stop)`, called on every choice, stop 1 included: guidance to that stop the way stop 1 is
  guided to now, the stops before it behind and skipped (not arrived), then on to the last stop. After a choice there
  is no silent join part way: the rider goes to the stop they chose. A ride near stop 1 behaves as today.
- A saved ride from a part-way start resumes as any other. Simulated rides keep `from=` and are never asked.

### 6. Places and Nearby (tasks 21, 29, 30)

- `public/places.json`: `{ version, places: [{ id, name, at, radius, pack, kind: "stop" | "aside", stories: [{ id,
  title, kind, audio, dur, pic? }] }] }`. Ids are `<pack>:<stop or aside id>`. A place that two routes share keeps
  one entry per route for now (merging comes later). On the phone it downloads with the route data and is versioned
  the same way.
- Nearby (task 29): a screen from Home, "Nearby". A map centred on the rider with every place within 3 km as a
  marker, and a list below by distance. Tapping a place plays its first story through the mixer and opens the story
  scene. With "Play when I get there" on, walking or riding within a place's radius plays it once. Stories need
  their route on the phone (or the network on the web); a place whose route is not on the phone says so.
- Pocket alerts (task 30): a switch on the Nearby screen, "Tell me when I pass a place". While on and the app is
  in the background, the GPS foreground service keeps running (its notification says "Watching for places nearby")
  and a local notification fires on entering a place's radius: "<place name>: <story title>. Tap to hear it."
  Tapping opens Nearby and plays it. At most one per place per day and one every 5 minutes. Off by itself after 8
  hours. Never during a route ride.

### 7. The ride (tasks 26, 27, 28)

- Zoom before turns (26): from about 12 s before a turn (at the rider's speed, at least 60 m, at most 200 m) the
  follow camera eases to zoom 17.5 and keeps both the rider and the junction in view; 30 m after the turn it eases
  back. Not when the rider has zoomed by hand (that zoom wins), not in whole-route view.
- Ride recorder (27): every real ride records the fixes, the nav events and the director log to the phone
  (IndexedDB), one file per ride, the last 10 kept. "Ride recordings" in Sound and settings lists them with "Save
  file" (a JSON file the rider can send) and "Delete". `tests/unit/replay.test.ts` replays every recording in
  `tests/fixtures/rides/` through the engine and director with the dead-end checks, so a real ride's problem
  becomes a test by dropping its file in.
- Next turn on the lock screen (28): `@capacitor/local-notifications` (new dependency, also used by task 30). During
  a ride on the Android app, an ongoing, silent notification shows the next turn and its distance ("Left onto
  Jamaica Road, 200 m") or the next stop ("Next stop: 05 Deptford, 1.2 km"), updated on each new cue and every
  50 m. It goes when the ride ends.

## Contracts (master, in `src/types.ts` and `src/state.ts` before wave 1)

`PackIndexEntry` gains `version?`, `bytes?`, `updated?`, `format?`. New: `PackManifest`, `RouteStatus`,
`RouteUpdate`, `Transfer`, `Place`, `PlaceStory`, `PlacesFile`, `RideRecording`, `NavEngine.startAt?`. `state.ts`:
`SITE_URL`, `PACK_FORMAT`, `routeStatus`, `setPackBaseResolver`, `heroSrc`. `ride.ts` gains `startAt` in its
options and the recorder and notification hooks, wired by the master after the tasks land.

## Tasks

| No. | Task | Wave |
| --- | --- | --- |
| 21 | Content tooling: manifests, index versions, places.json, sounds credits json | 1 |
| 22 | Route store on the phone: downloads, updates, safety, Wi-Fi, sounds | 1 |
| 24 | Web: route list and route files stay fresh | 1 |
| 25 | Start from the nearest stop: engine `startAt`, the choice sheet | 1 |
| 26 | Zoom before turns | 1 |
| 27 | Ride recorder and replay | 1 |
| 23 | Home: route states on the phone | 2 (after 22) |
| 28 | Notifications layer and the next turn on the lock screen | 2 |
| 29 | Nearby mode | 2 (after 21, 22) |
| 30 | Pocket alerts for places | 3 (after 28, 29) |

## Acceptance

- `npm run check` and the e2e suite pass; the Android build passes in CI.
- Dead-end hunt, unit level with fake file system and network: first start offline; a new route on Wi-Fi; on
  mobile data; a download cut off and restarted; an update while riding; an update with changed stops and a saved
  ride; a route that needs a newer app; a removed route; an APK with a newer built-in copy; the site unreachable; a
  corrupt file; a sound the APK lacks. A real recorded ride (once Evgeny sends one) replays clean.
- Rider's seat: every new state and screen at phone size, light and dark, every line read.
- Needs a phone (Evgeny): downloads and updates on Wi-Fi, audio seeking in a downloaded route, the lock screen
  notification with the screen off, a pocket alert walking past a place, battery over an hour of Nearby.

## Not in this iteration

Offline map tiles on the phone; merging places shared by routes; places outside routes; iOS.
