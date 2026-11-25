# The Android app

Versta also runs as an Android app (Capacitor, app id `app.versta.ride`). It is the same web app with the route packs
inside, plus a foreground service that keeps the GPS and the sound going with the screen locked.

## About the signing key (read this once)

Every build is signed with the same key, so a new APK installs over the old one and keeps your saved rides. That key
is committed to this repository: `android/versta-sideload.keystore`, with its passwords in `android/keystore.properties`.
This is deliberate and only acceptable because the repository is private and the app is personal: it is sideloaded, never
published to a store. If the repository ever becomes public, or the app goes to the Play Store, generate a new key,
keep it out of git (GitHub Actions secrets), and expect everyone to reinstall once, since a different key cannot update
the old app.

## Getting the app onto the phone

1. On the phone, open the repository's Releases page on GitHub and open the release called "Versta Android (latest)"
   (tag `android-latest`). You need to be signed in to GitHub, because the repository is private.
2. Tap `versta.apk` to download it.
3. When the browser asks, allow it to install apps: Settings, then "Install unknown apps" for that browser, switch on
   "Allow from this source". On HyperOS the installer may also ask to confirm: choose Install.
4. Open Versta. When it asks for location, choose "While using the app" first, then then do the settings below.
5. Allow notifications when asked. The "Following your ride." notification is what keeps the app alive in your pocket.

## Updates without reinstalling

From the build that added this section (iteration 7) the installed app updates itself, and the APK above is the last
one to install by hand, unless a later change touches native code (see below).

- Routes: a new route, or a new version of one, comes from the site. Home checks when the app opens and when it comes
  back to the front, and "Check for updates" on Home checks at once. A new route's card shows with a Download button;
  an updated route on the phone updates itself (only the changed files download, each checked against its sha256).
- The app's own code: every deploy of the site also publishes the Android web bundle with a manifest of every file's
  sha256 (`dist/app/manifest.json`, written by `tools/app_manifest.mjs` in `npm run build`). Home says "A new version
  of the app is ready to download" with its size. On Wi-Fi it downloads by itself, on mobile data when you tap
  "Download the new version". Only the files that differ from the ones the phone has are fetched, and each is checked.
  Nothing downloads, and nothing is switched, during a ride.
- The new code starts the next time you open Versta, or at once with "Restart now" on Home. It runs on trial: if it
  does not start properly within 30 seconds, or fails to start twice, the app goes back to the version before it and
  never tries that one again. "Use the installed version" at the foot of Home goes back to the APK's own code at any
  time.
- When native code changes (Java, Capacitor plugins, `capacitor.config.ts`), raise `level` in
  `src/update/native-api.json` and `NATIVE_LEVEL` in `AppUpdatePlugin.java` together and record the new fingerprint
  (the unit test `src/update/native.test.ts` fails until you do, and prints the value). A phone with an older APK
  then gets "A new version of the app needs a one-time install" with a "Get the app" button instead of web code its
  APK cannot run, and the APK is installed by hand once more, as in the steps above.

How it is built: `src/update/` (the check, the download into `app/<version>/` with every file verified, the record of
bundles on the phone), `AppUpdatePlugin.java` and `UpdateState.java` (staging, the trial, rollback, all kept in
SharedPreferences; the rules have JVM tests in `android/app/src/test`, run by the workflow before the APK is built)
and `OverlayRoutes.java` (serves the bundle's files over the APK's own, and the APK's for anything the bundle lacks).

## Settings that stop HyperOS killing it

Do these once, before the first long ride. Names vary a little between HyperOS versions.

1. Settings, Apps, Manage apps, Versta, Battery saver: choose "No restrictions".
2. Settings, Apps, Manage apps, Versta: switch on "Autostart".
3. Settings, Apps, Manage apps, Versta, Permissions, Location: choose "Allow all the time" and make sure "Use precise
   location" is on.
4. Settings, Apps, Manage apps, Versta, Permissions, Notifications: allow, and keep the "Ride in progress" channel on.
5. Open Versta, press the Recents button (or swipe up and hold), long press the Versta card and choose the lock icon,
   so "Clear all" leaves it alone.
6. Optional, if the sound still cuts out: Settings, Battery, turn off "Battery saver" for the ride, and keep the phone
   out of Power saving mode.

## Building it yourself

GitHub builds it: `.github/workflows/android.yml` runs on every push to `main` and on manual dispatch (Actions tab,
"Android APK", Run workflow). It produces `versta.apk` as a workflow artifact and as the asset of the `android-latest`
release.

Locally you need Node 22, JDK 21 and the Android SDK (platform 36, build tools 36):

    npm ci
    npm run android:sync
    cd android
    ./gradlew assembleRelease

The APK is at `android/app/build/outputs/apk/release/app-release.apk`. `android:sync` builds the web app, uses the
Android start page `dist/app/index.html` (no service worker), and copies the result into the Android project. Set
`VERSTA_VERSION_CODE` to give a build a higher version code. `./gradlew testReleaseUnitTest` runs the native unit tests.

## How it works

- `src/native/gps.ts`: position source on Android, using `@capacitor-community/background-geolocation`. It adds a
  watcher with a foreground service notification, so fixes keep coming with the screen off. The browser build uses the
  browser Geolocation API as before; `createGpsSource()` in `src/nav/sources.ts` chooses by platform.
- `android/app/src/main/java/app/versta/ride/KeepAwakePlugin.java`: holds a CPU wake lock (screen may sleep) while a ride
  is followed, so the page's timers and the voice keep running. Released when the ride stops, and after eight hours at
  the latest.
- `MainActivity.java`: asks for the notification permission on Android 13 and later, and makes the volume buttons
  control media volume.
- `src/native/index.ts`: `initNative()` stops the service worker and handles the Android back button. Back first lets a
  screen handle it (it fires a cancelable `versta:back` event on `window`), then closes an open stop sheet; in a ride it
  does nothing, so a ride is never left by accident; on the home screen it sends the app to the background.
- The plugin uses Google's fused location provider. A phone without Google Play services would get no fixes.
