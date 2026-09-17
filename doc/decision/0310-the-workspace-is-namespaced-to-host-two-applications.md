# 0310 – The workspace is namespaced to host two applications

**Date:** 2026-09-11 · **Status:** accepted · **Task:** repository owner's request ·
**Builds on:** `doc/decision/0308-tanstack-query-is-used-directly-no-wrapper-lib.md`

## What

A second application — a feature-request / wishlist board for the users of
`shoptet-partner-cli` — will live in this repository rather than one of its
own, because it is built on this workspace's design system and the same stack.
To make it unambiguous which project belongs to which application, every app
and lib moved into a namespace directory:

```
apps/garage/{web,web-e2e,api,api-e2e}
libs/shared/{design-system,form,i18n,api-client}
libs/garage/{contract,database,auth,realtime-client,calendar-export,shared-types}
```

`libs/shared/` is for libs with more than one consuming application.
`libs/garage/` is for libs that only this application uses. A future
`apps/<second-app>/` and `libs/<second-app>/` follow the same shape.

This commit is **only the move**. Nx project names (`web`, `api`,
`contract`, …) and package names (`@garage/*`) are deliberately unchanged —
see "What this deliberately did not do".

## The rule used to classify each lib

Not "does this lib contain non-trivial code". `doc/decision/0308-*` already
settled the test this workspace uses, and it is **consumer count**: it deleted
`libs/query` because "there is exactly one consumer of TanStack Query in this
workspace, so a wrapper lib bought no swappability it wasn't already getting
for free", and accepted losing mechanical enforcement as the price.

A second application inverts that arithmetic for whatever it actually shares.
So each lib was classified by how many applications will consume it, with the
repository owner's stated intent as the discriminator where the answer is not
yet observable:

| lib                                     | consumers | placement          | why                                                                            |
| --------------------------------------- | --------- | ------------------ | ------------------------------------------------------------------------------ |
| `design-system`, `form`, `i18n`          | 2         | `libs/shared/`      | confirmed shared — the design system is the reason the second app lives here    |
| `api-client`                             | 2         | `libs/shared/`      | confirmed: the second app keeps oRPC and the same contract conventions          |
| `contract`, `database`                   | 1         | `libs/garage/`   | domain schemas; the second app gets its own                                     |
| `realtime-client`                        | 1         | `libs/garage/`   | the second app has no realtime — see below                                      |
| `calendar-export`                        | 1         | `libs/garage/`   | ICS export is a parking feature                                                 |
| `auth`                                   | ?         | `libs/garage/`   | the second app's login is undecided — placed by today's fact, not by hope       |
| `shared-types`                           | 1         | `libs/garage/`   | its name is misleading; see below                                               |

### `realtime-client` was not split, on purpose

An earlier reading of this lib proposed splitting it into a generic transport
half (`socket.io`, connection, validation) and a domain half (`cell-lock.ts`,
`useDayRoom`). That was speculative work for a consumer that does not exist:
the second app has no realtime. One project, whole, under `libs/garage/`.
If a second realtime consumer ever appears, the split is the same work then,
with a real second use to shape it.

### `auth` is classified by present fact, not by intent

The second application's login will not be Okta, and beyond that it is
undecided. Placing the lib in `libs/shared/` would assert a sharing that may
never happen, so it sits with its one consumer.

When that decision is made, the constraint that resolves it is **not** whether
the new identity provider is OIDC-shaped. Most of this lib already is
provider-agnostic — `refresh.ts`, `revocation.ts`, `access-token.ts` and the
session projection are plain OAuth2/OIDC machinery, and only the provider
registration in `config.ts` plus `OKTA_PROVIDER_ID` name Okta. The binding
constraint is `src/lib/session.ts`'s `declare module 'next-auth'`: **one
package can carry only one `Session` shape**. If the two applications' session
shapes genuinely differ, the lib splits regardless of how similar their
identity providers are. Verify that before promoting it.

### `shared-types` now has a misleading name

It holds `date-only.ts` and `prague-time.ts` (generic), and
`domain-constants.ts`, `reservation-window.ts` and the business-day / Czech
holiday calendar (pure parking domain). It is under `libs/garage/` because
the second app needs none of it. It was not pre-split or renamed for the same
reason `realtime-client` was not: there is no second consumer to shape the
seam. Rename it when one arrives, or when the name next causes a mistake.

## Known debt this move makes visible

Two libs sit in `libs/shared/` while still bound to this application. Neither
is caught by anything: the Nx `scope:` tags do not encode the namespace, and no
rule forbids a `libs/shared/*` project depending on a `libs/garage/*` one.
Lint, typecheck and the suites all pass.

### `libs/shared/i18n` re-exports `libs/garage/shared-types` wholesale

`libs/shared/i18n/src/index.ts` opens with `export * from
'@garage/shared-types'`, per `doc/decision/0003-date-helpers-in-shared-types.md`,
and `shared-types-reexport.spec.ts` pins that it works. So a shared-namespace
lib re-exports an application-namespace one, and the moment the second
application imports `@garage/i18n` it transitively receives
`reservation-window.ts`, `domain-constants.ts` and the Czech business-day
calendar — and `shared-types` acquires its second consumer, which by the
consumer-count rule above would move it to `libs/shared/`.

Two honest resolutions, and this move deliberately took neither, because both
are shaped by what the second application actually needs from the date logic
and that is not yet known:

- Move `shared-types` to `libs/shared/` — accepting that the parking-domain
  half travels with it, which is the reason its name is already misleading.
- Stop `i18n` re-exporting it, and split the generic date logic
  (`date-only.ts`, `prague-time.ts`) from the parking domain — which is the
  `shared-types` split this record declines to do speculatively.

Resolve it when the second application's first `@garage/i18n` import is
written, not before, and not after.

