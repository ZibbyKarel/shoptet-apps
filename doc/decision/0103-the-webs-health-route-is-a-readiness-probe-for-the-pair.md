# 0103 – `/api/health` is a readiness probe for the pair, not a liveness probe

## What

`apps/garage/web/src/app/api/health/route.ts` answers `200` with

```json
{ "status": "ok", "checks": { "api": { "status": "up" } } }
```

or `503` with `{"status":"error","checks":{"api":{"status":"down","reason":"…"}}}`,
where `reason` is one of `unreachable | timeout | not-ready | not-configured`.
Both directions carry `cache-control: no-store`, and the route is
`force-dynamic`.

## Why

- **A web front end that renders is not a working deployment.** If the API is
  unreachable, every screen is an error state. An orchestrator that only asked
  "did Next.js start" would keep routing traffic to a shell that cannot do
  anything, so the probe asks the one question that distinguishes the two.
- **It is a *readiness* probe, which is why it answers 503 rather than
  crashing.** Liveness is "is this process alive" and is Next.js's own concern;
  restarting the web process because the API is down fixes nothing and turns a
  degraded system into a crashloop.
- **It proxies the API's `/health/ready`, not `/health/live`.** That endpoint
  already answers for the database, so this route does not open its own
  connection or duplicate the API's judgement — it forwards it.
- **The reason is an enum, never the upstream's text.** Four fixed strings, so
  a probe response can never leak an internal hostname, a stack frame or a
  database error. `unreachable` and `timeout` are distinguished because they
  mean different things operationally: nothing listening versus something
  listening too slowly.
- **`no-store` on both the response and the outbound request.** A cached health
  answer is worse than none — it reports the state of some earlier minute with
  full confidence. `force-dynamic` stops Next.js from statically evaluating the
  route at build time, which would otherwise bake a health answer into the
  artifact.
- **The probe is exempt from the session check** (`doc/decision/0100-*`): an
  orchestrator carries no cookie, and a probe that required one would report
  every healthy instance as dead.

## How

- Upstream URL comes from `apiReadinessUrl()` — the API's **origin** plus
  `/health/ready`, because the API's probes are excluded from
  `setGlobalPrefix`. Measured on a running API: `/health/ready` → 200,
  `/api/health/ready` → 404 (`doc/decision/0101-*`).
- `UPSTREAM_TIMEOUT_MS = 4000` via `AbortSignal.timeout`, deliberately shorter
  than a typical 5s probe timeout so the route answers rather than being cut
  off — an orchestrator that times out learns nothing about *why*.
- `redirect: 'error'`: a health check that followed a redirect could report an
  entirely different service as healthy.
- `not-configured` exists because `NEXT_PUBLIC_API_URL` is read here, and an
  empty value should be a loud red rather than a thrown exception.
- Mutating the route kills tests in every branch (see the Task 23 report,
  M8–M11); the 200 path was also confirmed live against two different API
  instances, on ports 3000 and 3100.

## Risk

- **It checks one dependency.** Slack and the mock OIDC server are not probed;
  neither is required for the app to serve, and probing an outbound integration
  from a readiness endpoint invites a third party to take the deployment out.
- **`status` is a two-value flag.** There is no "degraded". If a second check
  is ever added, the shape allows it (`checks` is an object) but the top-level
  status will need a third state or a stated rule for combining them.
