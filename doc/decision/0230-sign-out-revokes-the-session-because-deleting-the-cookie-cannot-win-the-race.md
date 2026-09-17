# 0230 – Sign-out revokes the session, because deleting the cookie cannot win the race

## What

Signing out now adds the session's subject to a **revoked set** on the server,
and every later session read refuses a token carrying it. Cookie deletion still
happens — Auth.js does it — but it is no longer the thing that makes sign-out
work.

`libs/garage/auth/src/lib/revocation.ts` holds the revoked set;
`applySessionLifecycle` in `libs/garage/auth/src/lib/config.ts` consults them from the
`jwt` callback and returns `null` for a revoked session, which `@auth/core`
answers by **clearing the session cookie instead of re-issuing it**
(`lib/actions/session.js`).

This also settles the question `doc/decision/0189-*` left open — whether
sign-out should have server-side revocation at all. The answer is yes, and the
reason is not the threat model: it is that without it the defect does not close.

## Why — what was actually measured

`0189` recorded a sign-out that came undone one navigation later, and was
careful to say that *how* the cookie came back was not established. It named a
hypothesis — a concurrent `GET /api/auth/session`, which next-auth's own
`signOut` triggers — and asked for the request `Cookie` header to be captured
first.

That capture was done (`apps/garage/web-e2e/src/support/auth-network-log.ts`,
`doc/decision/0232-*`). Three things came out of it, and the fix follows from
them rather than from the hypothesis.

**1. The hypothesis is wrong for this application: `/api/auth/session` is not on
the sign-out path.** 0 occurrences across 20 captured sign-out journeys. It
cannot be there, either: `AuthProvider` is always handed the session the root
layout already read (`await auth()`), so `hasInitialSession` is true and
`SessionProvider`'s `_getSession()` early-returns instead of fetching
(`next-auth/react.js`); and `signOut()` with the default `redirect: true`
returns before its own `_getSession()` call. The only `/api/auth/*` requests a
sign-out makes are `GET /api/auth/csrf` and `POST /api/auth/signout`, and
neither re-issues the session cookie.

The endpoint is not unreachable in general — `AuthProvider` sets
`refetchInterval` to `SESSION_REFETCH_SECONDS = 300` and Auth.js refetches on
window focus, so a long-lived tab does poll it. It is simply never in flight
during the seconds a sign-out occupies, which is all hypothesis one needed.

**2. Every render that reads the session re-issues the cookie.** This is the
real mechanism, and it is much broader than one endpoint. A single navigation to
`/` produced three different session cookies, one per request — each carrying
the one its predecessor had just set:

```
>  GET /                  cookie=#9fec66a7   <  200  set=#dceef266
>  GET /?_rsc              cookie=#dceef266   <  200  set=#4605bfb2
>  GET /?_rsc              cookie=#4605bfb2   <  200  set=#70533434
```

(Cookie values are never recorded; `#xxxxxxxx` is a truncated one-way digest,
enough to tell two tokens apart and useless for anything else.) Under
`strategy: 'jwt'` Auth.js re-encodes and re-sets the cookie on every session
read — page render, RSC prefetch, proxy check alike — because that is how a
rolling expiry works.

**3. So the sign-out clear is racing every concurrent render, and the browser
applies whichever `Set-Cookie` arrives last.** Nothing in the application
decides that order. Next.js's prefetcher issues `?_rsc` requests on its own
schedule, a response already on the wire cannot be recalled, and the document
stays alive — still applying `Set-Cookie` headers — until a navigation commits.

### Why the fix is not a client-side ordering change

That was the expected shape of the answer, and it does not hold up. To fix this
by ordering, the application would have to guarantee that **no** session-bearing
request is in flight across the sign-out. It cannot: it does not control when
the framework prefetches, and it cannot cancel a response that has already been
sent. Every ordering variant considered — a form POST navigation instead of
`fetch`, a Server Action, `signOut({ redirect: false })` followed by
`location.replace`, dropping `prefetch` on the top bar's `<Link>` — narrows the
window without closing it, and each leaves the fix depending on *which* request
happened to race.

**And that request was never identified.** It does not need to be, but saying so
is only worth anything with the candidate set written down — otherwise "it does
not matter which" is indistinguishable from "we did not look". The capture
bounds the set completely: across 20 sign-out journeys, exactly **three classes**
of session-bearing request appear on the sign-out path, and they are the three in
the trace above.

| request | carries the session cookie | re-issues it | why |
| --- | --- | --- | --- |
| `GET /` (the document) | yes | **yes** | the root layout `await auth()`s |
| `GET /?_rsc` (RSC prefetch) | yes | **yes** | same layout, same `auth()` |
| `GET /?_rsc` (second prefetch) | yes | **yes** | same |
| `GET /api/auth/csrf` | yes | no | excluded from the proxy matcher; returns a token without reading the session |
| `POST /api/auth/signout` | yes | no — it *clears* | same exclusion; this is the sign-out itself |
| `GET /api/auth/session` | — | — | **0 occurrences**; not on this path at all (§1) |

The three that re-issue do so through **one mechanism, not three**: the proxy's
`auth()` (`apps/garage/web/src/proxy.ts`, `doc/decision/0100-*`), which under
`strategy: 'jwt'` re-encodes and re-sets the cookie on every read. `/` and both
`?_rsc` requests match `proxy.ts`'s `config.matcher`; the two `/api/auth/*`
requests are excluded by it by name, which is why their non-re-issuance is a
property of the routing table rather than an observation that could have gone
the other way on a different run. The three differ only in which happens to
answer last, and that ordering belongs to Next.js's prefetcher, not to this
application.

