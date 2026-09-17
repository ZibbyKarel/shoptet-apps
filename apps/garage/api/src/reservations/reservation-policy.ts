/**
 * Day eligibility: may **this** caller write **this** day at all?
 *
 * One place, because the alternative is four. `reservation.create`,
 * `waitlist.join` and `waitlist.leave` each need a different subset of the same
 * three rules, and a rule spelled out three times is a rule that will be spelled
 * out differently three times.
 *
 * Nothing here decides whether a month is open — that is `monthLockState()` in
 * `@garage/shared-types`, and it is never re-implemented (the same rule
 * `DayOverviewService.canReserve` follows). This class only decides *which*
 * rules apply to which caller, and which contract error each failure is.
 *
 * ## The window ruling, in one place
 *
 * `doc/decision/0004-*` (ruling window-1), restated by the Task 13 brief:
 *
 * | action | window applies? |
 * | --- | --- |
 * | create a reservation | yes, for a normal user |
 * | join the waitlist | yes, for a normal user |
 * | leave the waitlist | yes, for a normal user — leaving reshuffles the queue behind you |
 * | **cancel your own reservation** | **never** — a closed window stops people taking spots, not giving them back |
 * | anything, as an admin | never — admins are not restricted by the window |
 * | auto-promotion | never — a system action, and the one that makes a locked month still work |
 * | **name a holder other than yourself** | admin only |
 *
 * The last two rows are why this is enforced in the service and not in a schema:
 * a schema cannot see who is calling.
 *
 * ## Why a non-business day is `VALIDATION_FAILED`
 *
 * The lot is a workplace car park, so a Saturday or a Czech public holiday is
 * not bookable — `DayOverviewService.canReserve` already reports `false` for
 * one, and a backend that then accepted the write would be contradicting its own
 * screen. `ERROR_CODES` has no `NOT_A_BUSINESS_DAY` member, and adding one would
 * have widened a closed contract enum shared by every task. It did not need to
 * be: Task 17 already shipped the Czech copy for `VALIDATION_FAILED` as
 * *"Požadavek porušuje pravidlo rezervací (např. víkend nebo svátek)"* — the
 * weekend case is literally the example it names. See `doc/decision/0064-*`.
 */

import { Injectable } from '@nestjs/common';
import type { ReservationHolderInput, ReservationWindowSettings } from '@garage/contract';
import type { DateOnly } from '@garage/shared-types';
import { compareDateOnly, isBusinessDay, monthLockState } from '@garage/shared-types';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { DomainError } from '../common/errors/domain-error';

@Injectable()
export class ReservationPolicy {
  /**
   * Everything a normal user must satisfy to **take** something on a day:
   * create a reservation, or queue for one.
   *
   * Ordered cheapest-first, and the order is also the order of specificity — a
   * Saturday in a locked month is reported as the Saturday, which is the fact
   * that will still be true next month.
   */
  assertMayTakeDay(
    date: DateOnly,
    actor: AuthenticatedUser,
    settings: ReservationWindowSettings,
    today: DateOnly
  ): void {
    this.assertNotInThePast(date, today);
    this.assertBusinessDay(date);
    this.assertWindowOpen(date, actor, settings, today);
  }

  /**
   * A day that has already gone. Nobody may book it, **admin included**: the
   * window exemption is about which future months are open, not about rewriting
   * the past.
   */
  assertNotInThePast(date: DateOnly, today: DateOnly): void {
    if (compareDateOnly(date, today) < 0) {
      throw new DomainError('PAST_DATE', {
        message: 'That day has already passed in Europe/Prague.',
        details: { date, today },
      });
    }
  }

  /** A weekend or a Czech public holiday. See the class comment for the code. */
  assertBusinessDay(date: DateOnly): void {
    if (!isBusinessDay(date)) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'The parking lot is only bookable on business days.',
        details: { date, reason: 'NOT_A_BUSINESS_DAY' },
      });
    }
  }

  /**
   * The reservation window, for callers it applies to.
   *
   * The two states map onto the two contract codes the schemas already declare,
   * and they are kept distinct because the user-facing explanation differs:
   * `NOT_YET_OPEN` is "not yet", `LOCKED` is "no longer".
   */
  assertWindowOpen(
    date: DateOnly,
    actor: AuthenticatedUser,
    settings: ReservationWindowSettings,
    today: DateOnly
  ): void {
    if (actor.role === 'ADMIN') {
      return;
    }

    const state = monthLockState(date, settings.openDaysBefore, settings.lockMode, today);
    if (state === 'NOT_YET_OPEN') {
      throw new DomainError('OUT_OF_HORIZON', {
        message: 'Reservations for that month have not opened yet.',
        details: { date, state },
      });
    }
    if (state === 'LOCKED') {
      throw new DomainError('RESERVATIONS_LOCKED', {
        message: 'The reservation window for that month is closed.',
        details: { date, state },
      });
    }
  }

  /**
   * May **this** caller book on **that** holder's behalf?
   *
   * The security boundary of TODO item 3, and the reason the holder is not just
   * a schema field: a schema cannot see who is calling. An omitted holder is
   * always allowed — it means "the caller, for themselves", which is what this
   * procedure has always done.
   *
   * A normal user naming *themselves* is allowed, plate override included: it is
   * the same reservation they would get by omitting the holder. Naming anybody
   * else, or a guest, is `FORBIDDEN`.
   *
   * Deliberately its own named step rather than a branch inside
   * `ReservationsService.create`: TODO items 4 and 5 each add a rule to that same
   * path, and a guard that slots in beside this one conflicts textually rather
   * than semantically.
   */
  assertMayNameHolder(holder: ReservationHolderInput | undefined, actor: AuthenticatedUser): void {
    if (holder === undefined) {
      return;
    }
    if (actor.role === 'ADMIN') {
      return;
    }
    if (holder.kind === 'USER' && holder.userId === actor.id) {
      return;
    }

    throw new DomainError('FORBIDDEN', {
      message: 'Only an admin may reserve on behalf of another user or a guest.',
      details: { holderKind: holder.kind },
    });
  }

  /**
   * May **this** caller queue somebody else for a spot's waitlist?
   *
   * Mirrors `assertMayNameHolder`, minus the guest branch:
   * `WaitlistEntry.userId` is non-nullable, so there is nobody to queue but an
   * active user — `holderId` is a bare id, never a union. An omitted
   * `holderId` is always allowed, and it means "the caller, for themselves".
   * A caller naming *themselves* by id is allowed too, for the same reason a
   * normal user naming themselves as a reservation holder is: it is the same
   * queue entry they would get by omitting `holderId`. Naming anybody else is
   * `FORBIDDEN` unless the caller is an admin.
   *
   * Its own named method rather than a branch inside `assertMayNameHolder`:
   * the two guard different input shapes (a holder union vs. a bare id) for
   * different procedures, and a shared method would need to take the union of
   * both signatures for no callers that exist.
   */
  assertMayNameWaitlistTarget(holderId: string | undefined, actor: AuthenticatedUser): void {
    if (holderId === undefined || holderId === actor.id) {
      return;
    }
    if (actor.role === 'ADMIN') {
      return;
    }

    throw new DomainError('FORBIDDEN', {
      message: 'Only an admin may add somebody else to a queue.',
    });
  }
}
