# Task 35: app updates without a reinstall

Goal: a change to the app's code that is pushed to `main` reaches the installed Android app without sideloading an
APK: downloaded between rides, checked file by file, switched in at the next start (or at once with a tap on Home),
never during a ride, and undone by itself if the new code does not start.

Owned paths: `src/update/*` (new), `tools/app_manifest.mjs` (new), `package.json` scripts, `src/main.tsx` (the ready
call), `src/ride.ts` (hold during a ride, by the master), `src/ui/Home.tsx` (lines in the Updates panel),
`android/app/src/main/java/app/versta/ride/AppUpdatePlugin.java` (new), `.../MainActivity.java`, `docs/android.md`,
`.github/workflows/android.yml`.

## Options weighed

- A live update plugin (Capgo `@capgo/capacitor-updater`, Capawesome `@capawesome/capacitor-live-update`). Proven
  code for download, unzip, switch and rollback. Against: a large native dependency we cannot run here, defaults
  that call their cloud and send statistics unless every one is switched off, bundles as one zip of the whole web
  folder, so the 40 MB of routes inside the APK would either ride along in every update or vanish from the app.
- Loading the app from the site (`server.url`) with an offline fallback. Against: a rider who opens the app with no
  signal gets nothing or a stale cache; the native bridge and the downloaded routes' file URLs both depend on the
  app's own origin; a half-loaded new version mid-ride is possible. Rejected.
- Self-built on Capacitor's own hooks (chosen). Capacitor already serves the web app through a `RouteProcessor`
  hook and forgets a downloaded web folder whenever a new APK is installed; we add about 250 lines of Java and a
  store in TypeScript that works like the route store. No new dependency. Only the files that differ from the APK
  are downloaded and kept; the routes stay where they are.

## Decisions

### What a bundle is

- `tools/app_manifest.mjs`, run at the end of `npm run build`, writes `dist/app/index.html` (the Android
  `index.html`: the service worker registration removed, as `android:sync` did with `sed`) and
  `dist/app/manifest.json`: `{ version, builtAt, native, commit, files: [{ path, bytes, sha256 }] }` for every file
  of the Android web bundle except `packs/`, `app/`, `places.json`, the service worker files and source maps.
  `version` is the first 16 hex of the sha256 of the sorted `path:sha256` lines. `native` is `NATIVE_API` from
  `src/update/native-api.json`.
- `android:sync` copies `dist/app/index.html` over `dist/index.html` instead of the `sed`, so the APK's files are
  exactly the manifest's. The APK carries its own `app/manifest.json`: the built-in bundle.
- A unit test fingerprints everything native (the Java sources, `capacitor.config.ts`, the `@capacitor` and plugin
  versions in `package.json`) and fails with instructions when it changes without `NATIVE_API` and the Java
  `NATIVE_LEVEL` being raised together.

### Native (in the APK, `AppUpdatePlugin.java`, `MainActivity.java`)

- State in SharedPreferences `versta-update`: `current`, `next`, `previous` (bundle ids, 16 hex), `trial`, `launches`,
  `bad` (ids), `apk` (the version code last seen).
- At launch, before the bridge: a new APK version code clears `current`, `next` and `previous` (start clean from the
  APK's own code). A staged `next` with an `index.html` becomes `current` on trial (`previous` keeps the old one).
  A trial that has already launched twice without saying it started is rolled back: marked bad, `previous` (or the
  APK's own code) becomes `current`.
- A `RouteProcessor` serves `filesDir/app/<current>/<path>` when that file exists and the APK's `public/<path>`
  otherwise; Capacitor's own file and content URLs pass through untouched. Bundle files are returned as
  `/_capacitor_file_` paths so every request takes the same branch of Capacitor's server whatever runs beside it.
- Plugin `AppUpdate`: `info()` ({ level, current, next, previous, trial, bad, versionCode }), `stage({ id })`,
  `unstage()`, `ready()`, `restart()` (switch to `next` now and reload), `reset()` (back to the APK's code now).
- A trial bundle that has not called `ready()` within 30 s of being in the foreground is rolled back and the page
  reloaded.

### The store (`src/update/`, TypeScript)

- `plan.ts` (pure) decides like the route store's `plan.ts`: running version (the plugin's `current`, else the
  built-in manifest's), the site's manifest, what is downloaded, riding or not, Wi-Fi or a tap, bad ids and
  `native` against the plugin's `level`. Outcomes: up to date, available (size), downloading, ready (staged), needs
  the newest app, failed.
- `store.ts` runs it with the route store's `Device` (`getText`, `download`, `read`, `copy`, `list`, `remove`):
  downloads to `app/<version>/`, copies files already in the current bundle, skips files whose sha256 matches the
  APK's own (served from the APK), checks every file, writes `bundle.json` last, then `stage`. Cleans up folders that
  are not current, next or previous.
- Never during a ride: transfers wait, `unstage()` when a ride starts, stage again when it ends.
- `main.tsx` calls `ready()` after the first render.
- Checks with the route store: at start, on resume, back online, on Wi-Fi, and on "Check for updates".

### Home (the Updates panel of task 34)

- "A new version of the app is ready. It starts next time you open Versta." with "Restart now" (disabled in a ride).
- "A new version of the app is downloading, 40%." / "A new version of the app is ready to download, 1.2 MB." with
  "Download" / "A new version of the app needs a one-time install." with "Get the app".
- The footer: "App version 0.2.N, updated 25 Nov" and, when running a downloaded version, "Use the installed
  version" (calls `reset()`), for a version that starts but misbehaves.

## Acceptance

- Unit tests: plan decisions; the store against a memory device and a fake plugin (download, skip built-in files,
  copy from current, bad checksum, ride holds and unstages, needs the newest app, clean-up); the manifest tool
  against a fixture folder; the native fingerprint.
- The Java compiles (`./gradlew assembleRelease` locally with the Android SDK, and in CI).
- The CI workflow builds and publishes as before; `dist/app/manifest.json` is deployed with the site.
- `docs/android.md` explains how updates arrive and that this APK is the last to sideload unless native code changes.
