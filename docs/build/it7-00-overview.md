# Iteration 7: a steady marker, stops you can see, and no more reinstalls (spec)

Status: asked for by Evgeny on 25 November 2026 after riding the new Chelsea Loop on build 12, scope settled the
same day (he was out riding: the master made the calls below). Briefs `it7-31` to `it7-36`. Rounds in
`iteration-7-rounds.md`.

## What Evgeny asked for

1. "The GPS marker showing my current location frequently jumps around. It is an issue in itself, but it also
   creates the wrong messages that I'm off the route."
2. "For some of the stops, like the White Stone Tower, the Ministry of Truth, I could not see it from the spot you
   mentioned, so I had to go a bit down the other street. It is okay to have small deviations from the route for the
   core stops so that I can see it better."
3. "Please action the part where I have to reinstall the APK every single time." The installed app did not show the
   Chelsea Loop after it was deployed.
4. Added the same day: "All core stories can be a tiny bit longer." A quarter to a third more, real checkable detail,
   house style. Optional and passing-by stories stay as they are.

## What is wrong today (traced in the code)

- Position. Every fix goes straight into the engine (`src/nav/engine.ts`): there is no filter. The marker is the
  snapped point of the raw fix (`MapView.riderTarget`), so a fix that lands 40 m up the street moves the marker 40 m
  along the line and back; once off route it is the raw fix itself. Off route is one rule: 8 s beyond
  `45 + min(accuracy, 30)` metres. Urban multipath holds a 50 to 70 m error for that long with ease, and the
  phone's accuracy figure often says 5 m while it does. The plugin reports a missing accuracy as `null`, which
  `locationToFix` turns into 0, "perfect". Duplicate and late fixes are taken as new. Wrong way and the way-back
  search read the same raw positions.
- Recordings. The app records every real ride (`src/record`, IndexedDB, last 10, "Ride recordings" on Home with
  Save file) and `tests/unit/replay.test.ts` replays any file dropped in `tests/fixtures/rides/`. Today's ride is
  on Evgeny's phone, not reachable from here, so the jitter is modelled (task 32) and he can send the file later.
- Stops. A stop's point is where its stories start, and the line ends there. Senate House: line of sight over the
  OpenStreetMap buildings (heights from `height` and `building:levels`) and street trees from the Torrington Place
  corner is blocked by Student Central (14 m away) and Birkbeck; on Malet Street the tower only comes clear of the
  plane trees opposite the Senate House forecourt by the Keppel Street corner, 270 m down.
- Routes on the phone. `CapacitorHttp` parses any response served as `application/json` into an object, whatever
  `responseType` asks (`HttpRequestHandler.readData`, "backward compatibility"). The site serves `index.json`,
  every `manifest.json`, `pack.json` and `graph.json` that way. `capacitorDevice().get` turns a non-string body into
  `""`, so `readSite` fails to parse, swallows it, and the store never learns the site exists: no new route, no
  update, ever. Downloads would have failed the same way. The tests use an in-memory device that always answers
  base64, so they never saw it. Wi-Fi gating, timing, the site URL and pack format were all checked and are fine.
- App code. Everything the app runs is inside the APK. There is no way for new code to reach the phone without a
  sideload.

## Design

### 1. Position (tasks 31, 32)

- A pure position filter (`src/nav/filter.ts`) sits in front of every engine decision: a constant-velocity Kalman
  filter in local metres, position measured with the reported accuracy (missing accuracy is 50 m, never 0), the
  device's speed and bearing measured as velocity (GPS Doppler, which multipath barely touches). Fixes that disagree
  with the track by more than about 5 sigma are dropped; duplicates, fixes older than the last and fixes that
  arrive more than 10 s late are dropped. A run of dropped fixes that agree with each other and are reachable at
  bike speed becomes the new track (the rider really is there); two dropped fixes back on the line where the rider
  should be end a spell of multipath at once.
- The engine works from the filtered position. `NavState` gains `pos` (filtered), `posAccuracy` (its honest
  error) and `shown` with `shownHeading` (what the map draws): on the line while the rider plausibly is on it,
  blending to the filtered position as the offset grows, the filtered position when off route.
- Off route needs all of: beyond `40 + min(error, 40)` metres for 10 s, 30 m ridden in that time, and either moving
  away (less than half the distance ridden went along the line), or clear of the line by 30 m more, or 45 s and
  200 m of it. Riding along the line with a biased fix never fires it; standing still never fires it.
