/**
 * The contract-derived query utilities: keys, not delegation through a live
 * `QueryClient`.
 *
 * Query keys are the thing nobody notices is wrong until a cache entry quietly
 * fails to invalidate, so these tests check the properties that matter — the
 * same input yields the same key, a different input does not. The
 * key-*invalidates-through-a-real-cache* tests live in
 * `apps/garage/web/src/shell/query/query-client.spec.ts` instead: they construct a
 * real `QueryClient`, and mixing that with `@orpc/tanstack-query`'s
 * `queryOptions()` output under this project's `"module": "commonjs"`
 * reproduces the dual-package hazard `doc/decision/0038-*` found for
 * `libs/query` (two structurally identical but nominally distinct
 * `QueryClient` types). `apps/garage/web` already resolves this correctly
 * (`module: esnext`), this project does not need to.
 */

import { createApiQueryUtils } from './api-query';
import { stubApi } from '../__fixtures__/stub-api';

const DAY = { date: '2026-09-15' };
const OTHER_DAY = { date: '2026-09-16' };

const DAY_OVERVIEW = {
  date: DAY.date,
  window: null,
  canReserve: true,
  spots: [],
  myReservation: null,
};

function utilsWith(body: unknown = DAY_OVERVIEW) {
  const api = stubApi(() => ({ status: 200, body: rpcPayload(body) }));
  return { api, utils: createApiQueryUtils(api.client) };
}

function rpcPayload(value: unknown): { json: unknown; meta: [] } {
  return { json: value, meta: [] };
}

describe('createApiQueryUtils keys', () => {
  it('is stable for the same procedure and input', () => {
    const { utils } = utilsWith();

    expect(utils.overview.day.queryKey({ input: DAY })).toEqual(
      utils.overview.day.queryKey({ input: DAY })
    );
  });

  it('is stable across two separately built util trees', () => {
    // The key must depend on the contract path and the input, never on the
    // client instance — otherwise a second `createApiQueryUtils` (SSR vs.
    // browser, or a re-render) would miss the cache entry the first one wrote.
    expect(utilsWith().utils.overview.day.queryKey({ input: DAY })).toEqual(
      utilsWith().utils.overview.day.queryKey({ input: DAY })
    );
  });

  it('differs for a different input', () => {
    const { utils } = utilsWith();

    expect(utils.overview.day.queryKey({ input: DAY })).not.toEqual(
      utils.overview.day.queryKey({ input: OTHER_DAY })
    );
  });

  it('differs between two procedures', () => {
    const { utils } = utilsWith();

    expect(utils.overview.day.queryKey({ input: DAY })).not.toEqual(
      utils.spot.list.queryKey({ input: {} })
    );
  });

  it('starts with the procedure path from the contract router', () => {
    const { utils } = utilsWith();
    const [path] = utils.overview.day.queryKey({ input: DAY });

    expect(path).toEqual(['overview', 'day']);
  });
});

describe('createApiQueryUtils delegation', () => {
  it('sends the query through the contract procedure it was built from', async () => {
    const { api, utils } = utilsWith();

    const result = await utils.overview.day.call(DAY);

    expect(api.requests[0]?.url).toBe('https://api.test/rpc/overview/day');
    expect(JSON.parse(await (api.requests[0] as Request).text())).toEqual({ json: DAY });
    expect(result).toEqual(DAY_OVERVIEW);
  });

  it('exposes the plain client call on the same node', async () => {
    const { api, utils } = utilsWith();

    await utils.overview.day.call(DAY);

    expect(api.requests[0]?.url).toBe('https://api.test/rpc/overview/day');
  });
});
