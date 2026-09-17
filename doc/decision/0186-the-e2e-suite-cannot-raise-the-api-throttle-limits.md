# 0186 – The e2e suite cannot raise the API throttle limits

## What

Nothing. The suite runs against the API's shipped throttle limits —
`THROTTLE_LIMIT=300` per minute and `THROTTLE_STRICT_LIMIT=20` — and has no way
to change them.

This record used to say the opposite. An earlier version of it, titled *"The
e2e API gets throttle limits that suit a test run"*, described a
`webServer[0].env` block in `apps/garage/web-e2e/playwright.config.mts` setting
`THROTTLE_LIMIT=10000` and `THROTTLE_STRICT_LIMIT=1000`. **Those two variables
never reached the API.** The block has been removed and this record rewritten to
describe what happens.

## Why the mitigation was inert

`@nx/playwright` reads the `webServer` commands when it infers the `e2e` target.
Any command that names an Nx target becomes a **task dependency**:

```
$ npx nx show project web-e2e --json | jq .targets.e2e.dependsOn
[{ "projects": ["api"], "target": "serve" }]
```

That entry exists only because `webServer[0].command` is
`npx nx run api:serve`. So the ordering is: Nx starts the API, with Nx's
environment; Playwright then probes `/health/ready`, finds port 3000 already
answering, and adopts the process. Playwright's `env` applies to servers
Playwright *starts*, and under `nx run web-e2e:e2e` it never starts this one.

Measured against a suite run in progress:

```
$ curl -si localhost:3000/api/health | grep -i ratelimit
x-ratelimit-limit: 300
x-ratelimit-remaining: 299
```

300, not 10000 — the shipped default. The strict limit reads 20, not 1000, the
same way.

## Why the 429 flake was real anyway

The failure the old record described did happen, and the diagnosis of it stands.
Twenty consecutive runs against one long-lived API produced:

```
run 1 exit=0 18 passed
run 2 exit=0 18 passed
run 3 exit=1  4 failed 13 passed
run 4 exit=1  6 failed  9 passed
```

with `52 × statusCode 429` in the API log, every one on
`POST /api/rpc/overview/day`. The specs reported
`getByRole('region', { name: 'Skupina IT' })` not found and a bay that never
showed its holder, because the lot screen renders a failed day query as its
error state: a throttled request reads as "the reservation was not created".
Four unrelated scenarios blamed themselves for one cause.

The arithmetic: one run issues on the order of two hundred requests from a
single address in about twenty seconds, against a sliding window of 300 per
sixty seconds. One run fits. Two runs started inside the same minute — which is
what `edit, re-run, re-run` is — do not.

## What actually keeps runs green

Time, and only time. The sliding window empties, and a run that starts on a
drained window fits inside it.

Measured after this task's changes, twenty consecutive `nx run web-e2e:e2e`
invocations, ports 3000 and 4200 killed before the loop, each run's API log
searched for `"statusCode":429`:

> **0 × `"statusCode":429` across 20 runs.** Eighteen of the twenty were
> `18 passed`; the two failures were a different defect entirely
> (`login.spec.ts:76`, see `doc/testing.md`), not a throttled request.

Why zero, when the old record measured 52 in a similar loop: the loop runs the
suite *sequentially*, and one run plus its Nx build and teardown takes long
enough that the previous run's requests have aged out of the sliding window by
the time the next run's first request arrives. Nothing was configured to make
that true. A tighter loop, a second suite on the same machine, or a developer
clicking through the app while the suite runs would all put it back.

That is not a mitigation, it is a margin — and it is a margin the suite spends
whenever a run is started before the previous one's window has drained, or
whenever anything else is talking to the same API from the same address.

## The operator remedy

When a run fails this way, the symptom is `429` on `overview/day` in the API log
and specs failing on missing `Skupina IT` regions. Two ways out, both outside
the suite:

1. **Wait a minute** and run again. The window is sliding; it drains on its own.
2. **Start the API with larger limits yourself**, since the suite cannot do it
   for you:

   ```
   THROTTLE_LIMIT=10000 THROTTLE_STRICT_LIMIT=1000 npx nx run api:serve
   ```

   then run `npx nx run web-e2e:e2e` against it. `reuseExistingServer` is on for
   the API entry unconditionally, so the suite adopts that process and its
   limits.

`doc/testing.md` carries both, next to the symptom.

## Why not make the values reach the API instead

Because the honest options are all worse than documenting the truth.

- **Setting them in `apps/garage/api/project.json`'s `serve` target** would give every
  developer's `npm run dev` a 10000/minute throttler. That is a production-shaped
  guard silently disabled in the environment where it is most likely to catch a
  runaway client.
- **A separate `api:serve-e2e` target** would mean the e2e suite exercises a
  target production never runs — against this project's standing arrangement
  that one set of code is pointed at different *values* per environment
  (`doc/decision/0009-*`, `doc/environment.md`) — for a flake that a drained
  window does not produce.
- **Removing the `webServer[0]` entry and starting the API from a wrapper
  script** would take the `dependsOn` inference with it — the entry is what
  *declares* that the API must be up — and replace one Nx-managed process with a
  hand-rolled one.

None of these buy anything the operator remedy does not, and each spends
production-likeness to get it.

## How

- `apps/garage/web-e2e/playwright.config.mts` — `webServer[0]` has no `env` block, and
  a comment saying why one would not work.
- `doc/testing.md` — the symptom, and the two remedies.
- Nothing in `apps/garage/api` changes, and nothing ever did.

## Risk

- **A run started inside the previous run's window can still go red on `429`,
  and nothing in the suite prevents it.** Accepted, documented, and cheap to
  recognise once you know the symptom. `retries: 0` (see the comment on it in
  `playwright.config.mts`) means it surfaces as a failure rather than being
  retried into silence — which is the point: a scenario that passes on the
  second attempt is hiding something, and a throttled first attempt is exactly
  the kind of something worth seeing.
- **The suite cannot notice if the throttler broke.** It never could — no
  scenario asserts a `429`. The throttler's coverage is in `apps/garage/api`'s unit
  tests, where the numbers are inputs rather than ambient configuration.
