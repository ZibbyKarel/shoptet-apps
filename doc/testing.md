# Testing

Four test layers, three runners, one of them needing Docker. This page says
what each layer is for, how to run it, and what has to be up first.

---

## The layers

| Layer | Where | Runner | Needs Docker |
| --- | --- | --- | --- |
| **Unit** | `**/*.spec.ts(x)` in every project except the two `*-e2e` apps | Jest, via `nx run <project>:test` | no |
| **Database** | `apps/lets-park/api/**/*.db.spec.ts` | Jest, via `nx run api:test-db` | **yes** (PostgreSQL) |
| **API end-to-end** | `apps/lets-park/api-e2e/src/**/*.spec.ts` | Jest + axios, via `nx run api-e2e:e2e` | **yes** (PostgreSQL) |
| **Browser end-to-end** | `apps/lets-park/web-e2e/src/**/*.spec.ts` | Playwright, via `nx run web-e2e:e2e` | **yes** (PostgreSQL + the OIDC issuer) |

They are cumulative, not redundant. A rule of thumb for where a new test
belongs:

- **Unit** — a decision, a mapping, a rendering. No process, no socket, no
  database. This is where most of the suite lives and where it should stay.
- **Database** (`*.db.spec.ts`) — anything whose correctness *is* the database:
  a unique constraint, `SELECT … FOR UPDATE`, a transaction's rollback, two
  concurrent writers racing. These are excluded from `api:test` by
  `apps/lets-park/api/jest.config.cts` and run under their own config, `--runInBand`.
- **API end-to-end** — what the API does over real HTTP to a request a browser
  would never send: no `Authorization` header, a token from another issuer, a
  scheme that is not `Bearer`. `apps/lets-park/web-e2e` always arrives holding a valid
  session, so it structurally cannot ask these questions.
- **Browser end-to-end** — a whole user journey across both apps, the database
  and the socket. Expensive; reserved for the journeys in `apps/lets-park/web-e2e/src/`,
  one spec file each. What earns a file here is a claim no lower layer can
  make: two people disagreeing over the same bay, a setting saved on one
  screen changing another, a URL that stops answering. What does **not** is a
  rule the lower layers already settle on their own — the monthly reservation
  cap and the `FORCE_LOCKED` lockdown are both deliberately absent. The cap is
  decided in `monthly-reservation-cap.ts` and the lockdown in
  `reservation-policy.ts`; both are asserted in the unit and database layers,
  the cap including each of its three writers driven with an
  admin-configured number, and reproducing them here would cost a browser and a
  shared-state collision to re-test arithmetic. The cap does now have screens —
  the admin tab that sets it and the bulk-booking modal that renders it — and
  neither has a browser spec; whether that fifth admin tab earns a file of its
  own is an open question for this section, not a statement that the rule is
  untested.

---

## Writing a new browser spec

Four constraints, each of which has already cost this suite a day:

- **Take a day slot.** `support/dates.ts`'s `SPEC_DAY_SLOTS` hands each spec
  file one business day of the target month. A reservation is unique per
  `(spot, date)` and per `(user, date)`, so two files booking the same persona
  on the same day fail each other intermittently. Never write a literal date:
  it rots into a Saturday or 28 October, and `isReservableDay` then refuses
  every write for a reason that has nothing to do with the test. The slots are
  finite: twelve of them are taken, and the shortest possible target month has
  about nineteen business days, so there is room for a handful more files and
  then no more. `e2eDayForSlot` throws when a slot runs past the month rather
  than wrapping onto a day another file owns — so the wall, when you reach it,
  is a loud one, and the answer then is a second target month, not a literal
  date.
