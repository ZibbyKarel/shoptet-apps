# 0247 – Projections of `userSchema` are allowlists, in both directions

**Date:** 2026-09-03 · **Status:** accepted · **Task:** final-review fix round, shard contract-auth (M-3)

## What

Every schema in `libs/garage/contract` that narrows `userSchema` for an audience is a
`.pick()` over a named field list, never a `.omit()`.

- `userSummarySchema` (`schemas/entities.ts`) — already a `pick`. Unchanged.
- `adminUserSchema` (`api/users.ts`) — was `userSchema.omit({ icsToken: true })`,
  now `userSchema.pick(ADMIN_USER_FIELDS)`.

The field set is **identical** to what the `omit` produced — the same ten keys —
so no response shape moves and no handler or UI changes.

## Why

The final review found the two schemas defending opposite constructions with the
same argument, forty lines apart:

- `api/users.ts` on the `omit`: "a field added to the entity shows up here by
  default, **which is the safe direction** for an admin view."
- `schemas/entities.ts` on the `pick`: "picking from `userSchema` means adding a
  field to the entity **cannot silently widen this one**."

Both cannot be the safe direction. One of them had to be chosen and written down,
which is what this record is for.

**`pick` wins, on the cost of being wrong.**

- Get `pick` wrong and a field an admin ought to see is missing from the admin
  screen. Visible on the first look at the page, and fixed by adding one key.
- Get `omit` wrong and the **next secret added to `User`** is served to every
  admin — in a response nobody re-reads, with no error, and nothing in review
  obliged to notice. That this is a live risk rather than a stylistic one is
  settled by the entity itself: `User` already carries `icsToken`, the secret in
  a personal ICS feed URL, which is why the `omit` existed. Per-user secrets live
  on this entity, so there will be another.

"Admins see everything unless somebody remembers to subtract it" is a default
that fails open. The direction that has to be deliberate is *widening*, so
widening is what takes an edit.

Measured, rather than argued. `userSchema` widened with a
`passwordResetToken` field, and both directions asked what they produce:

```
with omit({ icsToken }):  adminUserSchema has passwordResetToken: true    (exit 1)
with pick(ADMIN_USER_FIELDS): adminUserSchema has passwordResetToken: false (exit 0)
```

`adminUserSchema` keeps `oktaId` and `email`, which the `omit` also exposed.
Narrowing that is a separate question with a UI consequence (`apps/garage/web`'s admin
table), and this record deliberately does not decide it — the point here is the
*direction of the default*, not a change to what admins can see today.

## How

`libs/garage/contract/src/api/users.ts` exports `ADMIN_USER_FIELDS`, the allowlist, and
builds `adminUserSchema` from it. Two tests in `users.spec.ts`:

- *is exactly the declared allowlist, so widening it takes an edit here* — the
  schema's keys are the allowlist's keys.
- *does not grow when the user entity grows* — widens `userSchema` in the test,
  then asserts the `pick` refuses the new field **and** that the `omit`
  direction would have carried it. The counterfactual is in the test rather than
  in this record, so it stays true.

Note what these tests cannot do: `pick` and `omit` produce byte-identical schemas
for today's `userSchema`, so reverting the one line in isolation does not turn
anything red. That is exactly why this needed a decision and a guard rather than
a fix — the difference only exists in the future, and the second test is what
brings it into the present.

## Risk if this is wrong

- **A new field on `User` is invisible to admins until somebody adds it to
  `ADMIN_USER_FIELDS`.** Accepted; that is the trade, and it is the failure that
  announces itself.
- The allowlist is a plain object literal, so nothing forces it to stay a subset
  of `userSchema`'s keys — a typo would be caught by `pick`'s types at compile
  time, which is the only enforcement there is and is enough.
