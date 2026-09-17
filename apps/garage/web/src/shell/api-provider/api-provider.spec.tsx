import { render } from '@testing-library/react';
import { createApiClient } from '@garage/api-client';
import { ApiProvider } from './api-provider';

/**
 * The wiring test the browser had to find the hard way: `ApiProvider` must hand
 * `createApiClient` the URL **`apiRpcUrl` derived**, not the one it was
 * configured with. `api-url.spec.ts` proves the derivation; this proves the
 * provider uses it. Between them, the defect that made every request 404 in the
 * first live run cannot come back silently.
 *
 * `createApiClient` is stubbed at the seam — the **wrapper**, `@garage/api-client`,
 * never `@orpc/client`, which `apps/garage/web` may not import at all. The session is
 * stubbed the same way, through `@garage/auth/client`: a real one would need
 * a running Auth.js, which is a different test (and one only a browser can run).
 *
 * What is *not* asserted here is that the URL is the right one in absolute
 * terms. Only a real server can answer that, and it did: `POST /api/me/get`
 * 404s and `POST /api/rpc/me/get` 401s. See `api-url.ts`.
 */

jest.mock('@garage/api-client', () => ({
  createApiClient: jest.fn(() => ({ marker: 'client' })),
  createApiQueryUtils: jest.fn((client: unknown) => ({ marker: 'utils', client })),
}));

jest.mock('@garage/auth/client', () => ({
  useAccessTokenProvider: () => mockGetAccessToken,
}));

const mockGetAccessToken = async () => 'irrelevant';

const createApiClientMock = jest.mocked(createApiClient);

/** The options the provider handed `createApiClient` on its last render. */
function lastOptions() {
  const call = createApiClientMock.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('createApiClient was never called');
  }
  return call[0];
}

describe('ApiProvider', () => {
  beforeEach(() => {
    createApiClientMock.mockClear();
  });

  it('builds the client against the RPC base, not the configured API URL', () => {
    render(
      <ApiProvider url="http://localhost:3000/api">
        <span />
      </ApiProvider>
    );

    expect(createApiClientMock).toHaveBeenCalledTimes(1);
    expect(lastOptions()).toMatchObject({
      url: 'http://localhost:3000/api/rpc',
    });
  });

  it('derives the base however deep the configured prefix is', () => {
    render(
      <ApiProvider url="https://parking.example.com/backend/api/">
        <span />
      </ApiProvider>
    );

    expect(lastOptions()).toMatchObject({
      url: 'https://parking.example.com/backend/api/rpc',
    });
  });

  it('hands the client the session-backed token provider', () => {
    render(
      <ApiProvider url="http://localhost:3000/api">
        <span />
      </ApiProvider>
    );

    expect(lastOptions()).toMatchObject({
      getAccessToken: mockGetAccessToken,
    });
  });
});
