# Task 32: GPS jitter in the dead-end hunt

Goal: the dead-end hunt rides every pack through the kind of GPS a phone gets in central London, and fails when
the marker jumps, a false off route, wrong way or rerouting is said, or a stop, turn or story goes missing. This is
the new class check the loop asks for after a real ride found what the hunt missed.

Owned paths: `src/nav/jitter.ts` (new), `src/nav/sources.ts` (the simulator), `src/ride.ts` (`simFromUrl` only, by
the master), `tests/unit/ride.integration.test.ts`, `tests/unit/replay.test.ts`, `tests/unit/jitter.test.ts`,
`tests/e2e/ride.spec.ts`, `tests/fixtures/rides/`.

## Decisions

### The model (`createJitter(seed, profile)`, pure, seeded)

`profile` is `"urban"` (the default for tests) or `"clean"` (today's 3 m). For each true position, time, speed and
heading it returns the fixes the phone would deliver (none, one or two):

- Base error: white noise 3 m plus a slow bias (Ornstein-Uhlenbeck, 5 m, 20 s).
- Multipath: an episode starts on average every 70 s and lasts 3 to 25 s. Its offset is 20 to 60 m in a random
  direction, reached within 2 s and wandering a little. In 60 percent of episodes the reported accuracy lies (4 to
  10 m); otherwise it is honest-ish (0.6 to 1 times the offset).
- Faults: 2 percent duplicates (the same fix again), 1 percent late fixes (a fix from 5 to 20 s ago arriving now,
  `receivedAt` now), 1 percent of seconds start a gap of 3 to 8 s with no fixes, and 1 in 400 a wild fix 100 to
  300 m out with an accuracy of 20 to 50 m.
- Speed and heading carry their own small noise (0.3 m/s, 8 degrees), and the heading is null below 1 m/s, as the
  plugin reports.

### Where it runs

- Simulator: `createSimSource(pack, { ..., jitter?: "urban" | "clean", seed? })`; the URL takes `&jitter=urban`
  and `&seed=`.
- `tests/unit/jitter.test.ts`: the model itself is repeatable for a seed and produces what it promises (episode
  sizes, lying share, faults).
- `ride.integration.test.ts`, new for every pack: "urban GPS jitter at 4.5 and 7 m/s (two seeds each)". Expect: the
  ride finishes, every stop is arrived at once and in order, every turn is spoken once and none late, every core
  story plays, no `off_route`, `wrong_way` or `detour`. The marker: the 95th percentile of the distance between
  `shown` and the true position under 15 m (18 m at 7 m/s), its largest step between fixes under the distance
  ridden plus 15 m, and never more than 15 m backwards along the line while riding (measured on the drawn marker,
  no further than it really moved). The sound timeline checks as for the clean rides.
  Changed after round 1: a turn the rider reaches while the phone gives no fix (a gap in the 8 s before it) stays
  unsaid, because said after the turn it would send the rider down the wrong street; at most 3 a ride, and never an
  alarm. A late turn within 12 s of a gap is the GPS too. "Continue onto ..." first heard at the junction asks
  nothing of the rider and is not a late turn.
- Same file: "a real wrong turn in urban jitter is still caught": at a junction the rider goes straight on for
  250 m off the line and comes back: exactly one `off_route` within 35 s of leaving the line, one `back_on_route`,
  and the ride finishes.
- `ride.integration.test.ts`: the strayer test keeps its expectations.
- `tests/e2e/ride.spec.ts`: per pack, a full browser ride with `jitter=urban`: finished, every stop, every core
  story, no off route, wrong way or detour, at most 3 turns unsaid in GPS gaps.
- `tests/fixtures/rides/chelsea-loop-urban-jitter.json`: a recording made through the model (generated like the
  seeded Royal Docks one, `MAKE_FIXTURE=jitter`), replayed with the rest. The doctored-recording test changes from a
  300 m teleport (which the filter now rightly ignores) to a rider who really wanders 300 m off the route.

## Acceptance

- All of the above pass on all three packs; `npm run check` and `npm run e2e`.
- The rounds file lists what the jitter hunt found and how each finding was fixed or explained.