So the enumeration is exhaustive over the observed path, every member of the
re-issuing class shares one cause, and the two `/api/auth/*` requests plus the
absent `session` endpoint are excluded by mechanism rather than by not having
been seen. Naming the winner would identify which prefetch finished last; it
would not name a different defect, and no fix follows from it. **Revocation does
not depend on knowing which request raced** — it refuses all three, and anything
else carrying that `sub`. That is the argument.

### Why the key is `sub`, and why that is enough

Two designs were tried. The first was wrong in an instructive way.

**`jti` cannot be the key.** `@auth/core`'s `encode()` calls
`setJti(crypto.randomUUID())` on *every* issue (`jwt.js`), so the token a racing
render re-installs has a different `jti` from the one that signed out. Revoking
the id that signed out leaves the one that survived working.

**Nor `sub` plus an `iat` cutoff**, which is what this record originally
described. The argument for it was that a racing render encodes *before* the
sign-out records its cutoff, so its `iat` could never exceed the cutoff second.
That is not sound: `iat` is stamped by `jose`'s `setIssuedAt()` at **encode**
time, and `applySessionLifecycle` runs `rotateAccessToken` — possibly a refresh
round trip to Okta — *between* the revocation check and that encode. A render
whose check preceded the cutoff write and whose encode crossed the next second
boundary would emit `iat > cutoff` and be honoured. A smaller race than the one
it replaced, but still a race.

**`sub` alone is enough, because `sub` is already per sign-in.** `@auth/core`
sets the user id to a fresh `crypto.randomUUID()` on every completed sign-in,
deliberately ignoring the provider's profile id:

```js
// @auth/core/lib/actions/callback/oauth/callback.js
const user = { ...userFromProfile, id: crypto.randomUUID(), … };
```

and `token.sub = user.id`. Measured live in a production `next start` — the same
persona signing in twice through the real OIDC flow produced `9efdd0ac…` then
`15326704…`.

So `sub` names **one sign-in session**, and re-encoding that session's cookie
never changes it. A revoked *set* of subjects therefore decides on a value the
race cannot move, has no clock in it, and closes the encode-time window
completely. It also removes a branch: an earlier version dropped the cutoff on a
new sign-in, which could never fire in production — a fresh sign-in always
arrives as a subject the registry has never seen.

Auth.js awaits `events.signOut` before pushing the clearing cookie
(`lib/actions/signout.js`), so the revocation is in place before the sign-out
response leaves the server. That ordering is asserted, not assumed.

The mirror ordering needs no separate handling: a render that reaches the `jwt`
callback *after* the revocation is recorded sees its subject revoked, returns
`null`, and clears the cookie rather than re-issuing it. So the surviving cookie
is not merely refused — it deletes itself on first use.

## What this does and does not close

**Closed.** A session cookie that outlives its sign-out — by this race, by a
copy taken from a browser profile, by anything — no longer authenticates against
`apps/garage/web`. The realistic harm `0189` named, a shared or unattended machine,
is gone.

**Not closed: the Okta access token.** The session carries a bearer that
`apps/garage/api` validates against the issuer's JWKS, and nothing here revokes it at
Okta. Somebody who has extracted that token from a session can keep calling the
API directly until it expires.

**How long that is, since the number is the argument:** measured against the dev
issuer, `expires_in` is **3599 seconds — one hour**, not the "minutes" an earlier
draft of this record claimed. In production the lifetime is set on the Okta
authorization server and is *not* configured by this repository, so it could be
longer. The exposure is therefore an hour-scale window in dev, and an unknown
set elsewhere — bounded, but less comfortably than first written.

Calling Okta's RFC 7009 revocation endpoint at sign-out would close it. That is
not done here because it is a second, independent change with its own failure
modes (a revocation call that fails must not block a sign-out), and because the
window is bounded and not reachable through the browser this fixes. It is the
one part of the sign-out story still open, and it is a decision, not an
oversight.

**Not closed: a restart forgets.** See `doc/decision/0231-*`.

## Risk

- **The revoked set is in memory.** A restart of the Next.js server forgets
  every sign-out, and a token that had survived one would work again until it
  expires. This is the same posture, and the same single-instance premise, as
  `LockService` on the API side; `0231` records the boundary and the upgrade
  path. It is a narrower hole than the one it replaces — it needs a restart
  *and* a surviving token — but it is not zero.
- **Retention keeps a revoked subject for the session's whole maximum lifetime**
  (30 days by default), so the set grows with sign-outs and is only swept on the
  next write. For this application's population that is a few hundred short
  strings at worst; for a large one it would want an expiry sweep of its own.
- **A token with no `sub` is refused outright**, not merely un-revocable: the
  registry fails closed because a subject it cannot key is a subject it can
  never clear, and nothing downstream would catch it (`isAuthorized` reads
  `auth.user`, never `sub`). `@auth/core` always sets a subject, so this is
  unreachable in practice — but it is a refusal, and two pre-existing rotation
  fixtures had to gain a `sub` to keep describing something production produces.

**A limit this design was previously documented as having, and does not.** An
earlier version of this record said "signing out in one browser invalidates that
person's sessions everywhere, including another device", and adjudicated that
cost as acceptable. It was wrong: `sub` is minted per sign-in, so revocation is
per *session*, and other devices are untouched. The behaviour is finer-grained
than the record claimed — the safe direction — but a cost was weighed that never
existed, which is worth naming rather than quietly deleting.
