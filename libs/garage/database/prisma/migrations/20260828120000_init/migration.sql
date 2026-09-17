-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ParkingGroup" AS ENUM ('IT', 'SHARED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReservationLockMode" AS ENUM ('AUTO', 'FORCE_OPEN', 'FORCE_LOCKED');

-- CreateEnum
CREATE TYPE "AuditLogAction" AS ENUM ('RESERVATION_CREATED', 'RESERVATION_CANCELLED', 'RESERVATION_CANCELLED_BY_ADMIN', 'WAITLIST_PROMOTED', 'USER_UPDATED', 'SPOT_UPDATED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licensePlate" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "oktaId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "icsToken" TEXT NOT NULL,
    "preferredParkingSpotId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSpot" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "group" "ParkingGroup" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "parkingSpotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" UUID NOT NULL,
    "parkingSpotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" "AuditLogAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationWindowSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "openDaysBefore" INTEGER NOT NULL DEFAULT 7,
    "lockMode" "ReservationLockMode" NOT NULL DEFAULT 'AUTO',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservationWindowSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_oktaId_key" ON "User"("oktaId");

-- CreateIndex
CREATE UNIQUE INDEX "User_icsToken_key" ON "User"("icsToken");

-- CreateIndex
CREATE INDEX "User_preferredParkingSpotId_idx" ON "User"("preferredParkingSpotId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingSpot_label_key" ON "ParkingSpot"("label");

-- CreateIndex
CREATE INDEX "Reservation_date_idx" ON "Reservation"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_parkingSpotId_date_key" ON "Reservation"("parkingSpotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_userId_date_key" ON "Reservation"("userId", "date");

-- CreateIndex
CREATE INDEX "WaitlistEntry_date_idx" ON "WaitlistEntry"("date");

-- CreateIndex
CREATE INDEX "WaitlistEntry_parkingSpotId_date_createdAt_id_idx" ON "WaitlistEntry"("parkingSpotId", "date", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_parkingSpotId_userId_date_key" ON "WaitlistEntry"("parkingSpotId", "userId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_preferredParkingSpotId_fkey" FOREIGN KEY ("preferredParkingSpotId") REFERENCES "ParkingSpot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_parkingSpotId_fkey" FOREIGN KEY ("parkingSpotId") REFERENCES "ParkingSpot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_parkingSpotId_fkey" FOREIGN KEY ("parkingSpotId") REFERENCES "ParkingSpot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions. Everything above this line is the output of
--   prisma migrate diff --from-empty --to-schema libs/garage/database/prisma/schema.prisma --script
-- Everything below expresses constraints the Prisma schema language cannot.
-- Keep both parts in this one file: `migrate deploy` applies a migration
-- directory as a single unit, so a second file could never be skipped, but a
-- single file is what `migrate dev` regenerates against.
-- ---------------------------------------------------------------------------

-- Singleton: `ReservationWindowSettings` holds exactly one row, id 1.
-- A CHECK on the primary key is what makes that a database fact rather than an
-- application convention: the PK already forbids a second row with id 1, and
-- the CHECK forbids every other id. Rationale in `doc/database.md`.
ALTER TABLE "ReservationWindowSettings"
  ADD CONSTRAINT "ReservationWindowSettings_singleton_check" CHECK ("id" = 1);

-- Mirrors MIN_OPEN_DAYS_BEFORE / MAX_OPEN_DAYS_BEFORE from
-- `libs/garage/shared-types/src/lib/domain-constants.ts`, which the contract's
-- `reservationWindowSettingsSchema` also enforces.
ALTER TABLE "ReservationWindowSettings"
  ADD CONSTRAINT "ReservationWindowSettings_openDaysBefore_range_check"
  CHECK ("openDaysBefore" BETWEEN 1 AND 31);

-- AuditLog is append-only. Hard delete + audit entry is this project's history
-- model (see `doc/database.md`), so the audit trail is the only record that a
-- reservation ever existed — a stray UPDATE or DELETE would destroy evidence
-- with nothing left to reconstruct it from. Enforced in the database, not by
-- convention, because the application is not the only thing that can reach the
-- table (psql, Adminer, a future migration).
CREATE OR REPLACE FUNCTION "auditlog_reject_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "auditlog_reject_mutation"();

-- TRUNCATE does not fire row-level triggers, so the trigger above would let a
-- single `TRUNCATE "AuditLog";` erase the whole trail it is meant to protect.
-- A statement-level BEFORE TRUNCATE trigger is the only way to seal that hole;
-- it reuses the same function, whose message interpolates TG_OP ('TRUNCATE').
CREATE TRIGGER "AuditLog_append_only_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "auditlog_reject_mutation"();

-- Seed the singleton with the defaults from decision 0004 (7 days, AUTO).
-- It lives in the migration rather than in `seed.ts` because the table must
-- never be empty: every reservation path reads it, and `prisma db seed` is not
-- run in production. `ON CONFLICT DO NOTHING` keeps this idempotent.
INSERT INTO "ReservationWindowSettings" ("id", "openDaysBefore", "lockMode", "updatedAt")
VALUES (1, 7, 'AUTO', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
