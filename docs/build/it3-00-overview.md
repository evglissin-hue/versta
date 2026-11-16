# Iteration 3: navigation that is easy to live with, and polish

Evgeny after riding iteration 2: navigation could be more convenient, the recentre in particular, and the whole app
wants a polishing pass. No new routes.

Read `CLAUDE.md`, then `src/types.ts` (new for this iteration: `Settings.autoRecentre`, `bedLevel`, `haptics`;
`NavState.thenCue`, `toThen`, `speedAvg`, `wrongWay`; the `wrong_way` event; `Pack.system.distances` and `wrongWay`;
`Mixer.tick`, `seekVoice`, `setBedLevel`; `Director.rewind`), `src/state.ts`, `src/ride.ts`.

Tasks:

10. `it3-10-follow.md`: the map camera and the riding controls. Runs first on the UI side.
11. `it3-11-guidance.md`: the engine and the spoken guidance. Runs alongside 10.
12. `it3-12-polish.md`: the polishing pass on the screens. Runs after 10 is merged.

The executor rules of `it2-00-overview.md` apply unchanged (own paths only, own worktree, checks before reporting,
commit footer, factual report, no em dashes or en dashes).
