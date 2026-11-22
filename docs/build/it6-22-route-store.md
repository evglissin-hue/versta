# Task 22: the route store on the phone

Owned paths: `src/routes/` (new: `store.ts`, `plan.ts`, `files.ts`, tests beside them), `src/audio/library.ts` (new),
`src/ui/SoundCheck.tsx` (only: use `library.ts` for `recorded()`), `src/app.tsx` (start the store on the Android app),
`src/native/index.ts` (resume and network events call the store), `package.json` and `package-lock.json` (add
`@capacitor/filesystem` 8.x), the files `npx cap sync android` changes under `android/` for the new plugin.
Not: `src/types.ts`, `src/state.ts`, `src/ride.ts` (master), `src/ui/Home.tsx` (task 23).

Read first: `docs/build/it6-00-overview.md` section 2, the contracts in `src/types.ts` (`PackIndexEntry`,
`PackManifest`, `RouteStatus`, `RouteUpdate`, `Transfer`) and `src/state.ts` (`SITE_URL`, `PACK_FORMAT`,
`routeStatus`, `setPackBaseResolver`, `packBase`, `packIndex`), `src/app.tsx`, `src/native/index.ts`,
`src/offline.ts` (`packSounds`), `src/audio/loops.ts` (`fetchBytes`: the `versta-sounds` cache key is the URL the app
asks for), `src/ride.ts` (`savedRide`, `rideStartedAt`), the Capacitor Filesystem 8 API in node_modules once added,
`CapacitorHttp` in `@capacitor/core` (`responseType: "blob"` returns base64 on Android).

## Goal

On the Android app, routes on the site reach the phone by themselves on Wi-Fi, and by a tap otherwise; updates
switch in only when safe; nothing half-downloaded is ever used.

## Decisions

- Split for testing:
  - `plan.ts` is pure. Given the built-in index, the record of downloaded routes, the site index (or null when
    unreachable), the saved ride, whether a ride is running, whether on Wi-Fi, the removed set and transfers, it
    returns the `RouteStatus` of every route, the merged index list for `packIndex` (site order first, then
    routes only on the phone) and the next action (download id, switch id, delete folder, or none).
  - `files.ts` is the adapter: an interface `Device` with `read(path)`, `write(path, base64)`, `remove(path)`,
    `list(dir)`, `uri(path)`, `get(url)` (returns base64 and status), `copy(from, to)`. One implementation on
    Capacitor (Filesystem + CapacitorHttp + `Capacitor.convertFileSrc`), one in memory for tests.
  - `store.ts` runs the plan against a `Device`, keeps `routeStatus` and `packIndex`, and sets the pack base
    resolver. It exports `routeStore` with `start()`, `check()`, `fetch(id)` (a tap: download or update now, on
    any connection, clears "removed"), `remove(id)` (delete a downloaded copy; a built-in route falls back to its
    built-in copy; a site-only route becomes `removed`, never fetched by itself again) and `rideEnded()`.
- Layout and record exactly as in the spec: `packs/<id>/<version>/<path>` under `Directory.Data`; record in
  `localStorage` `versta:routes` (`{ [id]: { version, updated, entry } }`); removed set in `versta:routes-removed`.
  Never write the record before every file of a version is written and verified (bytes and sha256 with
  `crypto.subtle`). Unchanged files (same path and sha256 as the current copy) are copied, not downloaded: from a
  downloaded copy with `copy`, from the built-in copy by fetching the app's own file. `RouteUpdate.bytes` and
  `Transfer.total` count only downloaded bytes.
- Precedence: of the built-in copy (its index entry) and a downloaded copy, the later `updated` is used; equal
  versions use the built-in one and the downloaded folder is deleted.
- Site index: `SITE_URL + "packs/index.json"` with a 10 s timeout; on start, `check()` from resume, `online` and
  `navigator.connection` `change` events, at most once a minute. Unreachable: everything on the phone stays as is.
- Automatic downloads: only when `navigator.connection.type` is `wifi` or `ethernet`, `saveData` is false, no ride
  is running (`rideStartedAt() === null`), and the route is not removed. One route at a time, files one at a time.
  A ride starting: finish the current file, then wait; `rideEnded()` resumes. Otherwise routes wait with
  `held: "not-wifi"` (updates) or `transfer: null` (site-only).
- Switching an update in: held `riding` while that route is ridden now; held `saved-ride` while `savedRide()` is
  for that route and the new pack's stop ids (in order) differ from the current copy's. Otherwise switch: write the
  record, then delete the old folder. Re-check holds on every `check()` and on `rideEnded()`.
- Start: delete every folder under `packs/` the record does not name (a cut-off download), then plan.
- `format` above `PACK_FORMAT`: a site-only route is `needs-app`; an update of a route on the phone is held
  `needs-app` and never downloaded.
- Sounds: after a route is switched in (and once on start for downloaded routes), for each name in
  `packSounds(pack)` that `library.ts` says the APK does not ship and that is not already in the `versta-sounds`
  cache: get `SITE_URL + "sounds/<name>.mp3"` and `cache.put(new URL(BASE_URL + "sounds/<name>.mp3", location.href),
  new Response(bytes, { headers: { "content-type": "audio/mpeg" } }))`. Also fetch `SITE_URL + "sounds/credits.json"`
  into `localStorage` `versta:site-credits` for the credits screen. Failures are not errors (the sound is silence).
- `library.ts`: `recorded(path)` (from the credits files, as SoundCheck has it now) and `bundledSounds()`.
- `src/app.tsx`: on the Android app call `routeStore.start()` instead of fetching index.json; the web path is
  unchanged. `src/native/index.ts`: on `App` `resume` call `routeStore.check()`.
- The web app never loads `files.ts`' Capacitor parts (dynamic import, as `src/native/gps.ts` does).

## Acceptance checks (the dead-end hunt for this task, all with the in-memory Device and a fake clock)

1. First start, no network: the two built-in routes are on-phone, nothing else.
2. A new route on the site, on Wi-Fi: it downloads, lands on-phone (downloaded), `packBase` points at its folder.
3. The same on mobile data: on-site with no transfer; `fetch(id)` downloads it.
4. A download cut off half way (Device throws): the old copy is used; on the next start the partial folder is gone
   and the download starts again.
5. An update arriving while that route is ridden: downloaded, held `riding`, switched in on `rideEnded()`.
6. An update whose stops changed, with a saved ride of that route: held `saved-ride`; switched in once the saved
   ride is gone. With the same stops it switches in at once.
7. A site route with `format` 2: needs-app, never downloaded.
8. A removed route is not downloaded again by itself; `fetch(id)` brings it back.
9. An APK whose built-in copy is newer than the downloaded one: the downloaded folder is deleted.
10. The site unreachable or answering 500: nothing changes on the phone.
11. A file whose sha256 does not match: the transfer fails, the old copy stays, the folder is cleaned.
12. A route using a sound the APK lacks: the sound lands in the `versta-sounds` cache under the app's own URL.
13. An update costs only the changed files' bytes.
14. `npm run check` passes; `npx cap sync android` ran and its changes are committed; the web e2e suite still passes
    (the web path must be untouched).
