# 0187 – The browser e2e suite runs against the built app, not `next dev`

## What

`apps/garage/web-e2e/playwright.config.mts` starts the web app with

```
npx nx run web:start -- --port 4200
```

instead of `npx nx run web:dev`. `start` already declares `dependsOn: ['build']`,
so a run builds the app (Nx-cached; ~6 s cold, instant warm) and serves the
output with `next start`. Same port, same environment, same API.

## Why

**Because `next dev` is not the application, and the difference cost this suite
a 25% flake.**

`cell-lock.spec.ts` failed 5 runs in 20, in isolation, on an otherwise idle
machine. The symptom was always the same and always misleading: the observing
user's tile read `Volné` when it should have read *"právě upravuje Dev User"*,
as though the broadcast had never arrived.

It had arrived. Tracing every socket.io packet on both pages
(`E2E_TRACE_REALTIME=1`, `apps/garage/web-e2e/src/support/realtime.ts`) produced this,
twice, on two independent failures:

```
67486 user      OUT 420["cell:lock",   {"date":"2026-10-05","parkingSpotId":"01a0…"}]
67486 user-two  IN   42["cell:locked", {…}]
67486 user      IN   42["cell:locked", {…}]      ← the holder hears its own lock
67517 user      OUT 420["cell:lock",   {…}]      ← and takes it a second time
67519 user-two  IN   42["cell:locked", {…}] ×2
67533 user      OUT  42["cell:unlock", {…}]      ← while the dialog is still open
67533 user-two  IN   42["cell:unlocked",{…}] ×2
```

Three facts, in order:

1. **The holder receives its own `cell:locked`.** The gateway sends that
   broadcast to the day room *excluding the asking socket*
   (`realtime.gateway.ts`, `emitToDay('cell:locked', payload, except)`). A page
   can only hear its own lock if it has a **second socket**.
2. It has. Logging every `WebSocket` a page opens shows two distinct socket.io
   connections — two `sid`s, tens of milliseconds apart — and every
   `day:subscribe` emitted twice.

Under `next dev` that is React `StrictMode` mounting the tree twice, which is
what it is *for*. **`StrictMode`'s double invoke is development-only**, so
serving the built bundle removes that cause — and the brief for this suite says
it should run the same application code production runs, which `next dev` was
the one place in this repository that did not.

Measured, on the same machine, `cell-lock.spec.ts` alone:

| server | runs | failures |
| --- | --- | --- |
| `web:dev` | 20 | **5** |
| `web:start` | 26 | **1** |

and the whole suite is faster with it — 18 passed in 6.6 s against `next start`
versus 13–16 s against `next dev`, because nothing is compiled on demand.

### What this decision did *not* fix, corrected against measurement

An earlier version of this record claimed the built app "opens one socket" and
duplicates "rarely — 1 run in 26". **Both were wrong**, and the second was a
category error: 1-in-26 was the rate at which a *test went red*, not the rate at
which a duplicate connection occurred. The two are not the same thing.

Counted properly — four full-suite runs, ports 3000 and 4200 killed before each,
every page labelled by worker and ordinal so two pages of one persona cannot be
mistaken for one page with two sockets:

| sockets opened by one page | pages |
| --- | --- |
| 1 | 45 |
| 2 | **23** |

**68 pages, 23 of them duplicated — about one page in three, against the built
app.** Never three. So the duplicate connection is common, not rare, and
`StrictMode` cannot explain the ones that remain: a production React build does
not double-invoke effects. **The cause is unknown.** It is somewhere in
`libs/garage/realtime-client/src/lib/connection.tsx`'s connection effect — its
`[url, path, enabled, generation]` dependency list against a cleanup whose
`next.disconnect()` evidently does not always take the first socket down.