- **`fullyParallel` is on, so global state is shared.** The reservation-window
  row is a singleton; the spot roster, the user roster and their roles are one
  set of rows for the whole run. A spec may touch these, but only in ways no
  other file can notice: `admin-window.spec.ts` moves between `AUTO` and
  `FORCE_OPEN` and never to `FORCE_LOCKED` or a lower `openDaysBefore`, both
  of which would close the month everybody else books into;
  `admin-users.spec.ts` mutates only `Dev Inactive`, never one of the three
  personas other files sign in as; `admin-spots.spec.ts` creates its own bay
  rather than editing a seeded one. Restore what you change in `afterAll`, and
  tolerate a leftover on the way in — a teardown cannot promise anything about
  a run that was killed.
- **Assert your own day, not "the feed" or "the list".** An assertion that
  reads global state and expects to see only its own writes is a race with
  every other spec. `ics-feed.spec.ts` failed exactly this way: it asserted
  that no `SUMMARY:Parkování – E2.96` appeared anywhere in a personal calendar
  feed, while `admin-bulk-reservation.spec.ts` legitimately held an E2.96
  reservation for the same person on another day (E2.96 is Dev User's seeded
  preferred spot, and the bulk allocator prefers it). Scope to the date, the
  row, the spot you own.
- **Address the UI the way a person does.** Role plus the Czech accessible
  name the app actually renders, read out of `apps/lets-park/web/messages/cs.json` —
  there are no `data-testid` hooks in this application and none are to be
  added. Every wait is on a condition; a `waitForTimeout` passes on an idle
  laptop and fails on a busy one.

---

## What has to be running

```bash
docker compose --profile dev up -d
```

starts three containers (`docker-compose.yml`):

- **PostgreSQL 17** on `5432` — every layer below "unit" needs it,
- **`mock-oauth2-server`** on `8080` — the OIDC issuer the browser suite signs
  in against,
- **adminer** on `8081` — a database UI, convenience only.

Then, once:

```bash
cp .env.example .env            # if you have not already
cp .env.example apps/lets-park/web/.env   # Next.js reads its own directory
npx prisma migrate deploy
npx prisma db seed
```

`.env` is git-ignored and **does not travel with a git worktree**. If you are
working in one, copy it across — a missing `DATABASE_URL` is the usual cause of
a mysterious `P1000`.

Ports, because they are not free choices:

| Port | What |
| --- | --- |
| `3000` | the API (`PORT` in `.env`; Nx injects it into every target) |
| `4200` | the web app — `apps/lets-park/web/project.json` pins `next dev --port 4200`, because `CORS_ALLOWED_ORIGINS` and the OIDC redirect URI both name it |
| `5432` | PostgreSQL |
| `8080` | `mock-oauth2-server` |

The API's probes are at **`/health/live`** and **`/health/ready`** — *not*
under `/api`; `configure-app.ts` excludes them from `setGlobalPrefix`. The oRPC
transport is at **`/api/rpc/…`**, not `/api/…`.

---

## Running each layer

### Unit tests

```bash
npx nx run-many -t test              # everything
npx nx run web:test                  # one project
npx nx run web:test -- lot-view      # one file, by name pattern
npx nx run web:test -- --coverage    # with coverage
```

No Docker. This is what `nx run-many -t lint,typecheck,test,build` runs, and
what CI gates on.

### Database tests

```bash
npx nx run api:test-db
```

Needs PostgreSQL up and `DATABASE_URL` set. They run against the **real dev
database**, `--runInBand`, and clean up after themselves.

`prisma migrate reset` is not part of any of this and should not be reached for:
if the schema is behind, `npx prisma migrate deploy` is the command.

### API end-to-end

```bash
npx nx run api-e2e:e2e
```

Starts its own API (`dependsOn: ["api:build", "api:serve"]`), waits for the
port, runs the specs, and then **kills whatever is listening on port 3000** —
its `globalTeardown` calls `killPort`. Two consequences worth knowing:

- If you already have `nx run api:serve` up, this target will take it down with
  it when it finishes. Expect to restart your dev API afterwards.
- If an `api:serve` from another Nx invocation is already holding the target
  lock, this run will sit at *"Waiting for api:serve:development in another nx
  process"* and eventually fail in `globalSetup` with `[AggregateError]` from
  `waitForPortOpen`. Stop the other one first — and note that killing the
  *process* is not always enough: a serve whose Nx wrapper died untidily leaves
  the lock behind, and `npx nx reset` is what clears it.

