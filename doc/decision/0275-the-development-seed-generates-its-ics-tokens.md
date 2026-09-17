# 0275 – The development seed generates its ICS tokens, and never rewrites one

## What

`libs/garage/database/src/lib/seed-data.ts` no longer carries an `icsToken` field at
all. `SeedUser` does not declare one; the four literals that used to sit in it
are gone:

```ts
icsToken: '019917a0-0000-7000-8000-000000000001',   // …0002, …0003, …0004
```

`libs/garage/database/src/lib/ics-token.ts` mints one instead —
`randomBytes(32).toString('base64url')` — and `libs/garage/database/src/lib/seed-writes.ts`
puts it in the `create` branch of the seed's `upsert` and **nowhere else**.
`src/scripts/seed.ts` prints the resulting feed URLs to stdout so a developer
can still subscribe.

## Why

- **Those four values were published credentials.**
  `apps/garage/api/src/calendar/calendar.controller.ts` is `@Public()` by design, and
  its own header says why: *"there is no bearer token to check. The credential
  is the 32-byte `randomBytes` token in the path."* So
  `GET /api/calendar/019917a0-0000-7000-8000-000000000002.ics` returned that
  account's entire reservation calendar to an unauthenticated stranger, on any
  database the seed had ever touched. Two standing constraints were violated at
  once — ICS tokens come from `crypto.randomBytes`, and no secret lives in the
  repository — and they were not merely committed but **sequential**, so one of
  them gave you the other three.
- **It undid work that had already been done.**
  `doc/decision/0080-*` makes the feed's 404 for a wrong token
  indistinguishable from the 404 for an unrouted path, precisely so a token
  cannot be enumerated. For these four accounts that protection bought nothing:
  they did not need enumerating.
- **"Dev only" was a convention, not a mechanism.** `seed.ts` checked that
  `DATABASE_URL` was set and nothing more. `doc/decision/0276-*` is the other
  half of this fix.
- **`base64url`, not hex.** `apps/garage/api/src/auth/auth-user.service.ts` mints a
  real token as `randomBytes(32).toString('base64url')` and
  `me.service.ts` regenerates it the same way. Nothing parses an ICS token, so
  its shape is all it has; a seeded account whose token is the shape of a real
  one is one fewer difference between a development database and a real one.
  The entropy is 32 CSPRNG bytes either way.
- **`icsToken` is in `create` and never in `update`, which is a separate bug
  fixed in the same change.** The old seed spread the whole row into both
  branches, so `prisma db seed` silently reverted a token the account holder had
  regenerated through the UI — **re-validating a feed URL they had deliberately
  revoked**, which is the exact property `schema.prisma` documents on the
  column. The same shape would revert a randomly generated token, so this is not
  subsumed by the change above.
- **`role` and `active` deliberately stay in `update`.** Those are the seed's to
  assert on every run, and `apps/garage/web-e2e` depends on `inactive@example.com`
  being inactive when a suite starts. The distinction is that a credential
  belongs to whoever holds it and a role does not.

## How

- `libs/garage/database/src/lib/ics-token.ts` and its spec: 32 bytes, base64url,
  never repeating.
- `libs/garage/database/src/lib/seed-writes.ts` owns the `upsert` argument shape so
  that the one property that matters about it can be asserted rather than read —
  `seed.ts` calls `main()` on import, so nothing inside it is unit-testable.
  `seed-writes.spec.ts` fails if `icsToken` reappears in `update`.
- `seed-data.spec.ts` gained a `describe` that reads `seed-data.ts` as **text**
  and fails on any `icsToken` declaration or any string long enough to be a
  32-byte secret in base64url, hex or UUID form. The defect was a committed
  literal, and a literal is a fact about the file: an assertion over the exported
  objects alone would pass again the moment somebody re-added the field under
  another name.
- The seed prints the URLs rather than storing them anywhere. That is a
  deliberate exception to "never log a token": it is a developer CLI, the
  operator asked for the output, and `assertDisposableDatabase` has already
  established that the database is a local one.

## Risk

- **Development feed URLs are no longer stable.** A developer who had
  subscribed a calendar client to a seeded URL has to re-subscribe once, from
  the seed's output or from *Nastavení*. That is the same thing regenerating a
  token has always done, and it is the price of the URL not being in git.
- **Databases seeded before this change still hold the four leaked tokens**,
  and — correctly — the seed will not rotate them, because rotating on `update`
  is the defect above. Rotate them by regenerating in *Nastavení*, or with a
  one-off `UPDATE "User" SET "icsToken" = … WHERE "icsToken" LIKE '019917a0-%'`.
  The developer machine this change was made on was rotated that way.
- **The tokens are now in a terminal scrollback** rather than in a file. That is
  strictly better than in a git history, and worse than nowhere; there is no
  third option that leaves a subscribable URL.
