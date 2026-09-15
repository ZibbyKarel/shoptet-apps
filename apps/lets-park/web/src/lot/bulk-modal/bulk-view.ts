/**
 * Everything the bulk modal decides, as pure functions.
 *
 * The same split `../lot-view.ts` makes, for the same reason: the month grid's
 * arithmetic, the "which days may be picked" rule, the preferred-spot label's
 * three failure modes, and — the one that matters most — the comparison of the
 * confirmed schedule against the proposal are all testable without a DOM, a
 * query client or a socket. `./bulk-modal.tsx` only draws what these return.
 *
 * Nothing here formats a date or reads a message: formatting is `libs/shared/i18n`'s
 * and copy is the component's, so these functions can assert structure.
 *
 * A message **key** is structure, though, and lives here — which case are we
 * in — while the sentence it names stays copy and stays in the component. Each
 * union this module produces is therefore enumerated once, in the module that
 * produced it: `toBulkErrorMessageKey`, {@link toBadgeMessage} and
 * {@link toPreferredSpotMessage}. Re-switching on one of them in the component
 * would enumerate its variants twice, and adding a variant would then fail to
 * compile in the wrong file.
 */

import {
  compareDateOnly,
  isBefore,
  isBusinessDay,
  isWeekend,
  parseDateOnly,
  type DateOnly,
} from '@lets-park/i18n';
import {
  buildCalendarGrid,
  type CalendarGrid,
  type CalendarSlot,
  type CalendarWeek,
} from '../calendar-grid';
import type {
  BulkDayPlan,
  BulkDayResult,
  BulkUnavailableReason,
  ErrorCode,
  ParkingSpot,
} from '@lets-park/contract';
import { toContractError } from '@lets-park/api-client';

const DAYS_PER_WEEK = 7;

/** Why a cell in the month grid cannot be picked. */
export type BulkCellBlock = 'WEEKEND' | 'HOLIDAY' | 'PAST' | 'ALREADY_RESERVED';

/**
 * One day in the month grid.
 *
 * `selectable` and `block` were a `boolean` beside a nullable, correlated by a
 * comment reading "`null` exactly when `selectable` is `true`". They are one
 * fact: a cell is blocked, and there is a reason, or it is not. As a union the
 * reason is reachable only where it exists and cannot be attached to a day the
 * user may pick.
 */
export type BulkDayCell = {
  readonly date: DateOnly;
  /** The number printed in the cell. */
  readonly dayOfMonth: number;
  /** Saturday or Sunday — the two columns the design sets apart on the right. */
  readonly weekendColumn: boolean;
} & ({ readonly selectable: true } | { readonly selectable: false; readonly block: BulkCellBlock });

/**
 * A slot in a week row. `day` is `null` for a slot before the 1st or after the
 * last day of the month — the design leaves those empty rather than spilling
 * the neighbouring months in, because a day outside the month could never be
 * part of this request anyway (the contract refuses a batch spanning two
 * months).
 *
 * The layout itself — which days these are, and how they pad to whole weeks —
 * is `../calendar-grid.ts`'s; this module only supplies {@link BulkDayCell}.
 */
export type BulkGridSlot = CalendarSlot<BulkDayCell>;
export type BulkGridWeek = CalendarWeek<BulkDayCell>;
export type BulkMonthGrid = CalendarGrid<BulkDayCell>;

/**
 * One day's cell.
 *
 * The order of the checks is the allocator's, not a convenience: `planDay`
 * asks `isBusinessDay` **first** (`doc/decision/0090-*`, following
 * `doc/decision/0064-*`) because a Saturday is the most durable fact about a
 * day. A past Saturday therefore reads as a weekend here too, which is what
 * the note under the grid explains; reversing it would put "in the past" on
 * cells whose real reason never changes.
 */
function toCell(
  date: DateOnly,
  today: DateOnly,
  reservedDates: ReadonlySet<DateOnly>
): BulkDayCell {
  const block: BulkCellBlock | null = !isBusinessDay(date)
    ? isWeekend(date)
      ? 'WEEKEND'
      : 'HOLIDAY'
    : isBefore(date, today)
      ? 'PAST'
      : reservedDates.has(date)
        ? 'ALREADY_RESERVED'
        : null;

  return {
    date,
    dayOfMonth: parseDateOnly(date).day,
    weekendColumn: isWeekend(date),
    ...(block === null ? { selectable: true } : { selectable: false, block }),
  };
}