To run the specs against an API you are already serving, skip the target and
run Jest directly from the project directory — same caveat about the teardown:

```bash
cd apps/lets-park/api-e2e && npx jest --runInBand
```

### Browser end-to-end

```bash
npx nx run web-e2e:e2e                              # the whole suite
npx nx run web-e2e:e2e -- src/cell-lock.spec.ts     # one spec
npx nx run web-e2e:e2e -- --headed --debug          # watch it happen
```

Everything it needs, it arranges:

1. **`globalSetup`** runs `prisma db seed` and then
   `libs/lets-park/database/src/scripts/reset-e2e.ts`, as subprocesses — the module
   boundary keeps `scope:web` out of `libs/lets-park/database` (`doc/decision/0184-*`).
   The reset clears next month's reservations and queue entries and sets the
   reservation window to `AUTO` at 31 days, so that the month the suite books
   into is genuinely open (`doc/decision/0181-*`). **It leaves that setting
   behind**; `npx prisma db seed` puts it back to 7 days.
2. **The servers.** These come from two different places, which matters more
   than it sounds:
   - **The API is started by Nx**, not by Playwright. `@nx/playwright` reads the
     `webServer` command naming `api:serve` and turns it into a real task
     dependency, so Nx runs it first and Playwright adopts the result. Nothing
     set in `playwright.config.mts` reaches that process — see the throttle
     entry under "When it goes wrong".
   - **The web app is started by Playwright**, as `npx next start --port 4200`
     in `apps/lets-park/web`: the **built** app, not `next dev`. `next dev` runs React
     `StrictMode`, which mounts every effect twice and gives each page a second
     socket.io connection; the built app does that far less
     (`doc/decision/0187-*`). The build is a real Nx dependency of `e2e`
     (`apps/lets-park/web-e2e/project.json`), Nx-cached, about six seconds cold.

   The API is adopted if port 3000 is already answering — Nx has by then
   started it. **The web app is not.** `reuseExistingServer` is `false` for it,
   so an occupied 4200 stops the run with *"is already used"* rather than
   letting the suite test whatever is there. It used to go through
   `nx run web:start`, which leaked a detached `next start` past Playwright's
   teardown and made the *next* run adopt it — 20 passed, exit 0, against the
   previous run's build, with no build having run at all
   (`doc/decision/0285-*`).
3. **The `setup` project** signs all three personas in through the real OIDC
   redirect and caches the sessions in `apps/lets-park/web-e2e/.auth/` — git-ignored, and
   rewritten on every run (`doc/decision/0185-*`; the path was
   `apps/lets-park/web-e2e/apps/lets-park/web-e2e/.auth/` until `doc/decision/0287-*`, which is why
   two `.dockerignore` rules written for it excluded nothing).

   It also runs `build-identity.setup.ts`, which fails the whole run when the
   app answering on the base URL is not the build this workspace just produced.

Only Chromium runs (`doc/decision/0182-*`), and `retries` is `0` on purpose: a
scenario that only passes on the second attempt is a bug report, not a nuisance.

`fullyParallel` is on (from `nxE2EPreset`), so **the tests inside one file run
concurrently in separate workers**. That is easy to forget and it has bitten
this suite once already: two tests in `cell-lock.spec.ts` shared a bay, and
because a cell lock is *acquired* per user, each test's dialog was renewing the
other's hold and each `closeDialog` was dropping it. A test that mutates shared
state needs its own bay — see `SPOTS` in that file, and `SPEC_DAY_SLOTS` in
`support/dates.ts` for the same discipline between files. (Since
`doc/decision/0220-*` a release also has to come from the *connection* that
holds the cell, which narrows that particular collision but does not remove the
rule: two tests on one bay still contend for it.)

