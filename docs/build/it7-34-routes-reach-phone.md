# Task 34: routes reach the phone

Goal: a route pushed to the site shows up in the installed app on its next check, downloads on Wi-Fi by itself or
with a tap, and route updates arrive the same way. Home says plainly when it last checked and lets the rider check
now.

Owned paths: `src/routes/files.ts`, `src/routes/store.ts`, `src/routes/store.test.ts`, `src/ui/Home.tsx` (the
Updates panel), `src/ui/Demo.tsx` (demo steps for it), `src/styles/app.css`.

## Root cause (from the overview)

`CapacitorHttp` hands back a parsed object for any `application/json` response, whatever `responseType` says, and
`capacitorDevice().get` turned that into an empty string. The site index never parsed, so nothing on the site was
ever seen. Pack JSON downloads would have failed the same way.

## Decisions

- `Device.get` goes. In its place:
  - `getText(url, timeoutMs)`: for files that are only parsed (the index, manifests, sound credits). Capacitor: a
    `CapacitorHttp` text request; a body that arrives as an object or array is `JSON.stringify`d.
  - `download(url, path, timeoutMs)`: for every file the store keeps. Capacitor: make the parent folder, then
    `Filesystem.downloadFile` into `Directory.Data` (native, exact bytes, any content type). Rejects on any
    failure. The store then reads the file back and checks size and sha256 as before, deleting it on a mismatch.
  - The manifest that closes a download is downloaded the same way, last.
- `memoryDevice()` gets a switch that answers `.json` the way `CapacitorHttp` does (an object), so the store tests
  run against the real behaviour; every store test runs with it on.
- The store keeps `lastCheck: { at, ok }` and a `checking` flag, and publishes them (a signal in `state.ts`, set by
  the store's publish).
- Home, Android app only, a panel under the header: "Updates", one line of status and a "Check for updates" button
  (48 px). Status lines: "Checking for new routes." / "Up to date. Checked at 14:32." / "Could not reach the site.
  The routes on this phone still work." / and news: "New route: Chelsea Loop. It downloads by itself on Wi-Fi." or
  with the size on mobile data. The app update lines of task 35 go in the same panel.
- No change to the rules of what downloads when (Wi-Fi by itself, a tap otherwise, never during a ride).

## Acceptance

- Store tests with the JSON-object device: a new route on the site appears as on-site and downloads; an update
  downloads only the changed files and switches in; a file with the wrong checksum fails the download and leaves
  the old copy working.
- Demo steps `updates` and `updates-news` show the panel; screenshots at phone size, light and dark.
- `npm run check`.
