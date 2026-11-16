# Iteration 1: the web app

Goal: an installable web app that guides a ride by GPS, speaks the turns, plays each stop's stories on arrival and
drops in short passing-by stories on the way. One route pack ships: Thames Loop.

Read `CLAUDE.md` first, then `src/types.ts` (the contracts), `src/state.ts` and `src/ride.ts` (how modules are wired).
The pack to code against is `public/packs/thames-loop/pack.json`. The earlier single-page prototype is in
`docs/legacy/` for reference on look, copy and the generated soundscapes.

Tasks, one executor each, disjoint paths:

1. `01-nav.md`: geometry, navigation engine, GPS and simulator sources.
2. `02-map.md`: the MapLibre map view.
3. `03-sound.md`: the mixer and the director.
4. `04-shell.md`: screens, components, offline saving, icons.

Rules for every executor:

- Work only in your owned paths. Never edit `src/types.ts`, `src/state.ts`, `src/ride.ts`, `CLAUDE.md` or another
  task's paths. If a contract looks wrong or is missing something, do not change it: implement the closest thing and
  say so in your report under "Contract issues".
- Start with `git checkout -b exec/<task>` from the current `main`, and `ln -s /home/claude/app/node_modules node_modules`
  if `node_modules` is missing in your worktree.
- Other tasks' modules are stubs that throw. Do not implement them. Test your part on its own.
- Before reporting: `npm run typecheck`, `npm run lint`, `npm run test` must pass. `npm run build` must pass too.
- Commit your work on your branch with a clear message. Report: branch name, worktree path, what you built, how you
  tested it, anything you could not do, and contract issues.
- No em dashes or en dashes anywhere, including comments and commit messages.
