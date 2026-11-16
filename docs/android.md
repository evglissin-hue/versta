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

To update, repeat steps 1 to 3. The new APK installs over the old one.

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

The APK is at `android/app/build/outputs/apk/release/app-release.apk`. `android:sync` builds the web app, removes the
service worker and source maps (the app does not need them), and copies the result into the Android project. Set
`VERSTA_VERSION_CODE` to give a build a higher version code.

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
