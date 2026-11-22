# Task 24: the web app sees new routes and changed stories

Owned paths: `vite.config.ts` (the runtime caching rules only), `src/offline.ts`, `src/offline.test.ts`,
`tests/e2e/smoke.spec.ts` (one new test). Not `src/ui/Home.tsx` (task 23 shows the note).

Read first: `docs/build/it6-00-overview.md` section 4, `vite.config.ts`, `src/offline.ts`, `src/app.tsx` (how the
index is loaded), `PackIndexEntry` in `src/types.ts`.

## Goal

A returning visitor of the website sees a new route and a changed story without clearing anything, and a route
saved for offline never mixes old narration with new text.

## Decisions

- Workbox runtime caching, in this order:
  - `/packs/index.json`, any `/packs/*/pack.json`, any `/packs/*/manifest.json`, `/places.json`: `NetworkFirst`,
    `networkTimeoutSeconds: 3`, cache `versta-packs`, statuses 200.
  - Everything else under `/packs/`: `CacheFirst`, as now.
  - Tiles: as now.
- `src/offline.ts` exports `syncVersions(entries: PackIndexEntry[]): Promise<string[]>`: for each entry with a
  `version`, compare with `localStorage` `versta:seen-versions`; when it differs and an older one was seen, delete
  every `versta-packs` entry under that pack's folder except `pack.json`, `manifest.json` and the index (the network
  copies just fetched), clear that pack's offline "saved" marker if it had one, and return the ids whose saved copy
  was dropped. Then store the new versions. First sight of a version: just store it.
- `src/offline.ts` also exports a signal `updatedSinceSaved` (`Record<string, true>`), set from that return value,
  for task 23 to show "This route changed. Save it again for offline use."
- Do not edit `src/app.tsx` (task 22's file). The master adds the call to `syncVersions` after
  `packIndex.value = j.packs` on the web path when merging. For your e2e test, call it the same way in a local,
  uncommitted edit if you need to, or test through `src/offline.ts` directly.
- Nothing on the Android app changes (it has no service worker).

## Acceptance checks

1. Unit: `syncVersions` with a fake Cache Storage: first sight stores; a changed version deletes that pack's files
   but not the others or pack.json; the saved marker is cleared and the id returned; an unchanged version does nothing.
2. e2e: serve the build, load Home (the SW installs), change `index.json`'s copy in the SW cache to an older version
   string, reload: the network copy wins and the route list is current. Keep the test simple and deterministic.
3. `npm run check` and the smoke e2e pass.
