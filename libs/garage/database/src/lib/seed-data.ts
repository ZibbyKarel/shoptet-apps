/**
 * Development seed data.
 *
 * Kept as plain data, separate from the script that writes it
 * (`src/scripts/seed.ts`), so it can be asserted against the contract's Zod
 * schemas in `seed-data.spec.ts` without touching a database.
 */

import type { ParkingGroup, ReservationLockMode, UserRole } from '../generated/prisma/enums';

export interface SeedParkingSpot {
  /** Label painted on the spot; the natural key the seed upserts on. */
  label: string;
  group: ParkingGroup;
  active: boolean;
}

/**
 * One development account.
 *
 * There is deliberately **no `icsToken` field.** The secret in a personal ICS
 * feed URL is the only credential that route has — `calendar.controller.ts` is
 * `@Public()` — so a value written down here would be a published credential
 * for every database this seed has ever touched. Four sequential UUID-shaped
 * literals used to sit in this file, and the final review raised them as its
 * single Critical. `src/scripts/seed.ts` now mints one per account with
 * `generateSeedIcsToken()` (`./ics-token.ts`) and prints the feed URLs, and
 * `seed-data.spec.ts` fails if a literal ever comes back. See
 * `doc/decision/0275-the-development-seed-generates-its-ics-tokens.md`.
 */
export interface SeedUser {
  /** Natural key the seed upserts on. */
  email: string;
  name: string;
  licensePlate: string | null;
  role: UserRole;
  /**
   * `sub` claim the mock OIDC server will issue for this person. See the note
   * in `doc/database.md` — `mock-oauth2-server` runs without a `JSON_CONFIG`,
   * so its login form accepts any subject; these are the values a developer is
   * expected to type in order to land on a seeded account.
   */
  oktaId: string;
  active: boolean;
  /** Resolved to `preferredParkingSpotId` by the seed script. */
  preferredParkingSpotLabel: string | null;
}

export interface SeedReservationWindowSettings {
  openDaysBefore: number;
  lockMode: ReservationLockMode;
}

export interface SeedReservationLimitSettings {
  monthlyReservationCap: number;
}

/**
 * The real layout of the office car park: four IT spots and five shared ones.
 * Order is the order they are shown in, and the order the seed inserts them.
 */
export const SEED_PARKING_SPOTS: readonly SeedParkingSpot[] = [
  { label: 'E2.92', group: 'IT', active: true },
  { label: 'E2.93', group: 'IT', active: true },
  { label: 'E2.94', group: 'IT', active: true },
  { label: 'E2.95', group: 'IT', active: true },
  { label: 'E2.96', group: 'SHARED', active: true },
  { label: 'E2.65', group: 'SHARED', active: true },
  { label: 'E2.66', group: 'SHARED', active: true },
  { label: 'E2.61', group: 'SHARED', active: true },
  { label: 'E2.62', group: 'SHARED', active: true },
];

/**
 * Dev accounts. Obviously-fake identities on `example.com`, mirroring the
 * convention in `.env.example`: nothing in this repository may look like a real
 * person's credentials.
 */
export const SEED_USERS: readonly SeedUser[] = [
  {
    email: 'admin@example.com',
    name: 'Dev Admin',
    licensePlate: '1AB 1234',
    role: 'ADMIN',
    oktaId: 'dev-admin',
    active: true,
    preferredParkingSpotLabel: 'E2.92',
  },
  {
    email: 'user@example.com',
    name: 'Dev User',
    licensePlate: '2CD 5678',
    role: 'USER',
    oktaId: 'dev-user',
    active: true,
    preferredParkingSpotLabel: 'E2.96',
  },
  {
    email: 'user2@example.com',
    name: 'Dev User Two',
    licensePlate: null,
    role: 'USER',
    oktaId: 'dev-user-2',
    active: true,
    preferredParkingSpotLabel: null,
  },
  {
    email: 'inactive@example.com',
    name: 'Dev Inactive',
    licensePlate: null,
    role: 'USER',
    oktaId: 'dev-inactive',
    active: false,
    preferredParkingSpotLabel: null,
  },
];

/**
 * Defaults from `doc/decision/0004-mvp-scope-includes-design-features.md`.
 * The init migration already inserts this row (the table must never be empty);
 * the seed re-asserts it so a hand-edited dev database returns to a known state.
 */
export const SEED_RESERVATION_WINDOW_SETTINGS: SeedReservationWindowSettings = {
  openDaysBefore: 7,
  lockMode: 'AUTO',
};

/** Fixed primary key of the settings singleton — see `doc/database.md`. */
export const RESERVATION_WINDOW_SETTINGS_ID = 1;

/**
 * The migration already inserts this row (the table must never be empty); the
 * seed re-asserts it so a hand-edited dev database returns to a known state —
 * the same arrangement as the window settings above.
 */
export const SEED_RESERVATION_LIMIT_SETTINGS: SeedReservationLimitSettings = {
  monthlyReservationCap: 5,
};

/** Fixed primary key of the limits singleton — see `doc/database.md`. */
export const RESERVATION_LIMIT_SETTINGS_ID = 1;