/**
 * The month containing `anchor`, laid out as the design draws it.
 *
 * A past day is not selectable even though it is a perfectly good business
 * day: `previewBulk` and `confirmBulk` answer `PAST_DATE` for the **whole**
 * request when one is present (`doc/decision/0090-*`), so offering it would
 * let one stale cell throw away a month's selection.
 */
export function buildMonthGrid(
  anchor: DateOnly,
  today: DateOnly,
  reservedDates: ReadonlySet<DateOnly>
): BulkMonthGrid {
  return buildCalendarGrid(anchor, (date) => toCell(date, today, reservedDates));
}

/**
 * Which of the seven columns are the weekend ones, **read off the grid itself**
 * rather than from a second copy of "Saturday and Sunday are 6 and 7".
 *
 * The design sets the weekend columns apart on the right, heads included
 * ("víkendy vizuálně v zákrytu vpravo"), and this is what lets the heads and
 * the cells recede from the same fact — `BulkDayCell.weekendColumn` — instead
 * of from two rules that could drift. A column is a weekend column when any
 * day landing in it is; the scan is total, so a month whose first row is mostly
 * blanks still answers correctly.
 */
export function weekendColumns(grid: BulkMonthGrid): readonly boolean[] {
  const flags: boolean[] = Array.from({ length: DAYS_PER_WEEK }, () => false);
  for (const week of grid.weeks) {
    week.slots.forEach((slot, index) => {
      if (slot.day?.weekendColumn === true) {
        flags[index] = true;
      }
    });
  }
  return flags;
}

/**
 * What the line under the grid says about the preferred spot.
 *
 * **Five** cases, not two.
 *
 * `unavailable` is the one that is easy to miss: the profile stores an id, the
 * label comes from `spot.list`, and `spot.list` returns **active spots only** —
 * so a spot deactivated after the user chose it leaves an id with no label.
 * Rendering the label as a blank (or as the raw id) would say the plan starts
 * from a spot it cannot possibly start from. This is the same hazard the
 * settings screen already has copy for (`settings.preferredSpotUnavailable`).
 *
 * `unknown` is the one that was missed: a TanStack query's `data` is
 * `undefined` both **while in flight and after it failed**, so folding the two
 * together left a user whose `me.get` 500'd reading "načítá se…" for the whole
 * flow, being promised a resolution that was never coming. `failed` is
 * therefore checked first and short-circuits.
 *
 * Note that one `failed` flag covers both queries even though they are two
 * requests. That is not the "several typed errors, one sentence" defect
 * (`doc/decision/0171-*`): this line answers a single question — *what is your
 * preferred spot* — and when either read fails the honest answer to it is the
 * same, "we could not find out". There is no action the user could take that
 * differs between the two.
 *
 * @param preferredParkingSpotId `undefined` while the profile is loading,
 *   `null` when the user has no preference.
 * @param spots `undefined` while the spot list is loading.
 * @param failed `true` when either read errored rather than being in flight.
 */
export type PreferredSpotView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'none' }
  | { readonly kind: 'named'; readonly label: string }
  | { readonly kind: 'unavailable' };

export function toPreferredSpotView(
  preferredParkingSpotId: string | null | undefined,
  spots: readonly ParkingSpot[] | undefined,
  failed: boolean
): PreferredSpotView {
  if (failed) {
    return { kind: 'unknown' };
  }
  if (preferredParkingSpotId === undefined) {
    return { kind: 'loading' };
  }
  if (preferredParkingSpotId === null) {
    return { kind: 'none' };
  }
  if (spots === undefined) {
    return { kind: 'loading' };
  }
  const match = spots.find((spot) => spot.id === preferredParkingSpotId);
  return match === undefined ? { kind: 'unavailable' } : { kind: 'named', label: match.label };
}

/**
 * Which sentence the line under the grid is, and what to fill into it.
 *
 * The same shape `lot-view.ts`'s `toBannerView` uses, for the same reason:
 * `values` is always populated, so the key may vary without the call site
 * varying. `label` is blank for every case that does not name a spot, and
 * those keys do not interpolate it.
 *
 * The **key** is structure — which of {@link PreferredSpotView}'s five cases
 * are we in — while the sentence stays copy and stays in the component. That
 * is the line this module's own `toBulkErrorMessageKey` already draws.
 */
type PreferredSpotMessageKey =
  | 'preferredSpotLoading'
  | 'preferredSpotUnknown'
  | 'preferredSpotNone'
  | 'preferredSpotUnavailable'
  | 'preferredSpot';

