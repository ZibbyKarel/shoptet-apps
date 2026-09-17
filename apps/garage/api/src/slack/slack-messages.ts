/**
 * The Czech copy of every Slack notification.
 *
 * A Slack message is **UI copy**: a real person reads it in their client, so it
 * is Czech like the rest of the interface (`doc/decision/0029-*`), while every
 * comment and identifier around it stays English.
 *
 * ## Why it is not in `libs/shared/i18n`
 *
 * `libs/shared/i18n` is tagged `scope:web` and `apps/garage/api` is `scope:api`;
 * `@nx/enforce-module-boundaries` refuses the dependency, and it is right to —
 * `libs/shared/i18n` wraps `next-intl`, a React package with no business in a Nest
 * process. `doc/decision/0082-*` hit this first with the ICS feed's three
 * strings and said explicitly: *"If a second one appears (Slack notifications,
 * Task 16), that is the moment to reconsider option 2 with two real call sites
 * in view."* That reconsideration happened and is recorded in
 * `doc/decision/0131-*`; the short version is that a shared backend catalog
 * would hold two sets of strings with no word in common, so it would be a
 * folder, not an abstraction.
 *
 * What the two surfaces *do* share is the risk of drifting apart on **dates**,
 * and that is solved rather than accepted: this file formats through `Intl`
 * with the `cs` locale, which is the same ICU data
 * `libs/shared/i18n/src/lib/date-formatters.ts` reaches through next-intl's
 * `createFormatter`. The Czech genitive
 * (`25. srpna`, not the nominative `srpen`) falls out of ICU when `day` and
 * `month` are formatted in the same call — see that file's header, which
 * measured it. There is no month table here to fall out of step.
 *
 * ## Style
 *
 * Plain `text`, no Block Kit. `plan.md`'s scope boundary is outbound
 * `chat.postMessage` only: no blocks, no attachments, no buttons, nothing a
 * user could interact with — because there is no handler on the other side to
 * receive an interaction, and shipping a button that does nothing is worse
 * than shipping no button.
 *
 * Apostrophes are the typographic `’` (U+2019), matching the message catalog
 * in `libs/shared/i18n`, so the two surfaces read as one product.
 */

import type { DateOnly } from '@garage/shared-types';
import { toUtcMidnight } from '@garage/shared-types';

/** Locale for every string below. */
const CZECH_LOCALE = 'cs';

const fullDateFormat = new Intl.DateTimeFormat(CZECH_LOCALE, {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `pondělí 28. září 2026` — the same long form the lot screen shows. */
export function formatCzechFullDate(date: DateOnly): string {
  return fullDateFormat.format(toUtcMidnight(date));
}

/**
 * Escapes the three characters Slack's `text` field treats as markup, per
 * Slack's own escaping rule for plain text
 * (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, in that order so the ampersand a
 * later replacement introduces is never re-escaped).
 *
 * Spot labels are alphanumeric today (`E2.92`), so this has no visible effect
 * on anything this application currently sends — but a label is operator
 * data, not a compile-time constant, and one containing `<` would otherwise
 * render wrong or be silently swallowed by a Slack client.
 */
function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A spot came free and **stayed** free — nobody was waiting for it.
 *
 * Posted to the shared channel, because the whole point is that anybody may
 * take it. A cancellation that immediately promoted somebody produces
 * {@link waitlistPromotedMessage} instead and never this one: the contract
 * emits `reservation:reassigned` rather than `reservation:cancelled` in that
 * case, so the distinction is the realtime contract's, not a rule invented here.
 */
export function spotFreedMessage(spotLabel: string, date: DateOnly): string {
  return `Uvolnilo se parkovací místo ${escapeSlackText(spotLabel)} na ${formatCzechFullDate(date)}. Je volné pro kohokoli.`;
}

/**
 * Somebody was promoted off the waitlist. Sent as a direct message, because it
 * is the one thing that happens *to* a person rather than near them — they did
 * not ask for it and would otherwise find out by refreshing a page.
 */
export function waitlistPromotedMessage(spotLabel: string, date: DateOnly): string {
  return `Máte parkovací místo ${escapeSlackText(spotLabel)} na ${formatCzechFullDate(date)}. Uvolnilo se a byli jste první ve frontě.`;
}

/** What the daily summary reports. Counts, plus the labels of what is free. */
export interface DailySummary {
  readonly date: DateOnly;
  /** Active spots on the day. */
  readonly totalSpots: number;
  /** Labels of the spots nobody has reserved, in the order they are listed. */
  readonly freeSpotLabels: readonly string[];
  /** People queued for a spot on the day, across all spots. */
  readonly waitingCount: number;
}

/**
 * The daily summary, as two or three sentences on two lines.
 *
 * Every count-bearing phrase is built by a helper rather than by interpolating
 * into one template, because Czech agrees the noun *and* the verb with the
 * numeral in three classes — 1, 2–4, and 5-or-more, which takes the genitive
 * plural and a singular verb. A single `${count} míst` template would be wrong
 * for two of the three, and it would be wrong in the message a whole office
 * reads every morning.
 */
export function dailySummaryMessage(summary: DailySummary): string {
  const { date, totalSpots, freeSpotLabels, waitingCount } = summary;
  const heading = `Parkování — ${formatCzechFullDate(date)}`;
  const queue = queuePhrase(waitingCount);

  if (freeSpotLabels.length === 0) {
    return `${heading}\n${allOccupiedPhrase(totalSpots)}. ${queue}`;
  }
  const labels = freeSpotLabels.map(escapeSlackText).join(', ');
  return `${heading}\n${freePhrase(freeSpotLabels.length)} z ${totalSpots}: ${labels}. ${queue}`;
}

/** `Volné je 1 místo` / `Volná jsou 3 místa` / `Volných je 7 míst`. */
function freePhrase(count: number): string {
  if (count === 1) {
    return 'Volné je 1 místo';
  }
  return count <= 4 ? `Volná jsou ${count} místa` : `Volných je ${count} míst`;
}

/** `Jediné místo je obsazené` / `Všechna 3 místa jsou obsazená` / `Všech 9 míst je obsazených`. */
function allOccupiedPhrase(total: number): string {
  if (total === 1) {
    return 'Jediné místo je obsazené';
  }
  return total <= 4 ? `Všechna ${total} místa jsou obsazená` : `Všech ${total} míst je obsazených`;
}

/** `Nikdo nečeká ve frontě.` / `Ve frontě čeká 1 člověk.` / `… čekají 3 lidé.` / `… čeká 7 lidí.` */
function queuePhrase(count: number): string {
  if (count === 0) {
    return 'Nikdo nečeká ve frontě.';
  }
  if (count === 1) {
    return 'Ve frontě čeká 1 člověk.';
  }
  return count <= 4 ? `Ve frontě čekají ${count} lidé.` : `Ve frontě čeká ${count} lidí.`;
}
