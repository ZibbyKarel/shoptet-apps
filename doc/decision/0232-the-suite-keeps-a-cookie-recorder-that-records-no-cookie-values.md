# 0232 – The suite keeps a cookie recorder that records no cookie values

## What

`apps/garage/web-e2e/src/support/auth-network-log.ts` records, for one page, every
request and response in order: the request's cookie **names**, the response's
`Set-Cookie` **names**, and whether each one is a set or a deletion. It is off
unless `E2E_AUTH_LOG_DIR` is set, and it is kept in the repository rather than
deleted with the investigation that needed it.

## Why it exists

`doc/decision/0189-*` could not finish its diagnosis, and said so precisely:

> The datum that would settle it was not captured: **the request `Cookie` header
> on that `GET /`.** The trace records response headers only.

Playwright's own trace has that shape by design. Reconstructing the missing half
took long enough — and the answer overturned the standing hypothesis
decisively enough (`0230-*`) — that throwing the instrument away and asking the
next person to rebuild it would be the wrong trade. The cost of keeping it is a
file and an unset environment variable.

## Why it can never hold a token

Everything this writes is derived, never copied:

- A cookie is recorded as `{ name, len, sha8 }` — its name, its byte length, and
  **eight hex characters of the SHA-256** of its value. Truncated to 32 bits and
  one-way, that cannot be turned back into a JWT and is not a credential.
- URLs are reduced to origin, path and the *names* of their query parameters.
  This is not cosmetic: `/api/auth/callback/okta` carries the OAuth2 `code` and
  the encrypted `state` in its query string, and an authorization code in a
  retained debug artifact is the same mistake as a logged session token. The
  parameter names alone are what distinguish an RSC prefetch (`?_rsc`) from a
  plain navigation, which is all the ordering question needs.

### Why a digest at all, rather than presence alone

Because "a cookie was present" and "a *different* cookie was present" are
different findings, and the whole of `0230-*` turns on telling them apart. The
measurement that killed the standing hypothesis was three consecutive responses
setting `#dceef266`, `#4605bfb2`, `#70533434` — visibly three distinct tokens
within one navigation. Recorded as "session cookie: yes, yes, yes", that says
nothing.

## Risk

- **A digest is still derived from a secret.** Eight hex characters of SHA-256
  cannot be inverted and cannot be replayed, but the property is only true while
  the truncation stays short; widening it toward a full hash would make a
  precomputation attack against a low-entropy value conceivable. It is fixed at
  eight in one place, with the reasoning next to it.
- **Recorders rot.** This one is exercised only when somebody sets the
  environment variable, so a change to Playwright's `request`/`response` events
  would be found the next time it matters rather than in CI. It is small enough
  to re-read in full before trusting it.
- **It writes files.** `E2E_AUTH_LOG_DIR` should point somewhere temporary; the
  suite never sets it, so a normal run leaves nothing behind.
