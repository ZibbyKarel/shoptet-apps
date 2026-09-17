/**
 * The seam between the session and the transports.
 *
 * The second half of this file drives a **real** `createApiClient` from
 * `@garage/api-client` and reads the `Authorization` header off the request
 * it produced. That is the claim worth exercising: not "the provider returns a
 * string" but "the string ends up on the wire, and does not when the session
 * says it must not".
 */

import type { Session } from 'next-auth';
import { createApiClient } from '@garage/api-client';
import type { ApiFetch } from '@garage/api-client';
import { accessTokenOf, createAccessTokenProvider } from './access-token';
import { REFRESH_TOKEN_ERROR } from './session';
import { rpcPayload } from '../__fixtures__/stub-fetch';

const API_URL = 'https://api.test/rpc';

const SIGNED_IN: Session = {
  user: { email: 'a@b.test' },
  expires: '2099-01-01T00:00:00.000Z',
  accessToken: 'okta-access-token',
};

/** Records the requests the oRPC link builds and answers with an empty payload. */
function recordingTransport() {
  const requests: Request[] = [];
  const fetch: ApiFetch = async (request) => {
    requests.push(request.clone());
    return new Response(JSON.stringify(rpcPayload(null)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { requests, fetch };
}

describe('accessTokenOf', () => {
  it('reads the token off a healthy session', () => {
    expect(accessTokenOf(SIGNED_IN)).toBe('okta-access-token');
  });

  it('returns null when there is no session', () => {
    expect(accessTokenOf(null)).toBeNull();
    expect(accessTokenOf(undefined)).toBeNull();
  });

  it('returns null when the session carries no token', () => {
    const { accessToken: _accessToken, ...withoutToken } = SIGNED_IN;

    expect(accessTokenOf(withoutToken)).toBeNull();
  });

  it('returns null — not the stale token — after a failed refresh', () => {
    expect(accessTokenOf({ ...SIGNED_IN, error: REFRESH_TOKEN_ERROR })).toBeNull();
  });
});

describe('createAccessTokenProvider', () => {
  it('re-reads the session on every call, so a renewal is picked up', async () => {
    const sessions: (Session | null)[] = [
      SIGNED_IN,
      { ...SIGNED_IN, accessToken: 'renewed-token' },
    ];
    let call = 0;
    const getAccessToken = createAccessTokenProvider(async () => sessions[call++] ?? null);

    await expect(getAccessToken()).resolves.toBe('okta-access-token');
    await expect(getAccessToken()).resolves.toBe('renewed-token');
  });
});

describe('wired into @garage/api-client', () => {
  it('puts the session token in the Authorization header', async () => {
    const transport = recordingTransport();
    const client = createApiClient({
      url: API_URL,
      getAccessToken: createAccessTokenProvider(async () => SIGNED_IN),
      fetch: transport.fetch,
    });

    await client.me.get({});

    expect(transport.requests[0]?.headers.get('authorization')).toBe('Bearer okta-access-token');
  });

  it('sends no Authorization header at all when there is no session', async () => {
    const transport = recordingTransport();
    const client = createApiClient({
      url: API_URL,
      getAccessToken: createAccessTokenProvider(async () => null),
      fetch: transport.fetch,
    });

    await client.me.get({});

    // Not `Bearer null`, not `Bearer ` — absent, which the API reads as
    // unauthenticated.
    expect(transport.requests[0]?.headers.get('authorization')).toBeNull();
  });

  it('stops sending the old token once a refresh has failed', async () => {
    const transport = recordingTransport();
    const sessions: Session[] = [SIGNED_IN, { ...SIGNED_IN, error: REFRESH_TOKEN_ERROR }];
    let call = 0;
    const client = createApiClient({
      url: API_URL,
      getAccessToken: createAccessTokenProvider(async () => sessions[call++] ?? null),
      fetch: transport.fetch,
    });

    await client.me.get({});
    await client.me.get({});

    expect(transport.requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer okta-access-token',
      null,
    ]);
  });
});
