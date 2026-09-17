/**
 * What `createApiClient` actually puts on the wire.
 *
 * These tests import **only** `../index` — the wrapper's public entry point —
 * and never `@orpc/client`. That is the point of the lib (`doc/wrappers.md`),
 * and the last test in this file reads this file's own source to prove it,
 * rather than trusting that nobody adds the import later.
 */

import { readFileSync } from 'node:fs';
import type { CreateReservationOutput } from '@garage/contract';
import { createApiClient } from '../index';
import { rpcPayload, stubTransport } from '../__fixtures__/stub-transport';

const URL_BASE = 'https://api.test/rpc';

const RESERVATION: CreateReservationOutput = {
  id: '11111111-1111-4111-8111-111111111111',
  parkingSpotId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  guestName: null,
  licensePlate: null,
  date: '2026-09-15',
  createdAt: '2026-08-28T09:15:00.000Z',
};

describe('createApiClient', () => {
  it('delegates a contract procedure to its RPC path, method and payload', async () => {
    const transport = stubTransport(() => ({ status: 200, body: rpcPayload(RESERVATION) }));
    const client = createApiClient({ url: URL_BASE, fetch: transport.fetch });

    const result = await client.reservation.create({
      parkingSpotId: RESERVATION.parkingSpotId,
      date: RESERVATION.date,
    });

    expect(transport.requests).toHaveLength(1);
    const request = transport.requests[0];
    expect(request?.url).toBe('https://api.test/rpc/reservation/create');
    expect(request?.method).toBe('POST');
    expect(JSON.parse(await (request as Request).text())).toEqual({
      json: { parkingSpotId: RESERVATION.parkingSpotId, date: RESERVATION.date },
    });
    expect(result).toEqual(RESERVATION);
  });

  it('routes a nested admin procedure to the same path the contract nests it under', async () => {
    const transport = stubTransport(() => ({ status: 200, body: rpcPayload([]) }));
    const client = createApiClient({ url: URL_BASE, fetch: transport.fetch });

    await client.admin.spot.list({});

    expect(transport.requests[0]?.url).toBe('https://api.test/rpc/admin/spot/list');
  });

  it('returns the procedure output typed from the contract', async () => {
    const transport = stubTransport(() => ({ status: 200, body: rpcPayload(RESERVATION) }));
    const client = createApiClient({ url: URL_BASE, fetch: transport.fetch });

    // The annotation is the assertion: `create` is typed from the contract's
    // output schema, so this line stops compiling if that link ever breaks.
    const reservation: CreateReservationOutput = await client.reservation.create({
      parkingSpotId: RESERVATION.parkingSpotId,
      date: RESERVATION.date,
    });

    expect(reservation.date).toBe('2026-09-15');
  });

  describe('the Authorization header', () => {
    it('carries the bearer token the provider returns', async () => {
      const transport = stubTransport(() => ({ status: 200, body: rpcPayload(null) }));
      const client = createApiClient({
        url: URL_BASE,
        getAccessToken: () => 'token-abc',
        fetch: transport.fetch,
      });

      await client.me.get({});

      expect(transport.requests[0]?.headers.get('authorization')).toBe('Bearer token-abc');
    });

    it('accepts an asynchronous provider', async () => {
      const transport = stubTransport(() => ({ status: 200, body: rpcPayload(null) }));
      const client = createApiClient({
        url: URL_BASE,
        getAccessToken: async () => 'token-async',
        fetch: transport.fetch,
      });

      await client.me.get({});

      expect(transport.requests[0]?.headers.get('authorization')).toBe('Bearer token-async');
    });

    it.each([
      ['no provider at all', undefined],
      ['a provider returning null', () => null],
      ['a provider returning undefined', () => undefined],
      ['a provider returning an empty string', () => ''],
    ])('is omitted entirely with %s', async (_label, getAccessToken) => {
      const transport = stubTransport(() => ({ status: 200, body: rpcPayload(null) }));
      const client = createApiClient({
        url: URL_BASE,
        fetch: transport.fetch,
        ...(getAccessToken === undefined ? {} : { getAccessToken }),
      });

      await client.me.get({});

      // Not `Bearer undefined`, not `Bearer ` — absent.
      expect(transport.requests[0]?.headers.get('authorization')).toBeNull();
    });

    it('re-reads the token on every request, so a refresh is picked up', async () => {
      const transport = stubTransport(() => ({ status: 200, body: rpcPayload(null) }));
      const tokens = ['first', 'second'];
      let call = 0;
      const client = createApiClient({
        url: URL_BASE,
        getAccessToken: () => tokens[call++],
        fetch: transport.fetch,
      });

      await client.me.get({});
      await client.me.get({});

      expect(transport.requests.map((request) => request.headers.get('authorization'))).toEqual([
        'Bearer first',
        'Bearer second',
      ]);
    });
  });

  it('is usable without importing @orpc/client anywhere in this file', () => {
    // The wrapper exists so application code never names the wrapped package
    // (`doc/wrappers.md`). Every test above is real application-shaped usage;
    // this one pins that none of it needed the banned import — a claim that
    // would otherwise quietly stop being true the first time someone reaches
    // for an oRPC type here.
    //
    // **It demonstrates that the wrapper's API is *sufficient*; it is not the
    // defence against the ban being broken.** This file sits in the lib that
    // owns `@orpc/client`, where the import is legal — ESLint would not object
    // to it here. The ban is `no-restricted-imports` in `eslint.config.mjs`
    // (`WRAPPED_LIBRARIES`), verified separately by linting `apps/**`. Deleting
    // that rule would leave this test green.
    const source = readFileSync(__filename, 'utf8');

    expect(source).not.toMatch(/from\s+['"]@orpc\//);
    expect(source).not.toMatch(/require\(\s*['"]@orpc\//);
  });
});
