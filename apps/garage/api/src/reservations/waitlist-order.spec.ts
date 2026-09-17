/**
 * Pins that `WAITLIST_ORDER` and `WAITLIST_ORDER_SQL` are the same invariant
 * spelled twice, not two invariants that happen to agree today. A drift
 * between them would not fail loudly — `waitlist-promotion.service.ts`'s
 * comment explains why a wrong `ORDER BY` can return the right rows on a
 * small fixture — so this compares both forms directly against what a
 * `Prisma.sql` fragment built from `WAITLIST_ORDER`'s own field names would
 * produce, rather than re-typing "createdAt, id" a third time.
 */

import { WAITLIST_ORDER, WAITLIST_ORDER_SQL } from './waitlist-order';

describe('waitlist order', () => {
  it('names the same columns, in the same directions, in the same sequence', () => {
    const columns = WAITLIST_ORDER.map((clause) => {
      const [field, direction] = Object.entries(clause)[0] as [string, string];
      return { field, direction };
    });

    // The SQL fragment, derived from `WAITLIST_ORDER`'s own field/direction
    // pairs rather than a second hand-typed "createdAt, id" literal — so this
    // fails if either form's columns or order ever move without the other.
    const expectedSql = `ORDER BY ${columns
      .map((c) => `"${c.field}" ${c.direction.toUpperCase()}`)
      .join(', ')}`;
    expect(WAITLIST_ORDER_SQL.sql).toBe(expectedSql);
    expect(WAITLIST_ORDER_SQL.values).toEqual([]);
  });
});
