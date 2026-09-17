# 0239 – The Nx scaffold route is deleted, and route parity is read from the compiled app

## What

Two changes, and the second is the one that matters.

**1.** `apps/garage/api/src/app/app.controller.ts`, `app.service.ts` and their two specs
are deleted, and `AppModule` declares no controllers and no `AppService`.
`GET /api` → `{"message":"Hello API"}` is gone.

**2.** `orpc-route-parity.spec.ts` gains a `the compiled application` describe
that boots the real `AppModule`, enumerates every route Nest actually
registered out of its container, and asserts the set equals the contract's
procedures plus a named allow-list of three: the ICS feed and the two health
probes.

## Why the route went

It was authenticated — the global `JwtAuthGuard`, no `@Public()` — so it was
never an exposure. It was a live HTTP endpoint that existed in **no contract**,
which global constraint 1 (contract-first) forbids, and nothing called it. It
was scaffolding that outlived the scaffold.

`apps/garage/api-e2e/src/api/api.spec.ts`'s header already recorded the situation
accurately, including that deleting the controller "would be the better end
state", and deferred it as an API change rather than a test change. This is that
change.

## Why the parity spec was the real finding

`orpc-route-parity.spec.ts` had a test titled **"registers no route that the
contract does not declare"** — a global property about the application. Its
`registeredRoutes()` iterated `CONTROLLERS`, a hand-maintained literal of the
five RPC controllers. `AppController` was not in that list, so the assertion was
true of the controllers it was handed and said nothing whatever about the
application.

That is the sharper version of this project's named defect class: not an
untested claim, but **a test that passes on a defence other than the one its
name claims**. Deleting the controller without fixing the spec would leave the
next scaffold route to sail through it the same way.

So: that test is renamed to "registers no **RPC** route that the contract does
not declare", which is what it checks and is still worth checking, and the
global claim is made separately against the composed application.

## How the compiled routes are read

From the Nest container — `container.getModules()`, then each module's
`controllers` — rather than from Express's router stack. Nest's container is how
Nest itself walks what it built; the Express stack is both more private and less
informative, having already lost which controller a path came from. The database
is stubbed exactly as `app.module.spec.ts` stubs it: `compile()` resolves the
provider graph without running `onModuleInit`, and the routing table is fully
decided by then.

The allow-list is a literal in the spec, on purpose. These are exemptions from
contract-first, and an exemption that is not visible is a hole:

| route | why it cannot be a contract procedure |
| --- | --- |
| `calendar/:icsToken.ics` | a subscription URL a calendar client fetches with `GET`; `doc/decision/0080-*` |
| `health/live`, `health/ready` | excluded from the global prefix so an orchestrator reaches them without knowing it |

## Consequence outside this branch

`GET /api` now answers **404** where it answered 401.

- `apps/garage/api/src/auth/auth-pipeline.spec.ts` used it as its "a route with no auth
  decorator at all" probe. It now uses the locally declared
  `ProtectedController`, which makes the same point without depending on a stub
  existing, and gains an explicit 404 assertion for the bare prefix.
- **`apps/garage/api-e2e/src/api/api.spec.ts` still asserts 401 and will fail.** That
  file is outside this change's ownership boundary and is deliberately left
  alone; the fix is to expect `404` and drop the "Hello API" assertion, whose
  subject no longer exists. It is flagged in the fix report.

## Risk

Nothing consumed the route, so nothing breaks by its absence — but the bare
prefix going from 401 to 404 is observable, and any external monitor pointed at
`GET /api` as a liveness check would now see a 404. The probes at `/health/live`
and `/health/ready` are the supported answer to that, and they are unchanged.
