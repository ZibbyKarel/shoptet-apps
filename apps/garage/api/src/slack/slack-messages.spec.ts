/**
 * The Czech copy. Asserted as whole sentences rather than as fragments,
 * because the failure mode being guarded against is grammatical — a numeral
 * agreeing with the wrong noun form — and a fragment assertion cannot see it.
 */

import type { DateOnly } from '@garage/shared-types';
import {
  dailySummaryMessage,
  formatCzechFullDate,
  spotFreedMessage,
  waitlistPromotedMessage,
} from './slack-messages';

const MONDAY = '2026-09-28' as DateOnly;

describe('formatCzechFullDate', () => {
  it('renders the long Czech form, with the genitive month', () => {
    expect(formatCzechFullDate(MONDAY)).toBe('pondělí 28. září 2026');
  });

  it('uses the genitive, which is what a bare month name would not give', () => {
    // `srpen` is the nominative; `25. srpna` is the genitive ICU produces when
    // the day is in the same format call. This is the distinction
    // `libs/shared/i18n/src/lib/dates.ts` measured, restated where the backend can see
    // it break.
    expect(formatCzechFullDate('2026-08-25' as DateOnly)).toBe('úterý 25. srpna 2026');
  });

  it('renders the calendar day asked for on both sides of a DST change', () => {
    // A `DateOnly` is a calendar day, not an instant: 29 March 2026 is the
    // spring-forward Sunday in Prague and 25 October the autumn one. A
    // formatter that built a local `Date` would be a day out on one of them
    // depending on the host's zone.
    expect(formatCzechFullDate('2026-03-29' as DateOnly)).toBe('neděle 29. března 2026');
    expect(formatCzechFullDate('2026-10-25' as DateOnly)).toBe('neděle 25. října 2026');
  });
});

describe('spotFreedMessage', () => {
  it('names the spot, the day, and that anybody may take it', () => {
    expect(spotFreedMessage('E2.92', MONDAY)).toBe(
      'Uvolnilo se parkovací místo E2.92 na pondělí 28. září 2026. Je volné pro kohokoli.'
    );
  });

  it('escapes Slack markup characters in the label', () => {
    // Not a live defect — spot labels are alphanumeric today — but Slack's
    // `text` field treats `&`, `<` and `>` as markup, and a label is operator
    // data rather than a compile-time constant.
    expect(spotFreedMessage('<A&B>', MONDAY)).toBe(
      'Uvolnilo se parkovací místo &lt;A&amp;B&gt; na pondělí 28. září 2026. Je volné pro kohokoli.'
    );
  });
});

describe('waitlistPromotedMessage', () => {
  it('tells the promoted person they now hold the spot', () => {
    expect(waitlistPromotedMessage('E2.92', MONDAY)).toBe(
      'Máte parkovací místo E2.92 na pondělí 28. září 2026. Uvolnilo se a byli jste první ve frontě.'
    );
  });

  it('escapes Slack markup characters in the label', () => {
    expect(waitlistPromotedMessage('<A&B>', MONDAY)).toBe(
      'Máte parkovací místo &lt;A&amp;B&gt; na pondělí 28. září 2026. Uvolnilo se a byli jste první ve frontě.'
    );
  });
});

describe('dailySummaryMessage', () => {
  const base = { date: MONDAY, totalSpots: 9, freeSpotLabels: [], waitingCount: 0 };

  it('agrees the numeral with the noun for exactly one free spot', () => {
    expect(dailySummaryMessage({ ...base, freeSpotLabels: ['E2.92'] })).toBe(
      'Parkování — pondělí 28. září 2026\nVolné je 1 místo z 9: E2.92. Nikdo nečeká ve frontě.'
    );
  });

  it('uses the 2–4 form, which is a different word from both neighbours', () => {
    expect(dailySummaryMessage({ ...base, freeSpotLabels: ['A1', 'A2', 'A3'] })).toBe(
      'Parkování — pondělí 28. září 2026\nVolná jsou 3 místa z 9: A1, A2, A3. Nikdo nečeká ve frontě.'
    );
  });

  it('uses the genitive plural from five upwards', () => {
    expect(dailySummaryMessage({ ...base, freeSpotLabels: ['A1', 'A2', 'A3', 'A4', 'A5'] })).toBe(
      'Parkování — pondělí 28. září 2026\nVolných je 5 míst z 9: A1, A2, A3, A4, A5. Nikdo nečeká ve frontě.'
    );
  });

  it('stays in the 2–4 form at its upper edge, 4 free spots', () => {
    // The 2–4/5+ boundary is exactly the place an off-by-one in `<=` vs `<`
    // hides: 3 and 5 cannot tell `<= 4` from `< 4`, only 4 itself can.
    expect(dailySummaryMessage({ ...base, freeSpotLabels: ['A1', 'A2', 'A3', 'A4'] })).toBe(
      'Parkování — pondělí 28. září 2026\nVolná jsou 4 místa z 9: A1, A2, A3, A4. Nikdo nečeká ve frontě.'
    );
  });

  it('says the lot is full when nothing is free', () => {
    expect(dailySummaryMessage(base)).toBe(
      'Parkování — pondělí 28. září 2026\nVšech 9 míst je obsazených. Nikdo nečeká ve frontě.'
    );
  });

  it('agrees the full-lot sentence for a small lot too', () => {
    expect(dailySummaryMessage({ ...base, totalSpots: 3 })).toBe(
      'Parkování — pondělí 28. září 2026\nVšechna 3 místa jsou obsazená. Nikdo nečeká ve frontě.'
    );
    expect(dailySummaryMessage({ ...base, totalSpots: 1 })).toBe(
      'Parkování — pondělí 28. září 2026\nJediné místo je obsazené. Nikdo nečeká ve frontě.'
    );
  });

  it('stays in the 2–4 full-lot form at its upper edge, 4 spots', () => {
    expect(dailySummaryMessage({ ...base, totalSpots: 4 })).toBe(
      'Parkování — pondělí 28. září 2026\nVšechna 4 místa jsou obsazená. Nikdo nečeká ve frontě.'
    );
  });

  it.each([
    [1, 'Ve frontě čeká 1 člověk.'],
    [2, 'Ve frontě čekají 2 lidé.'],
    [4, 'Ve frontě čekají 4 lidé.'],
    [5, 'Ve frontě čeká 5 lidí.'],
    [11, 'Ve frontě čeká 11 lidí.'],
  ])('reports a queue of %i as "%s"', (waitingCount, expected) => {
    expect(dailySummaryMessage({ ...base, waitingCount })).toContain(expected);
  });

  it('lists the free spots in the order it was given them', () => {
    const message = dailySummaryMessage({ ...base, freeSpotLabels: ['B1', 'A1'] });

    expect(message).toContain('B1, A1');
  });

  it('escapes Slack markup characters in a free spot label', () => {
    const message = dailySummaryMessage({ ...base, freeSpotLabels: ['<A&B>'] });

    expect(message).toContain('&lt;A&amp;B&gt;');
    expect(message).not.toContain('<A&B>');
  });

  it('is plain text — no Block Kit, no markup a button could hang off', () => {
    const message = dailySummaryMessage({ ...base, freeSpotLabels: ['A1'], waitingCount: 2 });

    expect(message).not.toContain('{');
    expect(message).not.toContain('<');
  });
});
