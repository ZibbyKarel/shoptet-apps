-- An admin books for another user, or for a guest (TODO item 3).
--
-- Additive and forward-only. `ALTER COLUMN … DROP NOT NULL` widens what the
-- column admits and rewrites no data; nothing here drops a table, a column or a
-- type, which is what `migration-sql.spec.ts` asserts about every migration
-- after the first.
--
-- A guest has no `User` row, so `userId` has to be nullable. On its own that
-- would admit a row with no holder at all, and every reader would have to defend
-- against it, so `Reservation_holder_check` makes "exactly one holder" a property
-- of the table (`doc/decision/0303-*`).
--
-- `NULL`s do not collide in a Postgres unique index, so
-- `Reservation_userId_date_key` still means "one reservation per user per day"
-- and now deliberately places no limit on guests: several guests may visit on
-- the same day. That is the intended behaviour, stated here so it is not
-- rediscovered as a bug.
ALTER TABLE "Reservation" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Reservation" ADD COLUMN "guestName" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "licensePlate" TEXT;

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_holder_check"
  CHECK (("userId" IS NULL) <> ("guestName" IS NULL));

-- `ADD VALUE IF NOT EXISTS` rather than a recreate, for the same reason as
-- `20260902090000_audit_reservation_window_updated`: rewriting the type would
-- mean dropping and re-adding `AuditLog.action`, and that table is append-only
-- by trigger (`doc/decision/0027-*`) — an UPDATE against it is rejected by the
-- database.
--
-- Postgres 12+ allows ADD VALUE inside a transaction block as long as the new
-- value is not used in the same transaction; nothing here uses it.
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'RESERVATION_CREATED_BY_ADMIN';
