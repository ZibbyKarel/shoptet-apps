/**
 * Values the hook specs share.
 *
 * Local rather than imported from `libs/garage/contract/src/__fixtures__`: that
 * folder is excluded from the contract's build program and is not part of
 * `@garage/contract/realtime`'s public surface, so reaching into it would
 * mean importing a deep path across a library boundary.
 */

export const API_URL = 'http://parking.test';

export const SPOT_ID = '22222222-2222-4222-8222-222222222222';
export const OTHER_SPOT_ID = '33333333-3333-4333-8333-333333333333';
export const USER_ID = '11111111-1111-4111-8111-111111111111';

export const DATE = '2026-09-15';
export const OTHER_DATE = '2026-09-16';

/** Matches `userSummarySchema`. */
export const USER_SUMMARY = {
  id: USER_ID,
  name: 'Jana Nováková',
  licensePlate: '1AB 2345',
};

/** Drains the microtask queue the async token provider hops through. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
