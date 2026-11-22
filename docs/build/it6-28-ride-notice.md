# Task 28: notifications, and the next turn on the lock screen

Owned paths: `src/native/notify.ts` (new), `src/native/notify.test.ts` (new), `src/ui/notice.ts` (new: the pure text
builder) with its test, `package.json` and `package-lock.json` (add `@capacitor/local-notifications` 8.x), the files
`npx cap sync android` changes, `android/app/src/main/AndroidManifest.xml` (POST_NOTIFICATIONS if the plugin does not
add it), `src/ui/Home.tsx` FirstRide tips (one line). Not `src/ride.ts` (the master wires it).

Read first: `docs/build/it6-00-overview.md` section 7, `src/native/gps.ts` (how a Capacitor plugin is loaded with a
dynamic import so the web build never contains it), `NavState` in `src/types.ts`, `src/ui/Banner.tsx` (how turns and
distances are worded now: reuse its wording and formatters), the Capacitor Local Notifications 8 API.

## Goal

During a ride on the Android app the lock screen shows the next turn and how far it is, so a glance is enough; and a
small notifications layer that task 30 reuses for places.

## Decisions

- `src/ui/notice.ts`: `rideNoticeText(nav, pack)` → `{ title, body } | null`, pure:
  - Riding with a next turn: title "Left onto Jamaica Road", body "200 m" (Banner wording; distances rounded as the
    banner does).
  - Riding with no turn ahead on the segment, or at a stop: title "Next stop: 05 Deptford", body "1.2 km" (at a stop:
    title "At 05 Deptford", body the next stop).
  - To start: title "Head for 07 Foot Tunnel", body the distance.
  - Off route: title "Off the route", body "Head back to the line".
  - Finished or idle: null.
- `src/native/notify.ts` (no-ops on the web):
  - `rideNotice.show(text)`: one ongoing, silent notification (id 1001) on channel `ride` (created once: importance
    low, no sound, no vibration, name "Ride"). Tapping it opens the app. Updates replace it in place.
  - `rideNotice.update(nav, pack)`: builds the text; shows it only when the title changed or the distance changed by
    50 m or more (or the stop or status changed), at most once a second. `rideNotice.clear()` removes it.
  - `ensurePermission()`: asks for notification permission once (Android 13 and later), never again after a refusal;
    the ride works without it.
  - `placeNotice(id, title, body, extra)` on channel `places` (default importance, default sound, name "Places
    nearby"), and `onNoticeTap(handler)` that calls back with `extra` when one is tapped. For task 30.
- The master wires `rideNotice.update` on every nav update of a real ride, `rideNotice.clear` on end, and
  `ensurePermission` at ride start.
- FirstRide tips on the Android app gain: "Allow notifications to see the next turn on the lock screen."

## Acceptance checks

1. Unit: `rideNoticeText` for each state; the throttle (same text twice shows once; a 50 m change shows; a cue change
   shows at once); everything is a no-op on the web.
2. `npm run check` passes; `npx cap sync android` ran and its changes are committed; smoke e2e passes.
3. In the report: exactly what a phone check should look for.