To see what the sockets are actually doing, set `E2E_TRACE_REALTIME=1`. Every
`day:*` and `cell:*` packet each page sends or receives is printed with a short
clock and a label identifying the **page** — `w3/user#1`, worker and ordinal —
along with every WebSocket that page opens (`OPEN`), every document it loads
(`LOAD`) and, per document, one `DOC <id> #<n>` line per socket that document
constructed. Labelling by persona alone is what made two concurrent pages read
as one page with two sockets, so the ordinal is load-bearing — and counting
`OPEN` per *page* rather than per *document* is what made an ordinary reload
read as a duplicate connection, which is what the `DOC` lines exist to stop
(`doc/decision/0221-*`). Nothing else is printed, deliberately: the socket.io
handshake carries the access token and matches neither name.

---

## The seven journeys

| Spec | What it proves |
| --- | --- |
| `login.spec.ts` | An unauthenticated visitor is bounced to `/login`; the button starts a real authorization-code flow (PKCE, `state`, `scope=…email…`) at the issuer; the session that comes back is one the **API** accepts; signing out re-protects the lot. |
| `identity.spec.ts` | Each persona is the seeded person — name, email, and role. The role is a database column; nothing in the token grants it. |
| `reservation.spec.ts` | A user reserves a free bay and sees their name and their profile's plate on it; the reservation survives a reload; the holder cancels it and the bay is free again. |
| `waitlist-promotion.spec.ts` | Two users: one books, the other queues and is told their position, the first cancels — and the bay is handed to the queue with nobody clicking anything. |
| `cell-lock.spec.ts` | Two users on one day: one opens a bay's dialog and the other's tile hatches over as *"právě upravuje Dev User"* and stops being clickable, live over the socket; closing releases it; the holder never sees their own hold. |
| `admin-reservation.spec.ts` | An admin opens someone else's bay from the `⋯` affordance, gets the admin dialog, and cancels it — and the bay is free for its former holder too. An ordinary user gets no `⋯`. |
| `ics-feed.spec.ts` | The calendar URL is read out of the Nastavení modal, fetched by a request context that has never signed in, and contains the reservation; a wrong token is a 404 that looks like any other 404; cancelling removes the event. |
| `realtime-connection.spec.ts` | One document, one socket.io connection — asserted in the **built** app, after a day walk and an open editing form, and again on the document a reload produces. The claim `doc/decision/0221-*` had to measure because `doc/decision/0187-*` had counted it per page. |

Each spec books its **own** business day of the target month
(`SPEC_DAY_SLOTS` in `src/support/dates.ts`), so specs can run in parallel
without colliding on the one-reservation-per-user-per-day rule. Add a spec, add
a slot.

---

## When it goes wrong

### Before anything else: kill 3000 and 4200

```bash
lsof -ti tcp:3000 tcp:4200 | xargs kill -9
```

**This is now enforced rather than remembered, and the paragraphs below are
kept because they are the reason.** For a long time `reuseExistingServer` was
`!process.env['CI']` — `true` on every path that existed, since CI ran no e2e
job at all — so Playwright **adopted** whatever was already listening instead
of starting its own. A `next start` left over from an earlier run serves the
**previous build**, so a change you just made to application source is not in
the app the browsers are driving.

This is not hypothetical, twice over. During review of this suite, a
falsification — `OKTA_SCOPES` with `email` removed — came back **green with the
mutation in place**, because a stale server was serving an unmutated bundle.
And the suite was leaving that server behind itself: `nx run web:start` put
`next start` in a process group Playwright's teardown could not reach, so run 2
adopted run 1's server, reported 20 passed, and never ran a build
(`doc/decision/0285-*`).

Both halves are closed. The web server is started so that it dies with the run,
`reuseExistingServer` is `false` for it, and `build-identity.setup.ts` fails
the run if the app answering is not the build just produced. An occupied 4200
now stops the run with *"is already used"*, which is what the command above is
for. **Nothing in a suite's output tells you it tested the wrong server — so
prefer the mechanism to the memory, and keep killing the ports before believing
any result that surprises you.**

