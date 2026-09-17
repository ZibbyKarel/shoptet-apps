import {
  MONTH_LOCK_STATES,
  PARKING_GROUPS,
  RESERVATION_LOCK_MODES,
  USER_ROLES,
  type MonthLockState as SharedMonthLockState,
  type ParkingGroup as SharedParkingGroup,
  type ReservationLockMode as SharedReservationLockMode,
  type UserRole as SharedUserRole,
} from '@garage/shared-types';
import {
  monthLockStateSchema,
  parkingGroupSchema,
  reservationLockModeSchema,
  userRoleSchema,
  type MonthLockState,
  type ParkingGroup,
  type ReservationLockMode,
  type UserRole,
} from './enums';

/** Compile-time assertion that two types are mutually assignable. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function expectSameType<T extends true>(): void {
  void (undefined as unknown as T);
}

describe('enum schemas mirror the shared-types tuples', () => {
  it.each([
    ['parkingGroupSchema', parkingGroupSchema, PARKING_GROUPS],
    ['userRoleSchema', userRoleSchema, USER_ROLES],
    ['reservationLockModeSchema', reservationLockModeSchema, RESERVATION_LOCK_MODES],
    ['monthLockStateSchema', monthLockStateSchema, MONTH_LOCK_STATES],
  ] as const)('%s accepts exactly its tuple', (_name, schema, values) => {
    for (const value of values) {
      expect(schema.safeParse(value).success).toBe(true);
    }
    expect(schema.safeParse('SOMETHING_ELSE').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });

  it('is case sensitive', () => {
    expect(parkingGroupSchema.safeParse('it').success).toBe(false);
    expect(userRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('derives types identical to the shared-types ones', () => {
    // The values live once, in shared-types; the contract types stay derived
    // through z.infer. This asserts the two never drift apart.
    expectSameType<Equals<ParkingGroup, SharedParkingGroup>>();
    expectSameType<Equals<UserRole, SharedUserRole>>();
    expectSameType<Equals<ReservationLockMode, SharedReservationLockMode>>();
    expectSameType<Equals<MonthLockState, SharedMonthLockState>>();
    expect(true).toBe(true);
  });
});
