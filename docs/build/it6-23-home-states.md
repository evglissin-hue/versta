# Task 23: Home shows what the phone has

Owned paths: `src/ui/Home.tsx`, `src/ui/Demo.tsx` (steps), `src/styles/app.css`, `tests/e2e/smoke.spec.ts`
(tests for the demo steps). Starts after tasks 22 and 24 are merged.

Read first: `docs/build/it6-00-overview.md` sections 2 to 4, `RouteStatus` / `RouteUpdate` / `Transfer` in
`src/types.ts`, `routeStatus` and `heroSrc` in `src/state.ts`, `routeStore` in `src/routes/store.ts` (task 22),
`updatedSinceSaved` in `src/offline.ts` (task 24), the current `Card` in `src/ui/Home.tsx`, CLAUDE.md copy rules.

## Goal

On the Android app every route card says plainly whether the route is on the phone, coming, or needs something, and
offers the one action that helps. On the web the cards stay as they are.

## Decisions

- Pictures: every card uses `heroSrc(entry)`. A picture that fails to load (a site route while offline) is hidden,
  leaving the title on the plain card colour.
- Android app (`isNative()`), by `routeStatus.value[id]`:
  - `on-site`, no transfer: primary button "Download", under the buttons "15 MB. Downloads by itself on Wi-Fi."
    (With `removed`: "Removed from this phone." instead.) No Ride button, no Save for offline.
  - `on-site`, downloading: the primary button disabled reading "Downloading 40%", and the progress bar.
  - `on-site`, failed: "Download stopped." and a button "Try again".
  - `needs-app`: no buttons but a note "This route needs the newest version of the app." and the link "Get the app"
    (the Android releases link already in Home).
  - `on-phone`: Ride and Continue as now. Under the card, one line by `update`:
    - downloading: "Updating, 40%" with the progress bar (Ride stays usable).
    - failed: "The update stopped." and "Try again".
    - held `not-wifi`: "An update is ready to download, 2 MB." and a button "Download update".
    - held `riding`: "Update downloaded. It comes in when this ride ends."
    - held `saved-ride`: "Update downloaded. It comes in when you finish or start your saved ride again."
    - held `needs-app`: "An update needs the newest version of the app." and "Get the app".
  - `on-phone` and `downloaded`, no saved ride of it: "On this phone, 15 MB." and a link "Remove" (calls
    `routeStore.remove`). Built-in routes show nothing extra.
  - Buttons call `routeStore.fetch(id)`; sizes with the existing MB formatter.
- Web: as now, plus when `updatedSinceSaved.value[id]`: "This route changed. Save it again for offline use." in
  place of the saved line.
- `Demo.tsx`: step `routes` showing four cards: one in each of on-site, downloading, needs-app, and on-phone with an
  update held `not-wifi` (fake entries and statuses; no network). Also `routes-held` with riding and saved-ride.
- Copy plain, no dashes, no exclamation marks. Buttons at least 48 px. Colours from tokens.

## Acceptance checks

1. e2e: the `routes` demo step shows each state's text and button; the web Home (no demo) is unchanged.
2. Screenshots of `routes` and `routes-held` at 390 by 844, light and dark, in the report.
3. `npm run check` and the smoke e2e pass.