The same applies to the API, for a different reason — see the throttle entry
below: Nx starts it, not Playwright, so an API left running keeps whatever
environment it was started with.

**Everything 401s, with `The token does not identify a provisionable user.`**
The token reaching the API has no `email` claim. The e2e login types one into
`mock-oauth2-server`'s *Optional claims JSON* field — see
`doc/decision/0180-*`. If you are signing in by hand, type
`{"email":"user@example.com","name":"Dev User"}` into that box too.

**Everything 401s, with a bare `Unauthorized` and no message.** The API has
cached a JWKS key that the issuer no longer has. `mock-oauth2-server` re-mints
its keys when its container starts, so this follows a
`docker compose restart mock-oauth2-server`. **Restart the API.**

**Several unrelated specs fail with `Skupina IT` missing, or a bay that never
shows its holder.** Look for `"statusCode":429` on `/api/rpc/overview/day` in
the API's log. The suite issues ~200 requests from one address per run, and the
default throttle is 300 per rolling minute — so runs stacked back to back can
trip it, and the lot screen renders a throttled day query as its error state.

**The suite cannot raise those limits for you, and does not pretend to.** `nx
show project web-e2e --json` shows `dependsOn: [{projects: ['api'], target:
'serve'}]` — inferred by `@nx/playwright` from the `webServer` command in
`playwright.config.mts`. So **Nx** starts the API, with Nx's environment, and
Playwright adopts it; an `env` block in the Playwright config never reaches it.
Verified against a running suite: `X-RateLimit-Limit: 300`, strict `20` — the
shipped defaults. (`doc/decision/0186-*` records the measurement and why the
inert `env` block was removed rather than left looking effective.)

The remedy is to start the API yourself, before the suite, with limits that suit
a machine driving browsers — Playwright will adopt that one:

```bash
lsof -ti tcp:3000 | xargs kill -9
THROTTLE_LIMIT=10000 THROTTLE_STRICT_LIMIT=1000 npx nx run api:serve
```

Or simply wait a minute between runs; a single run fits inside 300.

**`cell-lock.spec.ts` fails, saying a tile still reads `Volné`.** Something
released the hold while the dialog was still open. A hold is *acquired* per
user, so anything asking for the same cell as the same user takes it over — and
until `doc/decision/0220-*` any of that user's connections could also drop it.

In order of likelihood:

- **A new test in that file shares a bay with an existing one.** `fullyParallel:
  true` runs the tests of one file in separate workers at the same time, so one
  test's `closeDialog` releases the other's hold. This is what the `SPOTS` map
  at the top of the spec exists to prevent — one bay per test. Measured during
  review, before the split: 4 failures in 14 runs at default parallelism, 0 in 8
  at `--workers=1`, 0 in 10 with distinct bays. **It does not reproduce on
  demand**, though: putting both tests back on one bay and running it again gave
  22 green runs in a row. The window is small; a green run proves nothing about
  sharing a bay.
- **You are running against a dev server.** `StrictMode` gives every page a
  second socket.io connection, which sits in the same day room. Measured at 5
  failures in 20 runs against `web:dev`. Kill 4200 and let the suite start
  `web:start` itself.
- **Another tab, or a page that reloaded.** One user with two live connections
  on one cell is ordinary use, and it was the whole of the exposure the
  "duplicate connection" scare was standing in for. Since `doc/decision/0220-*`
  the connection that opened **first** can no longer release the hold — but the
  one that opened **second** still can, because its `cell:lock` re-keyed the
  hold onto itself and acquisition is per user by design. If a tile drops to
  `Volné` under an open dialog, look for a second connection of the same
  persona before looking anywhere else. `doc/realtime.md` §"Known residual".

*Not* a cause, despite an earlier version of this section: "about one page in
three opens a second socket.io connection against the built app". That number
counted sockets per Playwright `Page`, and six of this suite's pages load a
second document. Per document it is one socket, 89 times out of 89
(`doc/decision/0221-*`).