Every project now carries an `app:` tag (`app:garage` or `app:shared`),
added so that per-application commands select on something that survives the
project rename below. That tag is also the mechanism that would catch this: an
`@nx/enforce-module-boundaries` constraint forbidding `app:shared` from
depending on `app:garage`. It is deliberately **not** configured, because
it fails on exactly this one edge today and turning it on would force the
resolution this section just argued against making speculatively. Add the
constraint as part of resolving the re-export, not before it.

### `libs/shared/api-client` is bound to this application's contract

`libs/shared/api-client` sits in the shared namespace but is still bound to
this application's contract in two different ways:

- `api-client.ts` imports `ContractClient` as a **type**. That generifies
  cleanly — `createApiClient<TContract>()`.
- `errors.ts` imports `errorCodeSchema` and `errorDetailsSchema` as **runtime
  values** and calls `.safeParse` on them. A type parameter does not help;
  this needs either injection at construction or a shared error-convention
  module both contracts build on.

Nothing breaks today, because there is still only one contract. It must be
resolved **before** the second application's contract exists, not after. The
honest shape is: contract-agnostic mechanism (link construction, per-request
bearer, `errorStatus`) shared; contract binding (the schema parse, the
`ContractClient` application) per app or injected. This is the "shrink the
wrapper to its added value" the classification above kept pointing at, and it
is the one place in the workspace where it applies.

## What this deliberately did not do

- **Nx project names are unchanged.** `nx run web:test` still works. With two
  applications each owning a `web` and an `api`, these names become ambiguous
  and should be prefixed — but that cascades into CI, `package.json` scripts,
  `README.md`, `CLAUDE.md` and every documented command, so it is a separate,
  separately verifiable change.

  **Amended when the second application was scaffolded.** That app's projects
  took prefixed names (`wishlist-web`) while this one's stayed flat (`web`),
  so the workspace now reads inconsistently. It was tempting to treat the
  scaffold as forcing the rename; it does not. Nx requires only that names be
  globally **unique**, so `wishlist-web` alongside `web` is legal and nothing
  breaks. What the second app forces is naming *its own* projects, and a
  hello world is not the occasion to rename fourteen existing ones.

  The ambiguity that actually mattered is already gone: nothing selects an
  application by project name any more. `package.json`'s per-app scripts
  select `-p tag:app:<app>`, which is why the `app:` tag exists. The
  asymmetry is cosmetic until someone types `nx run web:test` and has to
  remember which app that is — resolve it in its own commit, renaming this
  application's projects to match, not the new one's to match these.
- **Package names are unchanged.** `@garage/design-system` is the wrong
  scope for a package a second application depends on, but renaming the scope
  touches every import in the workspace. It is a pure find-replace that can be
  done independently and safely later; bundling it here would have tripled the
  diff of a move that is otherwise mechanical.
- **`plan.md` was not patched.** The repository owner states it is a leftover
  and no longer binding for this decision.

## Traps this move had to avoid, and how they were checked

**The wrapper bans could have been silently disabled.** `doc/wrappers.md`
maps each forbidden package to its **owning directory**, and the owner's
exception is a per-owner `no-restricted-imports` override — the Nx tag
dimension cannot make that distinction, because every wrapper lib carries the
same tag. Collapsing the owner globs to `libs/shared/**` during the move would
have handed every shared lib every package's exception, and `npm run lint`
would still have passed. The owners were rewritten one prefix at a time
instead, and both directions were probed rather than assumed:

- A file in `apps/garage/web` importing all seven wrapped packages produced
  seven `no-restricted-imports` errors, each naming the correct new owner path.
- A file in `libs/shared/i18n` importing `next-intl` (its own package) plus
  `next-auth`, `@orpc/client` and `react-hook-form` produced exactly three
  errors — the exception did not leak to its shared-namespace siblings.

**Paths built from path segments survive a text rewrite.** Rewriting
`libs/database` → `libs/garage/database` across the tree does not touch
`join(root, 'libs', 'database')`, and the resulting failures are late and
confusing. Six such sites existed and all six were found by grepping for the
string literals `'apps'` and `'libs'` across all tracked code, not by grepping
for paths: `prisma.config.ts` (would have broken every Prisma command),
`test-database.ts` (the database suites' migrations directory),
`playwright.config.mts`, `personas.ts`, `build-identity.setup.ts` and
`next.config.ts`'s `outputFileTracingRoot`. A CSS `@import`'s `../` depth in
`global.css` was a seventh of the same family.

## How it was verified

All from the repository root, after `npx nx reset`:

| check                              | result                                               |
| ---------------------------------- | ---------------------------------------------------- |
| `nx show projects`                 | all 14 still found                                    |
| `npm run typecheck`                | 14/14 pass                                            |
| `npm run lint`                     | 14/14 pass, plus the two ban probes above             |
| `npm test`                         | 12/12 projects pass                                   |
| `npm run build` (+ storybook)      | 3/3 pass                                              |
| `nx format:check --all`            | exit 0                                                |
| `npx prisma validate`              | schema resolved from `libs/garage/database`        |
| `nx run api:test-db`               | 9 suites, 129 tests pass                              |
| `nx run api-e2e:e2e`               | pass                                                  |
| `nx run web-e2e:e2e`               | 48 passed, and both ports free afterwards             |
| `docker build` both Dockerfiles    | both images build (CI's `images` job)                 |
| `npx prisma generate`              | no diff — the committed client matches the generator  |

The `web-e2e` count matches what `CLAUDE.md` documents, which is the point:
the suite's build-identity guard (`doc/decision/0285-*`) caught the stale
`BUILD_ID` path during this move and refused to run the other 44 tests, which
is exactly the behaviour that record exists to produce.
