# 0080 — The ICS feed answers 404, never 401

## What

`GET /api/calendar/:icsToken.ics` answers **404 Not Found** for every token it
cannot serve — one that no user holds, one that a *deactivated* user holds, and
one that is not even the right shape. Never 401, never 403, and never a body
that says which of the three happened.

The route is `@Public()`, so no bearer token is involved at all; the credential
is the 32-byte `randomBytes` value in the path. `CalendarService` resolves it
with a single query whose `WHERE` clause carries `active: true`, and throws a
bare `new NotFoundException()` when that returns nothing.

## Why

**401 is an enumeration oracle.** A calendar feed URL is handed out to be pasted
into Outlook, and it will end up in browser histories, proxy logs, shared
documents and tickets. The endpoint is unauthenticated by construction, so
anybody on the network can address it. If a wrong token answered `401
Unauthorized` while a wrong *path* answered `404`, the status code alone would
partition the token space into "this looks like a token" and "this does not" —
and any partition of a secret's space is a step towards guessing it. 404 says
nothing except "there is nothing here", which is also true.

The same reasoning forces three details that a 404 alone would not:

- **A deactivated user's token is refused by the same query, not by a check
  afterwards.** Offboarding is `active: false` (`doc/api-modules.md` §5), so an
  offboarded employee must lose the feed too. Doing that with `if (!user.active)`
  after a successful lookup would make that case measurably slower than an
  unknown token — one extra statement's worth — on an endpoint an attacker can
  time at will. Folding `active` into the `WHERE` makes the two cases one code
  path: the same statement, the same branch, the same response.
- **The exception carries no message.** `new NotFoundException()` produces Nest's
  constant `{ "statusCode": 404, "message": "Not Found" }`. A helpful message
  ("no such feed", "this feed has been disabled") would put the oracle back in
  the body after the status code had removed it.
- **No response header is set before the lookup succeeds.** `@Header()`
  decorators are applied by Nest *before* the handler runs, so the obvious
  implementation would have answered every bad token with `Content-Type:
  text/calendar`, `Cache-Control: private, …` and a `Content-Disposition` —
  headers no other 404 on this server carries. The headers are therefore set
  inside the handler, after `feedEntriesForToken` has returned.
  `calendar-pipeline.spec.ts` compares a rejection's headers against an unrouted
  path's, header by header.

## What this deliberately does *not* claim

**The response is not constant-time**, and this decision does not pretend
otherwise. A served feed does one more query than a rejected one and returns a
body whose size grows with the number of reservations. That is not a leak,
because a valid token already gets a `200` and a calendar — timing tells the
attacker nothing the status code has not already told them. What matters is that
the *rejections* are indistinguishable from each other, and they are: unknown,
malformed and deactivated all take one indexed lookup and one `throw`, and
`calendar.service.spec.ts` asserts that none of them reaches the reservation
table.

**A rejection is not byte-identical to a framework 404.** Nest's router echoes
the path it could not match (`Cannot GET /api/calendar/nope`), while this
endpoint answers a constant `Not Found`, so the two bodies differ. That reveals
exactly one thing — that a URL ending in `.ics` under `/api/calendar` matches a
route — which is public knowledge: the path is in `libs/garage/contract`
(`ICS_FEED_BASE_PATH`), in `doc/ics.md`, and on the settings screen every
employee can open. It says nothing about any token.

Closing that gap would mean echoing the request path from this handler, i.e.
reflecting somebody's *token* into an error body that a reverse proxy or an
access log may well record. That is a worse trade than the thing it fixes, so it
is not made. `calendar-pipeline.spec.ts` states the difference as an assertion
rather than leaving it unmentioned.

## How

- `apps/garage/api/src/calendar/calendar.service.ts` — the single `findFirst({ where: {
  icsToken, active: true } })` and the bare `NotFoundException`.
- `apps/garage/api/src/calendar/calendar.controller.ts` — headers set after the lookup.
- `apps/garage/api/src/calendar/calendar.service.spec.ts` — the four rejection cases,
  including "says exactly the same thing in every case" and "never reveals
  whether a token exists by doing extra work for it".
- `apps/garage/api/src/calendar/calendar-pipeline.spec.ts` — the same over real HTTP,
  comparing status, body and headers.
- `apps/garage/api/src/calendar/calendar.db.spec.ts` — that the `active: true` filter
  really is applied by PostgreSQL, not just by the in-memory double.

Replacing `NotFoundException` with `UnauthorizedException` fails **10** tests;
removing `active: true` from the `WHERE` clause fails **5**; moving the header
writes above the lookup fails **1** (the header comparison, which is the only
test that can see it).