Reproduce any of them with `E2E_TRACE_REALTIME=1`. Count `DOC` lines, not `OPEN`
lines: a `DOC <id> #2` is a document that opened two sockets and is a real
finding, whereas two `OPEN` lines under one page label are usually just two page
loads — compare them against that page's `LOAD` lines.

There is no retry configured, and there should not be: this failure is a bug
report.

**`login.spec.ts` fails on the *second* `toHaveURL` of the sign-out test, with
`Received string: "http://localhost:4200/"`.** This **was** a known open defect —
sign-out was not reliably durable, measured at 3 failures in 35 full-suite runs.
**It is fixed** (`doc/decision/0230-*`): sign-out now revokes the session
server-side, so a cookie that survives the clear is refused and deleted on its
next use.

If you see it again, it is a regression, not the known flake. What was measured,
so you can tell them apart: `/api/auth/session` is never requested **on the
sign-out path** — the hypothesis in the original record was wrong — and the
cookie came back because **every render that reads the session re-issues it**,
so the sign-out clear was racing concurrent `?_rsc` prefetches. The fix does not
depend on winning that race: it revokes the session's subject, and re-encoding
never changes that subject.

The property is now also asserted deterministically, by *a session cookie kept
from before sign-out is refused afterwards* in the same spec: it takes the
cookie while signed in, signs out through the menu, puts the cookie back and
expects a redirect. That one needs no load and fails every time on a
cookie-deletion-only sign-out, so it — not the racy one — is the test to look at
first when this area breaks.

To capture cookie traffic while diagnosing anything in this area, set
`E2E_AUTH_LOG_DIR=/some/tmp/dir`; `src/support/auth-network-log.ts` writes the
request and response cookie **names** and a one-way digest of each value, in
order, and never a token (`doc/decision/0232-*`).

**A spec times out on the first visit to a route.** Same cause as above, seen
from a different angle: `next dev` compiles a route on demand — `/settings` has
been measured at 4.9 s, past Playwright's 5 s default. `openSettings()` in
`src/support/lot-page.ts` carries a 30 s allowance for exactly this
(`doc/decision/0183-*`); a new spec visiting a new route against a reused dev
server should use the same constant rather than inventing a number.

**`auth.setup.ts` times out on `sign in as <persona>`.** Seen once during review
of this suite, and **not reproduced since: 0 failures in 105 sign-ins** (35
full-suite runs × 3 personas). So there is no diagnosis here, only the shape of
the thing: the `setup` project signs all three personas in *concurrently*
against a single `mock-oauth2-server` container, and the whole sign-in — two
redirects, a form, a code exchange and a first render of the lot — has to fit
inside Playwright's 30 s test timeout. If it comes back, that concurrency and
that budget are where to look first; `--workers=1` on the `setup` project alone
would tell you which.

**`P1000` from anything Prisma.** `DATABASE_URL` is missing or wrong. It lives
in the git-ignored `.env` at the repo root, which does not travel with a
worktree.

**Port 3000 goes away in the middle of something.** `nx run api-e2e:e2e`'s
teardown kills it. See the API end-to-end section above.

---

## Writing a new test

- **Write it with the code it covers**, not afterwards — `plan.md`, §Working
  style.
- **Then break the thing it names and watch it go red.** A test that would
  still pass with its subject deleted reports coverage that does not exist,
  which is worse than no test at all. Every scenario in `apps/lets-park/web-e2e` was
  falsified this way before it was committed; the mutation table is in the
  task report.
- **Never wait on a clock.** `page.waitForTimeout(2000)` passes on an idle
  laptop and fails on a busy one. Playwright's assertions retry; `waitForURL`
  and `toPass` exist. Two specs in this repository have already had to be
  rewritten for exactly this.
- **A flake is a bug.** Isolate it, run it twenty times, find the cause. The
  throttle finding above started as "four unrelated specs failed once". Do not
  add a retry.
- **Reach for the cheapest layer that can fail for the right reason.** A rule
  belongs in a unit test; only a journey belongs in Playwright.
