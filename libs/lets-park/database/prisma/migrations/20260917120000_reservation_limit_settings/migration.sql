-- TODO item 2 makes the monthly reservation cap an admin setting.
--
-- A new singleton rather than a column on "ReservationWindowSettings": that
-- table drives the reservation window, and a per-user monthly quota is not a
-- window rule. Renaming it instead would have dragged the literal
-- "ReservationWindowSettings" / 'RESERVATION_WINDOW_UPDATED' strings stored in
-- "AuditLog" along with it, and that table is append-only by trigger
-- (`doc/decision/0027-*`) — the historical rows could not have been migrated.
CREATE TABLE "ReservationLimitSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "monthlyReservationCap" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservationLimitSettings_pkey" PRIMARY KEY ("id")
);

-- Singleton, the same way the window settings are one: the primary key already
-- forbids a second row with id 1, and the CHECK forbids every other id, which
-- is what makes "exactly one row" a database fact rather than an application
-- convention. Rationale in `doc/database.md`.
ALTER TABLE "ReservationLimitSettings"
  ADD CONSTRAINT "ReservationLimitSettings_singleton_check" CHECK ("id" = 1);

-- The bound is stated twice on purpose — here and in the contract's
-- `reservationLimitSettingsSchema` — so the database cannot hold a value the
-- API would refuse. Mirrors "ReservationWindowSettings_openDaysBefore_range_check".
ALTER TABLE "ReservationLimitSettings"
  ADD CONSTRAINT "ReservationLimitSettings_monthlyReservationCap_range_check"
  CHECK ("monthlyReservationCap" BETWEEN 1 AND 31);

-- The table must never be empty: the API defaults a missing row rather than
-- erroring, but a seeded row means the admin screen shows a value that is
-- actually stored. `updatedAt` has no default in the model, so it is set here.
INSERT INTO "ReservationLimitSettings" ("id", "monthlyReservationCap", "updatedAt")
VALUES (1, 5, NOW())
ON CONFLICT ("id") DO NOTHING;

-- One new audit action. `ADD VALUE IF NOT EXISTS` rather than a recreate, for
-- the reason `20260902090000_audit_reservation_window_updated` gives at length:
-- rewriting the type would mean dropping and re-adding "AuditLog"."action", and
-- an UPDATE against that append-only table is rejected by the database.
--
-- Postgres 12+ allows ADD VALUE inside a transaction block as long as the new
-- value is not used in the same transaction; nothing here uses it.
ALTER TYPE "AuditLogAction" ADD VALUE IF NOT EXISTS 'RESERVATION_LIMITS_UPDATED';
