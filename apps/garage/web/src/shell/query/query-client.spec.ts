/**
 * The `QueryClient` policy and the query-key bridge, exercised together.
 *
 * Every retry test here counts the requests that reached the transport, so
 * what is verified is what a real `QueryClient` did with a real error from a
 * real `RPCLink` — not what `shouldRetryQuery` returns when handed a
 * hand-built object. The two invalidation tests at the end construct a real
 * client and a real `createApiQueryUtils` tree together on purpose — that
 * combination is exactly what used to trip the dual-package hazard under
 * `libs/shared/api-client`'s `"module": "commonjs"` (`doc/decision/0038-*`); this
 * file lives in `apps/garage/web`, whose `tsconfig.json` already resolves both
 * packages through `esnext`, so it does not need the same workaround.
 */

import type { QueryClient } from '@tanstack/react-query';
import { ERROR_CODES, ERROR_DEFINITIONS } from '@garage/contract';
import { createApiQueryUtils } from '@garage/api-client';
import { createQueryClient, DEFAULT_GC_TIME_MS, DEFAULT_STALE_TIME_MS } from './query-client';
import { MAX_QUERY_RETRIES } from './retry';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  transportErrorResponse,
  unreachableApi,
} from '../../testing/stub-api';
import type { StubbedApi, StubbedResponse } from '../../testing/stub-api';

/**
 * A client with the shipped defaults, minus the wait between retries.
 *
 * Only `retryDelay` is overridden — `retry` stays the function under test.
 * That the rest of the defaults survive this call is itself asserted below.
 */
function testQueryClient(): QueryClient {
  return createQueryClient({ defaultOptions: { queries: { retryDelay: () => 0 } } });
}

/**
 * Runs one query to completion (success or failure) and reports the attempts.
 *
 * `client.query()`, not `fetchQuery()`: the latter is deprecated in v5 and is
 * removed in v6 (`@deprecated Use queryClient.query(options) instead` in
 * `@tanstack/query-core`'s own declarations).
 */
async function attemptsFor(api: StubbedApi): Promise<number> {
  await runDayOverview(api, testQueryClient());

  return api.requests.length;
}

/** Fetches the day overview through a client, swallowing the failure. */
async function runDayOverview(api: StubbedApi, client: QueryClient): Promise<void> {
  const utils = createApiQueryUtils(api.client);

  await client
    .query(utils.overview.day.queryOptions({ input: { date: '2026-09-15' } }))
    .catch(() => undefined);
}

function alwaysRespond(response: StubbedResponse): StubbedApi {
  return stubApi(() => response);
}

describe('createQueryClient defaults', () => {
  it('applies the project-wide caching policy', () => {
    const queries = testQueryClient().getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(queries?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    // The retry function survived the `retryDelay` override — the merge is one
    // level deep, so a caller cannot silently drop the rest of the defaults.
    expect(typeof queries?.retry).toBe('function');
  });

  it('does not retry mutations', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('lets a caller override a single default without losing the others', () => {
    const queries = createQueryClient({
      defaultOptions: { queries: { staleTime: 1 } },
    }).getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(1);
    expect(queries?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });
});

describe('query retry', () => {
  it('does not repeat a 4xx domain error', async () => {
    const api = alwaysRespond(contractErrorResponse('SPOT_ALREADY_RESERVED'));

    expect(await attemptsFor(api)).toBe(1);
  });

  it('does not repeat RESERVATIONS_LOCKED, whose status is 423', async () => {
    // 423 is inside the 4xx band but outside the statuses people think of as
    // "client errors"; it is the one most likely to be dropped by a later edit.
    expect(ERROR_DEFINITIONS.RESERVATIONS_LOCKED.status).toBe(423);

    const api = alwaysRespond(contractErrorResponse('RESERVATIONS_LOCKED'));

    expect(await attemptsFor(api)).toBe(1);
  });

  it.each(ERROR_CODES)('does not repeat %s', async (code) => {
    // Every domain error is a decision, not a hiccup — none of the twelve is
    // worth asking again. Guards a future code whose status falls outside 4xx.
    const api = alwaysRespond(contractErrorResponse(code));

    expect(await attemptsFor(api)).toBe(1);
  });

  it('does not repeat a throttled request, which carries no contract code', async () => {
    const api = alwaysRespond(transportErrorResponse(429, 'ThrottlerException: Too Many Requests'));

    expect(await attemptsFor(api)).toBe(1);
  });

  it('repeats a 5xx up to the configured limit', async () => {
    const api = alwaysRespond(transportErrorResponse(500, 'Internal server error'));

    expect(await attemptsFor(api)).toBe(1 + MAX_QUERY_RETRIES);
  });

  it('repeats a request that never reached a server', async () => {
    const api = unreachableApi();

    await runDayOverview(api, testQueryClient());

    expect(api.requests).toHaveLength(1 + MAX_QUERY_RETRIES);
  });

  it('stops repeating as soon as a retry succeeds', async () => {
    const api = stubApi((callIndex) =>
      callIndex === 0
        ? transportErrorResponse(503, 'Service unavailable')
        : { status: 200, body: rpcPayload({ ok: true }) }
    );

    await runDayOverview(api, testQueryClient());

    expect(api.requests).toHaveLength(2);
  });
});

describe('createApiQueryUtils keys, through a real cache', () => {
  it('lets a branch key invalidate its leaves', async () => {
    const api = alwaysRespond({ status: 200, body: rpcPayload({ ok: true }) });
    const utils = createApiQueryUtils(api.client);
    const client = testQueryClient();
    const options = utils.overview.day.queryOptions({ input: { date: '2026-09-15' } });

    await client.query(options);
    expect(api.requests).toHaveLength(1);

    // Partial match on the branch — this is how a feature invalidates
    // "everything about the day overview" without naming each input.
    await client.invalidateQueries({ queryKey: utils.overview.key() });
    await client.query(options);

    expect(api.requests).toHaveLength(2);
  });

  it('does not let an unrelated branch key invalidate them', async () => {
    const api = alwaysRespond({ status: 200, body: rpcPayload({ ok: true }) });
    const utils = createApiQueryUtils(api.client);
    const client = testQueryClient();
    const options = utils.overview.day.queryOptions({ input: { date: '2026-09-15' } });

    await client.query(options);
    await client.invalidateQueries({ queryKey: utils.admin.key() });
    await client.query(options);

    // Still fresh (`staleTime`), so the second fetch is served from cache.
    expect(api.requests).toHaveLength(1);
  });
});
