/**
 * What the admin month-window banner says, as a pure function.
 *
 * The same split `lot/lot-view.ts` makes for its own banner (`toBannerView`),
 * for the same reason: the rule that decides the sentence is a correctness
 * rule, and inside a component body it can only be exercised by rendering and
 * reading the DOM. Here it has a name, a type and a spec that states it.
 *
 * **This is deliberately not `toBannerView`.** The two banners answer the same
 * kind of question and cannot share an answer: they draw from different
 * message namespaces (`admin` vs `lot`) with different key sets, this one has a
 * third tone (`neutral`) and a glyph that the lot banner has no room for, and
 * `toBannerView` additionally varies on `isAdmin` and names the month without
 * its year. Decisions 0121/0122 fix the lot-side wording. Pattern consistency,
 * not de-duplication.
 *
 * No React, no hooks, no network.
 */

import type { MonthWindowOverview } from '@garage/contract';
import { startOfYearMonth } from '@garage/i18n';
import type { DateFormatters, MonthLockState } from '@garage/i18n';

/**
 * Colour per state for the **banner**, matching `06-admin-overview.png`'s green
 * band for an open month. Exported for the same reason as
 * `BADGE_STATE_TONE` in `../admin-window-screen/admin-window-screen.tsx`: it is signal, not
 * decoration.
 *
 * The two maps hold the same three values today and are still two maps, named
 * apart so a reader in this folder can tell which is which. They answer to
 * different design artifacts — this one to the overview banner, that one to
 * the month pills of `05-admin-window.png` — and each is pinned against its
 * artifact's colours in its own spec. Merging them would collapse two
 * assertions into one and make a redesign of either surface silently repaint
 * the other.
 */
export const BANNER_STATE_TONE: Record<MonthLockState, AdminBannerTone> = {
  OPEN: 'success',
  LOCKED: 'warning',
  NOT_YET_OPEN: 'neutral',
};

/**
 * The glyph in the design's coloured chip, one per state. `aria-hidden` on
 * `Toast`, so it is decoration — but decoration that says "open" or "locked" to
 * anyone scanning, which is why it is exported and pinned alongside the tone.
 */
export const STATE_GLYPH: Record<MonthLockState, string> = {
  OPEN: '✓',
  LOCKED: '🔒',
  NOT_YET_OPEN: '…',
};

/**
 * Named here rather than imported as `ToastTone`, so this module names no
 * design-system component: the banner picks the primitive, the rule picks the
 * meaning. The three values are `ToastTone`'s, and the banner's `tone` prop is
 * what type-checks that they still are.
 */
type AdminBannerTone = 'success' | 'warning' | 'neutral';

/**
 * Which `admin` message the banner renders.
 *
 * Module-private, with the tone and the view record: the banner infers the
 * whole thing from the call and writes none of them down. `lot-view.ts`
 * exports its `BannerView` because `lot-header.tsx` takes one as a prop.
 */
type AdminBannerMessageKey =
  | 'bannerOpenAuto'
  | 'bannerOpenForced'
  | 'bannerLockedAuto'
  | 'bannerLockedForced'
  | 'bannerNotYetOpenAuto'
  | 'bannerNotYetOpenForced';

interface AdminWindowBannerView {
  readonly tone: AdminBannerTone;
  readonly glyph: string;
  readonly messageKey: AdminBannerMessageKey;
  /**
   * All three are always populated, so the message key can vary without the
   * call site having to vary its argument shape — the shape `lot-view.ts`'s
   * `BannerView` uses. `until` and `from` are the empty string for the keys
   * that do not interpolate them.
   */
  readonly values: { readonly month: string; readonly until: string; readonly from: string };
}

/**
 * The one sentence about a month's reservation window, and how to paint it.
 *
 * ## Why six sentences and not three
 *
 * `MonthWindowOverview` carries a `state` **and** a `lockMode`, and the two
 * together decide what may honestly be said. `windowFrom`/`windowTo` are always
 * the range the AUTO rule *would* produce; when an admin has forced the state
 * they describe a hypothetical, not a fact
 * (`libs/garage/contract/src/schemas/reservation-window.ts`). So each of the three
 * states gets a pair: the AUTO wording, which names a date, and the forced
 * wording, which says an admin decided and names none.
 *
 * Reading a date out of the forced case would put a sentence on screen that is
 * simply untrue — "reservations close on 31 August" while the mode says they
 * are open indefinitely — which is the failure this split exists to prevent.
 * That is why `until` and `from` are blanked under a forced mode here, rather
 * than being left for each branch to remember not to interpolate.
 */
export function toAdminWindowBannerView(
  window: MonthWindowOverview,
  /** Passed in rather than imported: this module is not a component and the locale is not global. */
  formatters: DateFormatters
): AdminWindowBannerView {
  const isAuto = window.lockMode === 'AUTO';
  const values = {
    month: formatters.monthAndYear(startOfYearMonth(window.month)),
    until: isAuto ? formatters.dayAndMonth(window.windowTo) : '',
    from: isAuto ? formatters.dayAndMonth(window.windowFrom) : '',
  };
  const paint = { tone: BANNER_STATE_TONE[window.state], glyph: STATE_GLYPH[window.state] };

  switch (window.state) {
    case 'OPEN':
      return { ...paint, messageKey: isAuto ? 'bannerOpenAuto' : 'bannerOpenForced', values };
    case 'LOCKED':
      return { ...paint, messageKey: isAuto ? 'bannerLockedAuto' : 'bannerLockedForced', values };
    case 'NOT_YET_OPEN':
      return {
        ...paint,
        messageKey: isAuto ? 'bannerNotYetOpenAuto' : 'bannerNotYetOpenForced',
        values,
      };
  }
}