- Wrong way, the way-back search and "back on route" use the filtered position and heading.
- A seeded jitter model (`src/nav/jitter.ts`: urban multipath jumps of 20 to 60 m held for seconds, accuracy that
  lies, duplicate, late and missing fixes) drives the simulator (`&jitter=urban`), the whole-ride tests, the browser
  rides and a recorded fixture. New class check in the dead-end hunt: in jitter, no false off route, wrong way or
  rerouting on any pack, every stop and turn as without jitter, and the marker within bounds of the truth.

### 2. Stops you can see (task 33)

- A core stop's point is where its subject can be seen. Where that is off the main line, the line takes a short
  spur to the viewpoint: the segment to the stop runs down the side street and the next one starts there, back
  along it or on round a loop. The spur is part of the route, so it is guided, arrived at and left like any other
  stretch; nothing new in the engine, and none of its alarms can fire on it.
- Builder: a segment that starts by doubling back on the one before says "Turn back along Malet Street."; plan
  entries get optional `from` and `to` so a moved stop moves the line ends with it.
- Senate House moves to Malet Street at the Keppel Street corner. Every core stop of the three packs is audited
  for line of sight with the same model, and its note says where to look.

### 3. Updates without a reinstall (tasks 34, 35)

- Routes (34): parse-only JSON goes through `getText` (an object body is stringified), and every file the store
  keeps is downloaded by `Filesystem.downloadFile` to its place, then read back and checked for size and sha256.
  Home gets an Updates panel on the Android app: what was last checked and when, "Check for updates", and the news.
- App code (35): a self-built live update, weighed against the alternatives in the brief. Every build writes
  `app/manifest.json` (every file of the Android web bundle except routes, with sha256) and `app/index.html`. The
  app downloads a newer bundle between rides (Wi-Fi by itself, a tap otherwise), only the files that differ from
  the APK's own, verifies every one, and asks the native side to use it from the next start, or now with "Restart
  now" on Home, never during a ride. Native side (`AppUpdatePlugin.java`, `MainActivity`): serves the downloaded
  files over the APK's (Capacitor's `RouteProcessor`), promotes a staged bundle at launch, rolls back to the last
  good code when a new one does not say it started within 30 s or fails to start twice, and starts clean from the
  APK's own code after any new APK install. A bundle that needs native changes says "needs the newest app".
- This iteration's APK is the last one to sideload, unless a future change needs new native code.

### 4. Core stories (task 36)

- Every core story in the three packs gains about a quarter to a third, usually one paragraph, checked against a
  source listed in `<id>.sources.json`. Re-recorded, breaks found again, sound applied. The ride tests must still
  show no story cut off by the next arrival.

## Contracts (master, before the tasks)

`types.ts`: `Fix.receivedAt?`; `NavState.pos?`, `posAccuracy?`, `shown?`, `shownHeading?`. New in
`src/routes/files.ts`: `Device.getText`, `Device.download` (replacing `Device.get`). New `src/update/` for the app
bundle store, `android/app/src/main/java/app/versta/ride/AppUpdatePlugin.java`.

## Tasks

| No. | Task | Owned paths |
| --- | --- | --- |
| 31 | Steady position and honest off route | `src/nav/filter.ts`, `src/nav/engine.ts`, `src/native/gps.ts`, `src/nav/sources.ts` (browser source), `src/map/*` |
| 32 | GPS jitter in the dead-end hunt | `src/nav/jitter.ts`, `src/nav/sources.ts` (simulator), `tests/unit/*`, `tests/e2e/*`, `tests/fixtures/rides/` |
| 33 | Stops you can see | `tools/build_pack.py`, `tools/plan_line.py`, `tools/content/*`, `public/packs/*` |
| 34 | Routes reach the phone | `src/routes/*`, `src/ui/Home.tsx` (Updates panel) |
| 35 | App updates without a reinstall | `src/update/*`, `tools/app_manifest.mjs`, `android/`, `package.json` scripts, `docs/android.md` |
| 36 | Core stories a little longer | `tools/content/*.route.json`, `*.sources.json`, story audio, breaks |

## Not now

- The map offline on the phone (from iteration 6).
- A Play Store build.
