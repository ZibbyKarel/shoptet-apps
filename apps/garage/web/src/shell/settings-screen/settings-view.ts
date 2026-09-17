/**
 * What the settings screen decides, as pure functions.
 *
 * The same split `lot/lot-view.ts` makes, for the same reason: a decision that
 * lives inside a component body is reachable only by rendering the component
 * and reading the DOM, while the same decision as a function has a name, a
 * type, and a spec that states it directly.
 *
 * No React, no hooks, no network.
 */

import { buildIcsFeedUrl } from '@garage/contract';
import type { ParkingSpot } from '@garage/contract';

/**
 * The calendar feed, or the reason there is nothing to link to.
 *
 * A union rather than `string | undefined` because the two inputs that can be
 * missing — the API origin (`apiOriginOf(NEXT_PUBLIC_API_URL)` could not be
 * derived) and the caller's token (the profile has not arrived, or has no
 * token) — mean the same thing on screen: the section says the link is
 * unavailable instead of drawing a broken one. {@link buildIcsFeedUrl} has
 * nothing to build from in either case.
 */
export type IcsFeedView =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly url: string };

/** The feed URL for `apiOrigin` and `token`, when both are actually there. */
export function toIcsFeedView(apiOrigin: string, token: string | undefined): IcsFeedView {
  if (apiOrigin === '' || token === undefined) {
    return { kind: 'unavailable' };
  }
  return { kind: 'ready', url: buildIcsFeedUrl(apiOrigin, token) };
}

/** The select's empty option — clearing the preferred spot is allowed. */
export const NO_PREFERRED_SPOT = '';

/**
 * Whether the form's preferred-spot id has to be reset to "Bez preference".
 *
 * Reconciles the seeded id against the *actual* set of selectable options, and
 * only once that set is actually known — not before `spot.list` has resolved,
 * and not when it failed. A `<select>` whose value has no matching `<option>`
 * (e.g. the stored id belonged to a spot an admin has since retired —
 * `spot.deactivate` never clears anyone's `preferredParkingSpotId`) falls back,
 * in the DOM, to displaying its first option — "Bez preference" here — while
 * leaving the *form's* value untouched. Save would then silently resubmit the
 * retired id nobody can see selected, and `MeService.requireSelectableSpot`
 * rejects the whole request, taking the licence-plate edit down with it (Task
 * 26 review, I1). Clearing the form value is what keeps "what's shown" and
 * "what's submitted" from ever disagreeing — treating a retired preference
 * exactly like "no preference", which is the only description of it a user who
 * cannot see it selected could possibly act on.
 *
 * **`spotsPending` and `spotsError` are the load-bearing half.** While either
 * holds, `spots` is `[]` for "not loaded" rather than "nothing to choose from",
 * and clearing on it would throw away a preference that is perfectly valid.
 * That is the failure this returns `false` for, and it is the reason the rule
 * is a named function rather than four lines inside an effect: the bad case is
 * a race, and a race is not something a render test states well.
 *
 * `lot/bulk-modal/bulk-view.ts`'s `toPreferredSpotView` treats a retired preference the
 * same way — as no preference at all — but answers a different question (which
 * sentence to print), so the two are deliberately not one function.
 */
export function shouldClearPreferredSpot(
  current: string,
  spots: readonly ParkingSpot[],
  spotsPending: boolean,
  spotsError: boolean
): boolean {
  if (spotsPending || spotsError) {
    return false;
  }
  if (current === NO_PREFERRED_SPOT) {
    return false;
  }
  return !spots.some((spot) => spot.id === current);
}
