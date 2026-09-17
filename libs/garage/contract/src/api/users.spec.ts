import * as z from 'zod';
import { userSchema } from '../schemas/entities';
import { DATE_A, NOT_A_UUID, UUID_A, userFixture } from '../__fixtures__/fixtures';
import {
  ADMIN_USER_FIELDS,
  adminListUsersInputSchema,
  adminListUsersOutputSchema,
  adminUpdateUserInputSchema,
  adminUserSchema,
} from './users';

describe('adminUserSchema', () => {
  it('strips the ICS token — an admin has no business holding one', () => {
    const parsed = adminUserSchema.parse(userFixture);
    expect(parsed).not.toHaveProperty('icsToken');
    expect(parsed.email).toBe(userFixture.email);
    expect(parsed.preferredParkingSpotId).toBe(userFixture.preferredParkingSpotId);
  });

  it('is exactly the declared allowlist, so widening it takes an edit here', () => {
    expect(Object.keys(adminUserSchema.shape).sort()).toEqual(
      Object.keys(ADMIN_USER_FIELDS).sort()
    );
  });

  it('does not grow when the user entity grows', () => {
    // The whole reason this is a `pick` and not an `omit` (`doc/decision/0247-*`).
    // Exercised rather than argued: widen `userSchema` the way the next task to
    // add a per-user secret would, and check both directions against it.
    const widened = userSchema.extend({ passwordResetToken: z.string().min(1) });

    // The allowlist this file declares refuses it by construction.
    expect(Object.keys(widened.pick(ADMIN_USER_FIELDS).shape)).not.toContain('passwordResetToken');
    // Subtracting `icsToken` — what this schema used to do — serves it to every
    // admin, with nothing red anywhere.
    expect(Object.keys(widened.omit({ icsToken: true }).shape)).toContain('passwordResetToken');
  });

  it('rejects a user with an unknown role', () => {
    expect(adminUserSchema.safeParse({ ...userFixture, role: 'SUPERUSER' }).success).toBe(false);
  });
});

describe('adminListUsersInputSchema', () => {
  it('accepts no filter at all', () => {
    expect(adminListUsersInputSchema.parse({})).toEqual({});
  });

  it('accepts every filter together', () => {
    expect(adminListUsersInputSchema.parse({ role: 'ADMIN', active: true, search: 'nov' })).toEqual(
      { role: 'ADMIN', active: true, search: 'nov' }
    );
  });

  it('accepts the queue-target exclusion filter', () => {
    expect(
      adminListUsersInputSchema.parse({
        active: true,
        excludingReservedOrQueuedFor: { parkingSpotId: UUID_A, date: DATE_A },
      })
    ).toEqual({
      active: true,
      excludingReservedOrQueuedFor: { parkingSpotId: UUID_A, date: DATE_A },
    });
  });

  it('rejects the exclusion filter with a non-uuid spot id or a malformed date', () => {
    expect(
      adminListUsersInputSchema.safeParse({
        excludingReservedOrQueuedFor: { parkingSpotId: NOT_A_UUID, date: DATE_A },
      }).success
    ).toBe(false);
    expect(
      adminListUsersInputSchema.safeParse({
        excludingReservedOrQueuedFor: { parkingSpotId: UUID_A, date: '2026-13-40' },
      }).success
    ).toBe(false);
  });

  it('rejects an unknown role and an empty search string', () => {
    expect(adminListUsersInputSchema.safeParse({ role: 'ROOT' }).success).toBe(false);
    expect(adminListUsersInputSchema.safeParse({ search: '' }).success).toBe(false);
  });
});

describe('adminListUsersOutputSchema', () => {
  it('accepts a list without tokens', () => {
    const { icsToken: _token, ...withoutToken } = userFixture;
    expect(adminListUsersOutputSchema.safeParse({ users: [withoutToken] }).success).toBe(true);
  });

  it('rejects a payload that is not a list', () => {
    expect(adminListUsersOutputSchema.safeParse({ users: {} }).success).toBe(false);
  });
});

describe('adminUpdateUserInputSchema', () => {
  it('accepts an id alone', () => {
    expect(adminUpdateUserInputSchema.parse({ id: UUID_A })).toEqual({ id: UUID_A });
  });

  it('accepts a role change and a deactivation', () => {
    expect(adminUpdateUserInputSchema.parse({ id: UUID_A, role: 'ADMIN' })).toEqual({
      id: UUID_A,
      role: 'ADMIN',
    });
    expect(adminUpdateUserInputSchema.parse({ id: UUID_A, active: false })).toEqual({
      id: UUID_A,
      active: false,
    });
  });

  it('does not let an admin change a name, an email or a licence plate', () => {
    const parsed = adminUpdateUserInputSchema.parse({
      id: UUID_A,
      name: 'Someone Else',
      email: 'someone@example.com',
      licensePlate: '9ZZ 9999',
    });
    expect(parsed).toEqual({ id: UUID_A });
  });

  it('rejects a missing or invalid id', () => {
    expect(adminUpdateUserInputSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(adminUpdateUserInputSchema.safeParse({ id: NOT_A_UUID }).success).toBe(false);
  });
});
