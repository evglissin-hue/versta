# Task 8: the Android app

Owned paths: `android/**`, `capacitor.config.ts`, `package.json`, `package-lock.json`, `.github/workflows/**`,
`src/nav/sources.ts`, `src/native/**`, `docs/android.md`, `.gitignore`.

## Goal

The same app, installed on Evgeny's phone (Xiaomi 17, HyperOS, Android) from an APK, that keeps following the ride and
playing sound with the screen locked and the phone in a pocket.

## Decisions

- Capacitor (current major), app id `app.versta.ride`, name Versta, `webDir: "dist"`. The route packs ship inside the
  APK. Web builds must keep working exactly as before: no native import may break `npm run build` for the browser.
- Background position: `@capacitor-community/background-geolocation`. In `src/nav/sources.ts`, `createGpsSource()`
  uses it when `Capacitor.isNativePlatform()` is true: `addWatcher` with a background title "Versta" and message
  "Following your ride.", `requestPermissions: true`, `stale: false`, `distanceFilter: 3`; map its locations to
  `Fix` (heading from `bearing`, speed, accuracy, time); map permission refusal to `denied`. In the browser keep the
  current `navigator.geolocation` source. The simulator source is unchanged. Load the plugin with a dynamic import
  so the browser bundle does not depend on it.
- Android manifest: fine and coarse location, background location, foreground service (location type), notifications
  (Android 13 and later), wake lock. Portrait only. Keep the app's WebView alive in the background through the
  plugin's foreground service; audio already playing must continue. Set the media volume stream. Handle the Android
  back button: close the open sheet or scene first, never exit a ride silently.
- The service worker is not needed inside the app: make the web code skip registering it when native (do it in
  `src/native/` with a tiny bootstrap that `src/main.tsx` can call; you may not edit `src/main.tsx`, so export
  `initNative()` and report the one line the master must add).
- Signing: updates must install over the previous version, so every build is signed with the same key. Generate a
  keystore for sideloading with `keytool`, commit it at `android/versta-sideload.keystore` with its passwords in
  `android/keystore.properties` (private repo, personal app, never a store release: say this plainly in
  `docs/android.md`), and configure the release build to use it.
- CI: `.github/workflows/android.yml`, on pushes to `main` and manual dispatch: Node 22, `npm ci`, `npm run build`,
  `npx cap sync android`, JDK 21, `./gradlew assembleRelease`, then publish `versta.apk` both as a workflow artifact
  and as the asset of a rolling GitHub release tagged `android-latest` (needs `permissions: contents: write`).
  Version code from the run number.
- `docs/android.md`: how Evgeny installs it (download the APK from the release page on the phone, allow installing
  from the browser, open), and the HyperOS settings that stop the system killing it (battery saver: no restrictions,
  autostart on, location "Allow all the time", lock the app in recents), in numbered steps.

## Acceptance checks

- `npm run check` passes and the web build's main bundle does not contain the native plugin code.
- If the Android SDK is available or can be installed on this machine (try `sdkmanager` from the command line tools;
  the network allows GitHub and the usual package registries, other hosts may be refused), build the APK locally
  with `./gradlew assembleRelease` and report its size and that `apksigner verify` passes. If it cannot be installed,
  say so plainly: then the build is proven only by CI, which you cannot run from here.
- Unit test for the mapping from a plugin location to `Fix`, and for choosing the source by platform.
- Report every step the master or Evgeny must do by hand.