export function toPreferredSpotMessage(view: PreferredSpotView): {
  readonly messageKey: PreferredSpotMessageKey;
  readonly values: { readonly label: string };
} {
  const values = { label: view.kind === 'named' ? view.label : '' };

  switch (view.kind) {
    case 'loading':
      return { messageKey: 'preferredSpotLoading', values };
    case 'unknown':
      return { messageKey: 'preferredSpotUnknown', values };
    case 'none':
      return { messageKey: 'preferredSpotNone', values };
    case 'unavailable':
      return { messageKey: 'preferredSpotUnavailable', values };
    case 'named':
      return { messageKey: 'preferredSpot', values };
  }
}

/** The badge one schedule row carries. Tone is the component's business. */
export type BulkBadgeView =
  | { readonly kind: 'ASSIGNED_PREFERRED' }
  | { readonly kind: 'ASSIGNED' }
  | { readonly kind: 'QUEUED'; readonly position: number }
  | { readonly kind: 'UNAVAILABLE'; readonly reason: BulkUnavailableReason };

export interface BulkScheduleRowView {
  readonly date: DateOnly;
  /** The allocated spot, or `null` for a day nothing could be done for. */
  readonly spotLabel: string | null;
  readonly badge: BulkBadgeView;
}

/** One day, whether it came from the proposal or from the result. */
export type BulkDayOutcomeView = BulkDayPlan | BulkDayResult;

export function toBadge(day: BulkDayOutcomeView): BulkBadgeView {
  switch (day.outcome) {
    case 'SPOT_ASSIGNED':
      return day.isPreferredSpot ? { kind: 'ASSIGNED_PREFERRED' } : { kind: 'ASSIGNED' };
    case 'QUEUED':
      return { kind: 'QUEUED', position: day.waitlistPosition };
    case 'UNAVAILABLE':
      return { kind: 'UNAVAILABLE', reason: day.reason };
  }
}

/**
 * Which sentence a badge is, and what to fill into it.
 *
 * The counterpart of {@link toPreferredSpotMessage} for {@link BulkBadgeView},
 * and the reason both exist here: the union is produced in this module, so the
 * one place that enumerates its variants should also be the one place that
 * names them. Enumerating them again in the component means a new variant
 * fails to compile in the wrong file.
 *
 * `position` is always populated — 0 for the three cases that have no queue
 * position, none of which interpolate it — so the component makes one `t` call
 * for all six sentences instead of six.
 */
type BulkBadgeMessageKey =
  | 'badgeAssignedPreferred'
  | 'badgeAssigned'
  | 'badgeQueued'
  | 'badgeAlreadyReserved'
  | 'badgeNotBusinessDay'
  | 'badgeNoSpots';

export function toBadgeMessage(badge: BulkBadgeView): {
  readonly messageKey: BulkBadgeMessageKey;
  readonly values: { readonly position: number };
} {
  const values = { position: badge.kind === 'QUEUED' ? badge.position : 0 };

  switch (badge.kind) {
    case 'ASSIGNED_PREFERRED':
      return { messageKey: 'badgeAssignedPreferred', values };
    case 'ASSIGNED':
      return { messageKey: 'badgeAssigned', values };
    case 'QUEUED':
      return { messageKey: 'badgeQueued', values };
    case 'UNAVAILABLE':
      switch (badge.reason) {
        case 'ALREADY_HAS_RESERVATION':
          return { messageKey: 'badgeAlreadyReserved', values };
        case 'NOT_A_BUSINESS_DAY':
          return { messageKey: 'badgeNotBusinessDay', values };
        case 'NO_SPOTS_AVAILABLE':
          return { messageKey: 'badgeNoSpots', values };
      }
  }
}

/**
 * The proposal or the result as rows, **in date order**.
 *
 * The contract returns the days in request order. Re-sorting here is a display
 * guarantee rather than defence in depth: the two lists are laid side by side
 * on the result step, and a reader comparing them should not also have to
 * account for two orderings.
 */
export function toScheduleRows(
  days: readonly BulkDayOutcomeView[]
): readonly BulkScheduleRowView[] {
  return [...days]
    .sort((a, b) => compareDateOnly(a.date, b.date))
    .map((day) => ({
      date: day.date,
      spotLabel: day.outcome === 'UNAVAILABLE' ? null : day.parkingSpotLabel,
      badge: toBadge(day),
    }));
}

/**
 * Whether two answers for the same day say the same thing.
 *
 * Compared on the fields the user was shown, plus the spot **id** — the label
 * is denormalized and two spots could in principle be relabelled into each
 * other, so the id is the identity. `reservationId` / `waitlistEntryId` are
 * deliberately not compared: they exist only on the result, and their absence
 * from the proposal is not a difference the user cares about.
 */
