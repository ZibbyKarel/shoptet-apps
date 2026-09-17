# 0278 – `AuditLog.actor` keeps Prisma's default `onUpdate: Cascade`, and says so

## What

`libs/garage/database/prisma/schema.prisma` still declares:

```prisma
actor User @relation(fields: [actorUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
```

A comment above it now records that this contradicts the append-only trigger,
and why it was left alone.

## Why

- **The contradiction is real.** `AuditLog` is append-only: the init migration
  installs `AuditLog_append_only` (`BEFORE UPDATE OR DELETE`, per row) and
  `AuditLog_append_only_truncate` (`BEFORE TRUNCATE`, per statement), both
  calling `auditlog_reject_mutation()`, which raises. A cascade on update issues
  `UPDATE "AuditLog" SET "actorUserId" = …`, which that trigger rejects, aborting
  the whole transaction. Two rules pointing opposite ways with nothing recording
  it is what the review flagged.
- **It is unreachable.** `User.id` is `@id @default(uuid(7))` and no code path in
  this application updates a primary key. Nothing can fire the cascade.
- **`onUpdate: NoAction` would be the truer declaration** and it was the first
  choice. It is not what happened because it changes the foreign-key DDL, and so
  needs a fourth migration — and applying that migration to the shared
  development PostgreSQL in the middle of a parallel fix round would leave every
  other worktree's `_prisma_migrations` table holding a row for a migration its
  tree does not contain. `nx run database:check-schema`
  (`doc/decision/0277-*`) would then fail for other agents on a change none of
  them made. That is a real cost, paid to correct a declaration nothing can
  reach.
- **A comment is the honest interim.** It is not a substitute for a fix in the
  general case — the whole review round exists because comments had been written
  where code was needed — but here there is no behaviour to change, only a
  declaration that overstates what can happen.

## How

- A `//` comment (not `///`) above the relation, naming the trigger, the reason
  it is unreachable, and this record.
- Note that *any* comment in `schema.prisma` changes the generated client: the
  full schema text is embedded as `inlineSchema` in
  `src/generated/prisma/internal/class.ts`. The client was regenerated and
  committed in the same change, which is what `database:check-schema` verifies.

## Risk

- **If a data migration ever rewrites `User.id`**, this cascade will abort it,
  and the failure will point at `AuditLog` rather than at the rewrite. Anyone
  writing such a migration should change this to `NoAction` in the same change —
  which is now a one-line schema edit plus the migration they are already
  writing.
- The same `onUpdate: Cascade` appears on `Reservation`, `WaitlistEntry` and
  `User.preferredParkingSpot`. Those are harmless: nothing rejects an `UPDATE`
  on those tables.