> **Corrected — there is no duplicate connection, and this paragraph is the
> third wrong reading of the same log. See `doc/decision/0221-*`.**
>
> The count is right and the container is wrong. `page.on('websocket')` spans a
> whole Playwright `Page`, and a `Page` is not a document: six of this suite's
> pages `reload()` or `goto()` a second time, and a second document opens a
> second socket because that is what a page load does. 17 pages + 6 second loads
> = the 23 sockets counted here.
>
> Measured **per document** — an init script, which Playwright runs once per
> document, tagging each socket with the realm that opened it — across four full
> traced runs: **89 documents, 89 sockets, none with more than one.** (That
> histogram was collected with a counter since replaced, and has not been
> re-collected; `doc/decision/0221-*` labels its provenance and says why the
> retraction does not rest on it.) The
> paragraph above was written having correctly ruled `StrictMode` out and then
> having kept the phenomenon anyway; and it was checkable from the traces
> already quoted in this record, where every "second socket" re-walks the
> calendar from today, which is what a fresh document does and what a
> double-mounted React tree does not.
>
> Nothing in `libs/garage/realtime-client` needed changing, and nothing was changed.
> `apps/garage/web-e2e/src/realtime-connection.spec.ts` now pins one-document-one-socket
> in the built app.

Two things are worth recording about the *consequences*, because they are milder
than the earlier version of this record implied:

- In the traces, only **one** `cell:lock` is emitted per dialog open, even on a
  page with two sockets. The second connection sits in the day room receiving
  broadcasts nobody consumes; it is not, on this evidence, taking a second hold.
- All four of those runs passed, 18/18. The redness this record originally
  blamed on the duplicate connection was in fact `cell-lock.spec.ts` colliding
  with *itself* — two tests sharing one bay under `fullyParallel: true`, so one
  test's `closeDialog` released the other's hold. That is a test defect and it
  is fixed in the spec (`cell-lock.spec.ts`, `SPOTS`).

So: a real application defect, still unexplained, still worth its own task — but
not the thing that was failing the suite, and this record should not have said
it was. The lingering socket's practical cost is a stale room membership and
whatever a future teardown of it would emit.

> **Corrected: not a defect at all** — see the note above and
> `doc/decision/0221-*`. There is no lingering socket. The observation in the
> first bullet — one `cell:lock` per dialog open even on a "two-socket" page —
> was the evidence for that and was read as a mitigation instead of as the
> answer: only one connection was ever live, so only one could ask.

`E2E_TRACE_REALTIME=1` reproduces the measurement in one command, which is why
that switch is kept — and why its labels now name a page rather than a persona
(`w3/user#1`), since the un-labelled version is exactly what made two concurrent
pages read as one misbehaving one.

### Why the application fix is not in this task — and which fix it should be

Not because it is wrong. Because it is an application change with its own tests
and its own review, and this is an e2e task.

An earlier version of this record went further and **ruled out the cheap fix on
reasoning the code contradicts**. It said keying `release` by socket would make
a reconnect answer `HELD_BY_OTHER` — "the user told they are editing against
themselves". That is not what happens. `LockService.acquire` takes the same-user
branch and **overwrites `socketId`** with the requester's, so a reconnect is a
renewal that re-keys the hold; `releaseSocket` depends on precisely that and
says so in its own comment ("a renewal from a reconnected socket overwrote it,
so the old socket's late disconnect matches nothing and the fresh hold
survives"). A `release(cell, userId, socketId)` that matched the same way would
make a duplicate connection harmless without touching reconnect behaviour at
all.

So the two candidate fixes, stated correctly:

- **Key `release` by socket** — the cheap, proximate hardening. Not blocked by
  anything in `lock.service.ts`; the objection recorded here previously was
  simply false, and is retracted. Whoever takes it should start from `acquire`'s
  same-user branch.
- **Find out why a page ends up with two connections** — the root cause, in
  `libs/garage/realtime-client/src/lib/connection.tsx`. Harder, and the one that makes
  the first unnecessary.

> **Both were addressed in Task 32; only one of them was a defect.** The first
> was done — `doc/decision/0220-*`, `release` now matches `(user, socketId)`
> exactly as `releaseSocket` does. The second had no root cause to find: a page
> ends up with two connections by loading two documents
> (`doc/decision/0221-*`), so it does *not* make the first unnecessary.
>
> **The two-tab hazard named below is narrowed, not closed** — see the
> correction under it. An earlier version of this note said "closed", which was
> the fourth wrong statement this record has carried.

There is also a real (narrow) product consequence of user-keyed release worth
naming: **two tabs, same user, same cell — closing the dialog in one releases
the hold the other still shows as held**, until that tab's next renewal (up to
half the TTL, ~15 s). A courtesy lock briefly lying is within what
`lock.service.ts` documents as its remit, and the API re-checks everything on
`reservation.create` regardless. Recorded as a finding, not smuggled into a test
change.