export function sameOutcome(a: BulkDayOutcomeView, b: BulkDayOutcomeView): boolean {
  if (a.outcome !== b.outcome) {
    return false;
  }
  if (a.outcome === 'SPOT_ASSIGNED' && b.outcome === 'SPOT_ASSIGNED') {
    return a.parkingSpotId === b.parkingSpotId && a.isPreferredSpot === b.isPreferredSpot;
  }
  if (a.outcome === 'QUEUED' && b.outcome === 'QUEUED') {
    return a.parkingSpotId === b.parkingSpotId && a.waitlistPosition === b.waitlistPosition;
  }
  if (a.outcome === 'UNAVAILABLE' && b.outcome === 'UNAVAILABLE') {
    return a.reason === b.reason;
  }
  return false;
}

export interface BulkDayDifference {
  readonly date: DateOnly;
  /** `null` when the result mentions a day the proposal never did. */
  readonly proposed: BulkDayPlan | null;
  /** `null` when the proposal mentioned a day the result never did. */
  readonly confirmed: BulkDayResult | null;
}

/**
 * Every day where the confirmation did not match the proposal, ascending.
 *
 * This is the whole reason the flow has two steps. `confirmBulk` deliberately
 * leaves a race open between the read and the write
 * (`doc/decision/0092-*`, §"Why no `SELECT … FOR UPDATE`"): a day the preview
 * promised a spot for can come back as a queue position because somebody else
 * booked it in between. The server cannot compute this diff — it never
 * receives the plan the client is holding (`libs/lets-park/contract/src/api/bulk.ts`) —
 * so the client keeps its proposal and zips the two by `date`.
 *
 * Days present on only one side are reported too. That should not happen (both
 * procedures answer one entry per requested day) but "should not happen" is
 * not a reason to drop a day silently out of a comparison whose only job is to
 * be complete.
 */
export function diffBulkSchedule(
  proposed: readonly BulkDayPlan[],
  confirmed: readonly BulkDayResult[]
): readonly BulkDayDifference[] {
  const byProposedDate = new Map(proposed.map((day) => [day.date, day]));
  const byConfirmedDate = new Map(confirmed.map((day) => [day.date, day]));
  const dates = [...new Set([...byProposedDate.keys(), ...byConfirmedDate.keys()])].sort(
    compareDateOnly
  );

  const differences: BulkDayDifference[] = [];
  for (const date of dates) {
    const before = byProposedDate.get(date) ?? null;
    const after = byConfirmedDate.get(date) ?? null;
    if (before !== null && after !== null && sameOutcome(before, after)) {
      continue;
    }
    differences.push({ date, proposed: before, confirmed: after });
  }
  return differences;
}

/**
 * The message key for a failed `previewBulk` / `confirmBulk`.
 *
 * Keyed off the contract's **code**, and onto the `bulk` namespace rather than
 * the shared `errors` one. Those two catalogs say different things on purpose:
 * `errors.VALIDATION_FAILED` reads "weekend or holiday", which is true of
 * `reservation.create` and never of a bulk request, where a weekend is a
 * per-day fact inside a *successful* response (`doc/decision/0090-*`). Funnelling
 * every bulk failure through one generic sentence — or through a neighbouring
 * flow's sentence — is the defect this function exists to prevent.
 *
 * Every code either procedure declares has its own entry; anything else (a
 * transport failure, a 500, an undeclared code) falls to `errorUnknown`,
 * because none of those has copy that could honestly be more specific.
 */
export type BulkErrorMessageKey =
  | 'errorPastDate'
  | 'errorOutOfHorizon'
  | 'errorLocked'
  | 'errorValidation'
  | 'errorConflict'
  | 'errorForbidden'
  | 'errorMonthlyCapReached'
  | 'errorUnknown';

const BULK_ERROR_KEYS: Partial<Record<ErrorCode, BulkErrorMessageKey>> = {
  PAST_DATE: 'errorPastDate',
  OUT_OF_HORIZON: 'errorOutOfHorizon',
  RESERVATIONS_LOCKED: 'errorLocked',
  VALIDATION_FAILED: 'errorValidation',
  CONFLICT: 'errorConflict',
  FORBIDDEN: 'errorForbidden',
  MONTHLY_RESERVATION_LIMIT_REACHED: 'errorMonthlyCapReached',
};

export function toBulkErrorMessageKey(error: unknown): BulkErrorMessageKey {
  const contractError = toContractError(error);
  if (contractError === null) {
    return 'errorUnknown';
  }
  return BULK_ERROR_KEYS[contractError.code] ?? 'errorUnknown';
}
