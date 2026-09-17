import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { createQueryClient } from '../../shell/query/query-client';
import { createProviderWrapper } from '../../testing/providers';
import AppLayout from './layout';

/**
 * The claim this file exists to hold: **every** signed-in route recovers from
 * a session that ends while the tab is open.
 *
 * The layout's own header used to assert that `useRequireAuth` "catches the
 * session that ends while the tab is open". It did not — the hook was called
 * only by the settings page and the four admin panels, and never on `/`, so a
 * session that ended under an open parking overview left the user on a
 * permanent "Načítá se…" (both of that screen's queries are gated on
 * `status === 'authenticated'`, and a disabled TanStack query never leaves
 * `pending`). Nothing in 537 tests noticed, because nothing asked.
 *
 * So the subject here is the *route composition*, not a component: this file
 * renders the real `AppLayout`, which renders the real `AppTopBar`, which
 * calls the real `useRequireAuth` from `libs/garage/auth`. The only thing doubled is
 * `next-auth/react` itself — the third party underneath the wrapper — so that
 * a session state can be dictated and the redirect it provokes observed. Every
 * line of the guard being tested is the shipped one; mocking
 * `@garage/auth/client` instead would have reduced this to asserting that a
 * mock was called, which is the defect class this review round exists to
 * remove.
 *
 * `next/navigation` is doubled because `useRouter` throws outside an App
 * Router runtime, and `@garage/api-client` because `ApiProvider` would
 * otherwise want a live transport. Neither is under test.
 */

const REFRESH_TOKEN_ERROR = 'RefreshTokenError';

interface MockSession {
  readonly user?: { readonly name?: string; readonly email?: string };
  readonly expires?: string;
  readonly accessToken?: string;
  readonly error?: string;
}

let sessionData: MockSession | null = null;
let sessionStatus: 'authenticated' | 'loading' | 'unauthenticated' = 'authenticated';

function mockCurrentSession() {
  return { data: sessionData, status: sessionStatus };
}

const mockSignIn = jest.fn();
const mockSignOut = jest.fn();

jest.mock('next-auth/react', () => ({
  __esModule: true,
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => mockCurrentSession(),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@garage/api-client', () => ({
  ...jest.requireActual('@garage/api-client'),
  // Resolves a row rather than `undefined`: TanStack treats an `undefined`
  // result as a programming error and logs it, and a suite that prints four
  // red lines on a green run trains the reader to ignore them.
  createApiClient: () => ({
    me: {
      get: jest.fn(async () => ({
        id: 'user-viewer',
        email: 'karel.zibar@firma.cz',
        name: 'Karel Zíbar',
        licensePlate: '4AB 1234',
        role: 'USER',
        oktaId: 'okta-1',
        active: true,
        icsToken: 'ics-token',
        preferredParkingSpotId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
  }),
}));

function signedIn(overrides: Partial<MockSession> = {}): MockSession {
  return {
    user: { name: 'Karel Zíbar', email: 'karel.zibar@firma.cz' },
    expires: '2099-01-01T00:00:00.000Z',
    accessToken: 'access-token',
    ...overrides,
  };
}

function setup(
  options: {
    status?: 'authenticated' | 'loading' | 'unauthenticated';
    session?: MockSession | null;
  } = {}
) {
  mockSignIn.mockReset();
  mockSignOut.mockReset();

  sessionStatus = options.status ?? 'authenticated';
  sessionData = options.session === undefined ? signedIn() : options.session;

  const client = createQueryClient({ defaultOptions: { queries: { retry: false } } });

  const Wrapper = createProviderWrapper(client);

  const utils = render(
    <AppLayout>
      <p>Parkoviště</p>
    </AppLayout>,
    { wrapper: Wrapper }
  );

  /** Puts a new session state on screen without remounting the layout. */
  function flipTo(
    status: 'authenticated' | 'loading' | 'unauthenticated',
    session: MockSession | null
  ) {
    sessionStatus = status;
    sessionData = session;
    utils.rerender(
      <AppLayout>
        <p>Parkoviště</p>
      </AppLayout>
    );
  }

  return { ...utils, flipTo };
}

describe('the (app) layout — the session guard every signed-in route mounts', () => {
  it('draws the top bar over its children and sends nobody anywhere while the session holds', async () => {
    setup();

    expect(screen.getByText('Parkoviště')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockSignIn).not.toHaveBeenCalled();
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('sends the visitor back to Okta when the session ends while the tab is open', async () => {
    const { flipTo } = setup();
    expect(mockSignIn).not.toHaveBeenCalled();

    // The other tab signed out; Auth.js broadcast it and `SessionProvider`
    // refetched. No navigation happened, so the proxy never gets a say.
    flipTo('unauthenticated', null);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('okta');
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('clears the dead cookie with signOut when the refresh fails, and does not sign in over it', async () => {
    const { flipTo } = setup();

    // Status stays `authenticated`: the cookie is still there, but
    // `accessTokenOf` withholds the token, so every call would 401 and the
    // socket handshake would be refused. Signing *in* while the broken session
    // is still stored is how a redirect loop starts.
    flipTo('authenticated', signedIn({ error: REFRESH_TOKEN_ERROR }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('waits rather than redirecting while the session is still loading', async () => {
    setup({ status: 'loading', session: null });

    await waitFor(() => {
      expect(screen.getByText('Parkoviště')).toBeInTheDocument();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('redirects once, not once per render', async () => {
    const { flipTo } = setup();
    flipTo('unauthenticated', null);
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });

    flipTo('unauthenticated', null);
    flipTo('unauthenticated', null);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });
});
