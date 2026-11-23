# Versta

Versta (верста, the old Russian road measure) is Evgeny's app for bike rides and walks that tell their stories as you pass.
A route pack holds the line, the stops, narrated stories, short passing-by stories and turn cues. The app follows the
rider by GPS, speaks the turns, plays a stop's stories on arrival and drops in a short story now and then on the way.

## Stack

- Vite, TypeScript (strict), Preact with signals, MapLibre GL, vite-plugin-pwa. No backend.
- Hosted on Cloudflare (Workers static assets, connected to this repo): build `npm run build`, deploy `npx wrangler deploy`, settings in `wrangler.jsonc`.
- Map tiles: OpenFreeMap vector tiles (no key). Attribution to OpenStreetMap and OpenFreeMap must stay visible.
- Phase 2 wraps the same build as an Android app with Capacitor for GPS with the screen off. Keep browser-only
  assumptions out of `src/nav` and `src/story` so that swap stays small.

## Layout

- `src/types.ts`: the contracts every module codes against. Master-owned. Do not edit in an executor task.
- `src/state.ts`, `src/ride.ts`: shared signals and the ride controller that wires the modules. Master-owned.
- `src/nav`: geometry, the navigation engine (pure, no browser APIs) and position sources (GPS, simulator).
- `src/audio`, `src/story`: the mixer and the director that decides what the rider hears.
- `src/map`: the MapLibre view. `src/ui`, `src/app.tsx`, `src/styles`: screens and components. The app opens on
  the menu (`src/ui/Menu.tsx`); its pages are a stack in `src/ui/uistate.ts`, and `src/ui/back.ts` is the one place
  that decides what Back closes or stops.
- `src/tour`: the tutorial, a spotlight tour of a practice ride (`startPractice` in `src/ride.ts`): a generic engine,
  the steps, and their pictures.
- `public/packs/<id>/`: route packs. Built by `tools/`, never hand-edited.
- `tools/`: Python pipeline that builds packs and records narration. See `docs/adding-a-route.md`.
- `tests/unit` (Vitest), `tests/e2e` (Playwright, simulated rides).

## Rules

- Never use em dashes or en dashes in any text: UI copy, stories, comments, commit messages, docs.
- UI copy is plain and short. Buttons say exactly what happens. No exclamation marks.
- Every colour comes from `src/styles/tokens.css`. The story scene is always dark, whatever the theme.
- Touch targets at least 48px. The rider uses this one-handed, outdoors, often in sunlight.
- No new dependencies without a line in the PR saying why.
- `npm run check` (typecheck, lint, unit tests, build) must pass before a task is reported done.
- House style for stories: history first, present tense, as if it is happening now. Where true to the place, espionage
  and intelligence stories and Russian history come first and are marked core. Facts must be checkable: no invented
  quotes, no invented people. Hedge legends as legends.

## Build and review loop

Every big build iteration runs this loop (Evgeny's standing rule for all software projects):

1. Master turns the request into numbered tasks, traces each in the code, makes the design calls and writes a brief per
   task in `docs/build/`: goal, owned paths, decisions, acceptance checks.
2. Executors, one task each, on a lower model, in separate worktrees. Each first merges the master's working branch,
   builds what the brief says, adds tests, runs the checks and reports. Executors do not redesign.
3. Quality check: review every diff against its brief and these rules, merge, run `npm run check` and the e2e rides.
4. Dead-end hunt: simulated rides over the whole route (several speeds, a start part way, an off-route detour) must
   find what a rider would get stuck on before a human does: a stop that never arrives, a cue never spoken, a story
   that cannot be stopped, sound that talks over itself, a screen with no way back. Fix or explain every flag. When a
   real ride finds something the hunt missed, add a check for that whole class of problem.
5. Rider's seat: run it, screenshot every screen at phone size in light and dark, read every line of text in place,
   and ask what a first-time rider would misread or get stuck on. Then improve it.
6. One or two rounds of steps 3 to 5 after each big iteration, before the PR. The PR lists what each round found.
