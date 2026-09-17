/**
 * When a failed request is worth repeating.
 *
 * TanStack Query's default is three retries for everything, which is wrong for
 * this API in a way users would feel: a rejected reservation
 * (`SPOT_ALREADY_RESERVED`, 409) or a closed window (`RESERVATIONS_LOCKED`,
 * 423) is a **decision**, not a hiccup — repeating it produces the same answer
 * three times, delays the error the user needs to see, and puts three requests
 * through the throttler instead of one.
 *
 * The split is by HTTP status rather than by contract code, because it has to
 * cover failures that carry no contract code at all: an unmatched route, a
 * throttled request (`doc/decision/0033-*` — those keep Nest's shape and have
 * no `code`). Everything a 4xx says is "this request, as sent, is refused";
 * 5xx and a dropped connection are the transient cases retrying exists for.
 */

import { errorStatus } from '@garage/api-client';

/**
 * Retries **after** the initial attempt, so a query gives up after
 * `1 + MAX_QUERY_RETRIES` tries.
 *
 * TanStack passes `failureCount` zero-based (verified in
 * `query-client.spec.ts`, which asserts the exact number of requests reaching
 * the transport, not the shape of this comparison).
 */
export const MAX_QUERY_RETRIES = 2;

/**
 * The `retry` predicate every query gets by default.
 *
 * `errorStatus` returns `undefined` when the request never got a response at
 * all — a dropped connection or a DNS failure — which is exactly the case a
 * retry is for, so those fall through to the count-based limit.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = errorStatus(error);

  if (status !== undefined && status >= 400 && status < 500) {
    return false;
  }

  return failureCount < MAX_QUERY_RETRIES;
}
