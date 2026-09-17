/**
 * Domain fixtures shared by more than one spec.
 *
 * `profile()` was written out twice, thirteen fields at a time
 * (`lot/lot-screen/lot-screen.spec.tsx`, `lot/bulk-modal/bulk-modal.spec.tsx`), differing only in
 * `preferredParkingSpotId`. Thirteen fields is enough that a new required field
 * on `MyProfile` should break one place, not two — and enough that a reader
 * cannot tell at a glance which of the two copies is the odd one.
 *
 * `app/(app)/layout.spec.tsx` has a third copy, inlined inside a `jest.mock`
 * factory. That one **cannot** move here: jest hoists the factory above every
 * import, and referencing an out-of-scope binding from inside it is a hard
 * error rather than a style choice.
 */

import type { MyProfile } from '@garage/contract';

/**
 * The instant this module's fixtures are stamped with.
 *
 * Exported because three `lot/` specs stamp fixtures of their own with the
 * same literal — `bulk-view.spec.ts`, `lot-screen.spec.tsx`,
 * `bulk-modal.spec.tsx` — and a shared timestamp that is a shared constant
 * cannot drift from the one `profile()` uses. It is *not* the instant every
 * web spec uses: the `shell/` and `shell/admin/` specs pin their own dates,
 * because what those assert is about the date, not merely beside it.
 */
export const T0 = '2026-01-01T00:00:00.000Z';

/** The signed-in viewer. `preferredParkingSpotId` is the field specs vary. */
export function profile(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: 'user-viewer',
    email: 'karel.zibar@firma.cz',
    name: 'Karel Zíbar',
    licensePlate: '4AB 1234',
    role: 'USER',
    oktaId: 'okta-1',
    active: true,
    icsToken: 'ics-token',
    preferredParkingSpotId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}
