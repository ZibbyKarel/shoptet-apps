/**
 * The reservation window — pure, parameterised, side-effect free.
 *
 * The algorithm is fixed by `doc/decision/0004-mvp-scope-includes-design-features.md`,
 * which in turn transcribes the `monthOpen` function from the approved visual
 * design (`doc/design/lets-park-design.dc.html`):
 *
 * ```
 * FORCE_OPEN   -> true
 * FORCE_LOCKED -> false
 * AUTO         -> first = first day of targetDate's month
 *                 from  = first - openDaysBefore days
 *                 return today >= from && today < first
 * ```
 *
 * Two consequences are load-bearing and easy to get wrong:
 *
 * 1. The window closes at the *start* of the target month, not at its end.
 *    Once a month has begun it is `LOCKED`, so a normal user can never make an
 *    ordinary reservation in the current month.
 * 2. These functions only *report* the state. They never enforce anything, and
 *    callers are expected to skip them where the lock does not apply — waitlist
 *    auto-promotion is a system action and is exempt, admins are not limited by
 *    the window at all, and cancelling one's own reservation is always allowed.
 *
 * All dates are Europe/Prague calendar days; `today` is injected (typically
 * from `todayInPrague()`) so the functions stay deterministic and testable.
 */

import { addDays, compareDateOnly, startOfMonth, type DateOnly } from './date-only';
import type { MonthLockState, ReservationLockMode } from './domain-constants';

/** Inclusive first/last day on which the window for a month is open. */
export interface ReservationWindowRange {
  /** First day the month can be booked: first day of the month − `openDaysBefore`. */
  readonly from: DateOnly;
  /** Last day the month can be booked: the day before the month starts. */
  readonly to: DateOnly;
}

/**
 * The inclusive date range during which `targetDate`'s month can be booked
 * under `AUTO`. Independent of `today` and of the lock mode — the two override
 * modes ignore the range entirely.
 */
export function reservationWindowRange(
  targetDate: DateOnly,
  openDaysBefore: number
): ReservationWindowRange {
  const first = startOfMonth(targetDate);
  return {
    from: addDays(first, -openDaysBefore),
    to: addDays(first, -1),
  };
}

/**
 * Whether the month containing `targetDate` is currently open for reservations.
 *
 * @param targetDate      the day the user wants to reserve
 * @param openDaysBefore  how many days before the first of the month the window opens
 * @param lockMode        admin override
 * @param today           today's calendar day in Europe/Prague
 */
export function isMonthOpen(
  targetDate: DateOnly,
  openDaysBefore: number,
  lockMode: ReservationLockMode,
  today: DateOnly
): boolean {
  return monthLockState(targetDate, openDaysBefore, lockMode, today) === 'OPEN';
}

/**
 * Which of the three displayed states the month containing `targetDate` is in.
 *
 * The two "window" error codes of the contract map straight onto this:
 * `NOT_YET_OPEN` → `OUT_OF_HORIZON`, `LOCKED` → `RESERVATIONS_LOCKED`. Both are
 * raised by the service layer (Task 13), never by a schema.
 */
export function monthLockState(
  targetDate: DateOnly,
  openDaysBefore: number,
  lockMode: ReservationLockMode,
  today: DateOnly
): MonthLockState {
  if (lockMode === 'FORCE_OPEN') {
    return 'OPEN';
  }
  if (lockMode === 'FORCE_LOCKED') {
    return 'LOCKED';
  }

  const first = startOfMonth(targetDate);
  const { from } = reservationWindowRange(targetDate, openDaysBefore);

  if (compareDateOnly(today, from) < 0) {
    return 'NOT_YET_OPEN';
  }
  if (compareDateOnly(today, first) >= 0) {
    return 'LOCKED';
  }
  return 'OPEN';
}
