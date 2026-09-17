/**
 * `DateOnly` and `YearMonth` are validated twice, on purpose, and this is the
 * spec that keeps the two answers the same.
 *
 * `libs/garage/shared-types` is `layer:foundation` with `allowedExternalImports: []`
 * and a `no-restricted-imports` rule naming Zod (`eslint.config.mjs:283`,
 * `:623-637`, `doc/decision/0003-*`, `doc/decision/0017-*`), so it cannot use
 * `dateOnlySchema`; `libs/garage/contract` would not want a second validation path.
 * Two implementations is the correct answer — but they are the front and back
 * door to one invariant. The API accepts what `dateOnlySchema` accepts, and the
 * domain (`bulk-allocator.ts`, `assertDateOnly` in `prisma-mapping.ts`) trusts
 * what `isDateOnly` accepts. A Zod release that changed `z.iso.date()`'s year
 * handling, or an edit to `DATE_ONLY_PATTERN`, would open a silent gap between
 * the transport and the domain that no other suite would notice.
 *
 * `libs/garage/contract` is the only project that may import both: `type:contract`
 * depends on `layer:foundation` and its npm allowlist includes Zod. The
 * runtime import below is the same, already-permitted edge that
 * `src/realtime/rooms.ts` uses for `assertDateOnly`.
 */

import { isDateOnly, isYearMonth } from '@garage/shared-types';
import { dateOnlySchema, yearMonthSchema } from './primitives';

/** Inputs chosen for where the two implementations could plausibly disagree. */
const CANDIDATES: readonly unknown[] = [
  // Ordinary days.
  '2026-08-28',
  '1970-01-01',
  '2000-12-31',
  // Leap-year arithmetic, including the century rule.
  '2024-02-29',
  '2026-02-29',
  '2000-02-29',
  '1900-02-29',
  // Month lengths.
  '2026-04-31',
  '2026-04-30',
  '2026-01-31',
  // Range edges on the month and day fields.
  '2026-00-10',
  '2026-13-01',
  '2026-01-00',
  '2026-01-32',
  // Year edges. `0000` is a real ISO year; a `Date.UTC`-based check would
  // silently read it as 1900.
  '0000-01-01',
  '0001-01-01',
  '9999-12-31',
  // Shapes that are not `YYYY-MM-DD`.
  '2026-1-01',
  '2026-01-1',
  '26-01-01',
  '20260101',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01 ',
  ' 2026-01-01',
  '2026-01-01\n',
  '+2026-01-01',
  '-2026-01-01',
  '2026-08',
  '',
  // Non-strings: both sides must refuse them rather than coerce.
  null,
  undefined,
  0,
  20260101,
  new Date('2026-08-28T00:00:00.000Z'),
  ['2026-08-28'],
  { toString: () => '2026-08-28' },
];

/** The `YYYY-MM` half, plus the day-shaped inputs, which must all be refused. */
const MONTH_CANDIDATES: readonly unknown[] = [
  '2026-01',
  '2026-12',
  '2026-00',
  '2026-13',
  '2026-1',
  '0000-01',
  '9999-12',
  '26-01',
  '202601',
  '2026-01-01',
  '2026-01 ',
  '',
  ...([null, undefined, 0, 202601, ['2026-01'], {}] as const),
];

describe('DateOnly is validated identically by shared-types and by the contract', () => {
  it.each(CANDIDATES.map((value) => [JSON.stringify(value) ?? String(value), value]))(
    'isDateOnly and dateOnlySchema agree on %s',
    (_label, value) => {
      expect(isDateOnly(value)).toBe(dateOnlySchema.safeParse(value).success);
    }
  );

  it.each(MONTH_CANDIDATES.map((value) => [JSON.stringify(value) ?? String(value), value]))(
    'isYearMonth and yearMonthSchema agree on %s',
    (_label, value) => {
      expect(isYearMonth(value)).toBe(yearMonthSchema.safeParse(value).success);
    }
  );
});
