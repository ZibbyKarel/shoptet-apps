/**
 * The exact arguments the seed hands to `prisma.user.upsert`.
 *
 * Extracted from `src/scripts/seed.ts` so that the one property that matters
 * about them can be *asserted* rather than read: **`icsToken` appears in
 * `create` and never in `update`.** The script itself calls `main()` on import,
 * so nothing inside it can be unit-tested; this function can.
 *
 * The final review's I-5: the previous shape spread the whole seed row into
 * both branches, so `prisma db seed` silently reverted a token the account
 * holder had regenerated through the UI — **re-validating a feed URL they had
 * deliberately revoked**, which is precisely the property `schema.prisma`
 * documents on the column. The same shape would revert a randomly generated
 * token too, which is why this is a separate fix from
 * `doc/decision/0275-*`.
 */

import { generateSeedIcsToken } from './ics-token';
import type { SeedUser } from './seed-data';

/** Columns the seed asserts on every run, for a user that already exists. */
export interface SeedUserUpdate {
  readonly name: string;
  readonly licensePlate: string | null;
  readonly role: SeedUser['role'];
  readonly oktaId: string;
  readonly active: boolean;
  readonly preferredParkingSpotId: string | null;
}

/** The update columns plus the one that is only ever written at creation. */
export type SeedUserCreate = SeedUserUpdate & {
  readonly email: string;
  readonly icsToken: string;
};

export interface SeedUserUpsertArgs {
  readonly where: { readonly email: string };
  readonly update: SeedUserUpdate;
  readonly create: SeedUserCreate;
}

/**
 * Builds the upsert for one seeded account.
 *
 * `role` and `active` deliberately stay in `update`: those are the seed's to
 * assert on every run, and `apps/garage/web-e2e` depends on `inactive@example.com`
 * being inactive when a suite starts. `icsToken` is not, because it is a
 * credential the account holder owns once it exists.
 *
 * A fresh token is minted on every call. Prisma only uses the `create` branch
 * when the row is absent, so for an existing account the value is generated and
 * discarded — cheap, and much harder to get wrong than threading a conditional
 * through the caller.
 */
export function seedUserUpsertArgs(
  user: SeedUser,
  preferredParkingSpotId: string | null
): SeedUserUpsertArgs {
  const update: SeedUserUpdate = {
    name: user.name,
    licensePlate: user.licensePlate,
    role: user.role,
    oktaId: user.oktaId,
    active: user.active,
    preferredParkingSpotId,
  };

  return {
    where: { email: user.email },
    update,
    create: { ...update, email: user.email, icsToken: generateSeedIcsToken() },
  };
}
