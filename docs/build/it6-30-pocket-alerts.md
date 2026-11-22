# Task 30: pocket alerts for places

Owned paths: `src/places/watch.ts` (new) and its test, `src/native/gps.ts` (watcher options per use),
`src/ui/Nearby.tsx` (the switch), `src/styles/app.css`. Starts after tasks 28 and 29 are merged.
Not `src/ride.ts` (the master stops the watch when a ride starts).

Read first: `docs/build/it6-00-overview.md` section 6, `src/native/gps.ts`, `src/native/notify.ts` (task 28:
`placeNotice`, `onNoticeTap`, `ensurePermission`), `src/places/nearby.ts` and `src/ui/Nearby.tsx` (task 29).

## Goal

With the phone in a pocket, Versta can tell you when you pass a place that has a story, and one tap plays it.

## Decisions

- A switch on the Nearby screen, Android app only: "Tell me when I pass a place", hint "Keeps watching your location
  with the screen off. Turns itself off after 8 hours." On the web the row reads "In the Android app" and is
  disabled.
- `watch.ts`: `startPlaceWatch()` / `stopPlaceWatch()` / `placeWatchOn` signal (kept in `localStorage` so it
  survives the app being closed and reopened; the watch restarts on launch if on and not expired).
  - Uses the background GPS watcher with its own options: title "Versta", message "Watching for places nearby.",
    distance filter 10 m. `gps.ts` takes the options per watcher; the ride's stay as they are.
  - On entering a place's radius (`arrivals` from task 29): `placeNotice` with title the place name, body
    "<first story title>. Tap to hear it.", extra `{ place: id }`. At most one per place per day (kept in
    `localStorage`), at most one every 5 minutes, none between 22:00 and 07:00 local time.
  - Tapping it (`onNoticeTap`): open Nearby and play that place's story.
  - Off by itself 8 hours after it was switched on. Stopped when a route ride starts (the master calls
    `stopPlaceWatch` from `startRide`; it is not restarted by itself: the rider switches it on again).
  - Asks for notification permission when switched on; if refused, the switch goes back off and a note says
    "Notifications are off for Versta. Turn them on in Android settings to use this."
- No change to how rides use GPS.

## Acceptance checks

1. Unit with a fake watcher, clock and notifier: entering a radius notifies once; the per-place and 5 minute limits;
   quiet hours; the 8 hour expiry; restart after relaunch; stop on ride start.
2. `npm run check` and the smoke e2e pass.
3. In the report: the phone checks, step by step (walk past a place with the screen off, tap the notification,
   battery over an hour).