> **Narrowed in Task 32, and still open in one direction**
> (`doc/decision/0220-*`). This finding turned out to be the *entire* defect the
> "duplicate connection" was thought to be a symptom of: a user really can have
> two live connections on one cell, and the way they get them is a second tab or
> a reload rather than anything wrong in `libs/garage/realtime-client`.
>
> What changed: `release` now matches `(user, socketId)`, so the tab whose
> dialog opened **first** can no longer drop the hold. What did **not** change:
> the tab that opened **second** still can. Its `cell:lock` was a renewal that
> re-keyed the hold onto its own socket, so its `cell:unlock` is a legitimate
> release by the recorded owner — and the first tab's form is still open, still
> saying `held`, for up to half a TTL (~15 s at 30 s, `CELL_LOCK_RENEW_FRACTION
> = 0.5`) until its heartbeat takes the cell back.
>
> Measured, not argued, over real sockets — `realtime.gateway.spec.ts`, "still
> lets the newest connection of a user drop a hold their older tab is showing":
> `cell:unlocked` broadcast count **1**, and a third user's `cell:lock` answers
> **ACQUIRED**. Its counterpart in the same file asserts the opposite for the
> superseded direction, and both pass.
>
> Closing it properly means changing how a hold is *acquired*, which is what
> makes a reconnect a renewal — a product decision about what a courtesy lock
> means across one user's own tabs, not a bug fix. It is written up for a
> product owner in `doc/realtime.md` §"The editing hold".

### Why not just disable `StrictMode`

It would fix the flake by removing the check that found a real bug, for every
developer, in every feature. `StrictMode` did its job here.

## How

- `apps/garage/web-e2e/playwright.config.mts` — the second `webServer` entry.
- `apps/garage/web/project.json` needs no change: the `start` target inferred by
  `@nx/next` already depends on `build`; `--port 4200` is passed on the command
  line for the same reason `dev` pins it — the workspace `.env` carries
  `PORT=3000`, which belongs to the API.
- `apps/garage/web-e2e/src/support/realtime.ts` — the tracing that found this, kept and
  documented, behind `E2E_TRACE_REALTIME=1`.

## Risk

- **A reused server means the suite may not exercise what this record says it
  does.** `reuseExistingServer` is on outside CI, so a developer with
  `nx run web:dev` already up gets the dev server and its `StrictMode`
  duplicates — Playwright does not reconfigure a process it did not start.
  Worse for anyone falsifying: a `next start` left over from an earlier run
  serves the **old build**, so a mutation to application source can come back
  green. That happened during review of this task and is the reason
  `doc/testing.md` now opens its troubleshooting section with "kill 3000 and
  4200 first".
- **The suite no longer exercises `next dev`.** It never meaningfully did:
  nothing here asserts on Fast Refresh or on development-only behaviour. What is
  lost is the chance of noticing a `next dev`-only regression from the e2e
  suite, which is not what an e2e suite is for.
- **A run now depends on a build succeeding.** `nx run web-e2e:e2e` already
  depended on `api:build`, so this adds a second cached build to the same
  chain — measured at ~6 s cold and nothing warm.
