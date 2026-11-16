# Iteration 2: quality

Evgeny rode the first version: it works, the voice feels synthetic, there was no audible sound under the voice, and the
overall experience needs polish. This iteration: a real sound mix, rerouting, a line that hugs the river, an Android
app for riding with the screen off, and a round of experience fixes. No new routes, no fact-check pass.

Read `CLAUDE.md`, then `src/types.ts` (contracts, extended for this iteration: `RouteGraph`, `Detour`, `NavState.detour`,
`NavState.nearest`, the `detour` and `detour_turn` events, `NavEngine.setGraph`, `Director.markHeard`, `Pack.graph`,
`Pack.system.rerouting` and `turns`), `src/state.ts` and `src/ride.ts` (now also: saved rides, graph loading).
`docs/build/iteration-1-rounds.md` says what the first review found.

Tasks, one executor each, disjoint paths:

5. `it2-05-sound.md`: the mix. Voice through Web Audio, a spectral pocket for it in the bed, recorded soundscapes.
6. `it2-06-reroute.md`: finding a way back when off route; nearest-point for joining; small director additions.
7. `it2-07-line.md`: Python tools. A bike router over OpenStreetMap data, the re-planned line, the corridor graph.
8. `it2-08-android.md`: the Capacitor Android app, background GPS, and a CI build that produces an installable APK.
9. `it2-09-experience.md`: screens and map. Continue a ride, join choice, bottom sheet, finish screen, detour on the map.

Rules for every executor:

- Work only in your owned paths. Never edit `src/types.ts`, `src/state.ts`, `src/ride.ts`, `CLAUDE.md`,
  `vite.config.ts`, `playwright.config.ts`, or another task's paths. Only task 8 edits `package.json`. If a contract
  is wrong or missing something, implement the closest thing and report it under "Contract issues".
- You are in your own git worktree on your own branch, with `node_modules` linked. Use absolute paths inside it.
- Other tasks' new behaviour does not exist in your worktree. Build against the contracts and test your part alone.
- Before reporting: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` must pass.
- Commit on your branch (`git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit`), message ending:
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Up67uvDHNCYq5r61k7xWCG`.
- Report: commit hash, what you built, how you tested it, what you could not verify, contract issues. Be factual.
- No em dashes or en dashes anywhere.
