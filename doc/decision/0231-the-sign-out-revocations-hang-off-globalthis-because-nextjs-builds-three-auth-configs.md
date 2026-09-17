# 0231 – The sign-out revocations hang off `globalThis`, because Next.js builds three auth configs

## What

`createSignOutRegistry` reads its revocation map from `sharedRevokedStore()`,
which anchors a single `Map` to `globalThis` under
`Symbol.for('@garage/auth:signed-out-sessions')`. That function **throws**
when `process.env.NEXT_RUNTIME` is anything but the Node.js runtime.

A module-level `Map` would be the obvious thing. It does not work, and it does
not work *quietly* — which is the reason this has a record of its own rather
than a comment.

## Why

The first implementation of `doc/decision/0230-*` held the revocations in the
closure of `createAuthConfig`. Every unit test passed. The end-to-end test —
sign in, keep the cookie, sign out, put the cookie back, expect to be refused —
failed, and the restored cookie worked exactly as before.

Temporary instrumentation in the running `next start` process said why:

```
[t33] createAuthConfig instance mffm19
[t33] createAuthConfig instance qu35nq
[t33] createAuthConfig instance w47ltk
[t33] jwt check revoked= false        ← ×16
[t33] signOut event mffm19 hasToken true sub string iat number
[t33] jwt check revoked= false        ← ×4, after the sign-out
```

**Three `createAuthConfig` instances in one process.** Next.js compiles the
proxy, the `/api/auth/*` route handlers and the server components into separate
bundles, each with its own module registry, so `createAuth()` in
`apps/garage/web/src/auth.ts` runs once per bundle. The sign-out event reached exactly
one of them. Every authorization check that mattered — the proxy's, which is
what issues the redirect — ran against a different, permanently empty registry.

Sign-out looked revoked from the endpoint that performed it and was honoured
everywhere it counted. Nothing threw, nothing logged, and the only symptom was
the security property quietly not holding.

`globalThis` crosses the bundle boundary because all three run in the same V8
realm — which is true here *because* the proxy runs on the Node.js runtime
(`doc/decision/0100-*`). `Symbol.for` rather than `Symbol()` for the same
reason: the global symbol registry is realm-wide, so two copies of the module
resolve the same key, whereas `Symbol()` would mint a fresh one per copy and
reproduce the original bug in a subtler form.

The map is a parameter of `createSignOutRegistry`, not something it reaches for
itself: tests get a private map by default and stay isolated, while
`createAuthConfig` passes the shared one explicitly, so the global state is
visible at the call site instead of hidden in a module.

## Risk

- **Moving the proxy to the Edge runtime would stop this working — so it now
  refuses to boot instead.** Edge is a separate isolate with its own
  `globalThis`, so the proxy would go back to an empty registry and sign-out
  would stop being enforced on exactly the path that enforces it, with no error
  and nothing logged. That is not a risk a comment can carry: it is the same
  failure mode the first implementation of this fix had, and only an end-to-end
  test caught it. `sharedRevokedStore()` therefore throws
  `SignOutRevocationUnavailableError` when `process.env.NEXT_RUNTIME` is not the
  Node.js runtime, turning a silent disable into an immediate boot failure.
  `0100-*` already fixes the runtime for a different reason (secrets must not be
  inlined into an Edge bundle); this makes that constraint executable rather
  than merely argued.

  `revocation.spec.ts` › *refuses to boot on the Edge runtime rather than
  silently not enforcing* is the test for **this** bullet, and it does hold the
  line.

  This paragraph used to continue "Two tests hold the line", adding
  `config.spec.ts` › *revokes across configurations, not just the one that
  signed out*, and it overstated what that second test covers. It runs inside
  **one** module registry, as does `revocation.spec.ts` ›
  *hands out one map for the whole process*, so between them they falsify a
  **closure-scoped** map — the shape probed above — and not a **module-level**
  one. A module-level map is not a hypothetical: it is precisely the production
  bug this record is about, because the three bundles have a module registry
  each. The final review measured the gap by replacing the body of
  `sharedRevokedStore()` with a module-level `const Map` and getting 100/100
  tests green.

  The test that actually pins the mechanism is `revocation.spec.ts` › *hands the
  same map to two independent module registries*, added afterwards —
  `doc/decision/0246-*` records why it takes that shape, and applies the same
  test to the refresher's state (`doc/decision/0245-*`).
- **Process-wide state is process-wide.** A second web instance would not see
  the first's sign-outs, which makes horizontal scaling of `apps/garage/web` a change
  that must go through this file. `SignOutRegistry` is deliberately four methods
  wide so that moving it behind Redis or a table touches nothing else.
- **A restart empties it.** Stated in `0230-*` under Risk; repeated here because
  this is the file where it is true.
- **`globalThis` is shared with everything else in the process.** The symbol is
  namespaced to this package to make a collision implausible, but nothing
  enforces that; a second consumer of the same key would corrupt sign-out.
