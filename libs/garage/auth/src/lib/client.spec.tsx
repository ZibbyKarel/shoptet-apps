/**
 * @jest-environment jsdom
 */

/**
 * The browser half: where the access token lives, how it is renewed, and what
 * happens when there is no usable session.
 *
 * `SessionProvider` and `useSession` are the **real** ones — only `signIn` and
 * `signOut` are replaced, because they navigate the window away and jsdom
 * cannot follow. That matters: the storage assertions below would be worthless
 * against a hand-rolled provider, since the thing they have to rule out is
 * Auth.js's own client persisting something.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { signIn, signOut } from 'next-auth/react';
import type { AccessTokenProvider } from '@garage/api-client';
import {
  AuthProvider,
  OKTA_PROVIDER_ID,
  REFRESH_TOKEN_ERROR,
  SESSION_REFETCH_SECONDS,
  useAccessTokenProvider,
  useRequireAuth,
} from '../client';
import type { AuthSession } from '../client';

jest.mock('next-auth/react', () => ({
  ...jest.requireActual('next-auth/react'),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

const mockedSignIn = signIn as jest.MockedFunction<typeof signIn>;
const mockedSignOut = signOut as jest.MockedFunction<typeof signOut>;

const SIGNED_IN: AuthSession = {
  user: { email: 'a@b.test' },
  expires: '2099-01-01T00:00:00.000Z',
  accessToken: 'okta-access-token',
};

/** Captures the provider `useAccessTokenProvider` hands out, for assertions. */
let latestProvider: AccessTokenProvider | undefined;

function TokenReader() {
  latestProvider = useAccessTokenProvider();
  return <span data-testid="ready">ready</span>;
}

function Guarded() {
  const { status } = useRequireAuth();
  return <span data-testid="status">{status}</span>;
}

/**
 * Installs a stand-in for `fetch`.
 *
 * jsdom implements neither `fetch` nor `Response`, so `jest.spyOn` has nothing
 * to spy on and a real `Response` cannot be constructed. Auth.js's client only
 * reads `res.ok` and `res.json()` (`next-auth/lib/client.js` → `fetchData`),
 * which is what this returns.
 */
function installFetch(respond: () => Promise<unknown>) {
  const calls: unknown[][] = [];
  const original = Reflect.get(globalThis, 'fetch');
  const stub = (...args: unknown[]) => {
    calls.push(args);
    return respond();
  };
  Reflect.set(globalThis, 'fetch', stub);

  return {
    calls,
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'fetch');
      } else {
        Reflect.set(globalThis, 'fetch', original);
      }
    },
  };
}

beforeEach(() => {
  latestProvider = undefined;
  mockedSignIn.mockReset();
  mockedSignOut.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('useAccessTokenProvider', () => {
  it('hands out the token the session carries', async () => {
    render(
      <AuthProvider session={SIGNED_IN} refetchIntervalSeconds={0}>
        <TokenReader />
      </AuthProvider>
    );

    await expect(latestProvider?.()).resolves.toBe('okta-access-token');
  });

  it('hands out null when the refresh failed, rather than the stale token', async () => {
    render(
      <AuthProvider
        session={{ ...SIGNED_IN, error: REFRESH_TOKEN_ERROR }}
        refetchIntervalSeconds={0}
      >
        <TokenReader />
      </AuthProvider>
    );

    await expect(latestProvider?.()).resolves.toBeNull();
  });

  it('keeps the same function identity across re-renders', () => {
    const { rerender } = render(
      <AuthProvider session={SIGNED_IN} refetchIntervalSeconds={0}>
        <TokenReader />
      </AuthProvider>
    );
    const first = latestProvider;

    rerender(
      <AuthProvider session={SIGNED_IN} refetchIntervalSeconds={0}>
        <TokenReader />
      </AuthProvider>
    );

    // A new function on every render would tear down and rebuild the API
    // client and the Socket.io connection built from it.
    expect(latestProvider).toBe(first);
  });
});

describe('the access token and browser storage', () => {
  it('never reaches localStorage, sessionStorage or a readable cookie', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    render(
      <AuthProvider session={SIGNED_IN} refetchIntervalSeconds={0}>
        <TokenReader />
      </AuthProvider>
    );
    await screen.findByTestId('ready');
    await expect(latestProvider?.()).resolves.toBe('okta-access-token');

    // The token was live in React state for the whole render above — this is
    // what rules out anything having also written it somewhere durable.
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('okta-access-token');

    setItem.mockRestore();
  });

  it('is not persisted by the source of this lib either', () => {
    // The runtime check above can only speak for the paths it exercised. This
    // one covers the whole lib, including code a future task adds — and it now
    // actually does. It used to name four files by hand while claiming that
    // coverage, and the two it left out were the ones that mattered most:
    // `lib/refresh.ts`, the only module that holds a *refresh* token in memory,
    // and `lib/revocation.ts`. The final review found the gap; the fix is to
    // walk the tree rather than to keep a list honest by hand, which is the
    // same device `libs/garage/contract/src/realtime/no-orpc.spec.ts` uses.
    const sourceDir = join(__dirname, '..');
    const files = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' }).filter(
      (entry) => /\.(ts|tsx)$/.test(entry) && !/\.spec\.tsx?$/.test(entry)
    );

    // The walker carries its own control: pointed at a directory it cannot
    // read, or with an extension filter that stops matching, it would find
    // nothing and pass vacuously. Naming the two files the old list omitted
    // makes that impossible to miss.
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toEqual(
      expect.arrayContaining([join('lib', 'refresh.ts'), join('lib', 'revocation.ts')])
    );

    for (const file of files) {
      const source = readFileSync(join(sourceDir, file), 'utf8');
      // Comments explaining the ban are allowed; code is not.
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ file, matches: withoutComments.match(/localStorage|sessionStorage/) }).toEqual({
        file,
        matches: null,
      });
    }
  });
});

describe('session polling', () => {
  it('re-reads the session on the interval, picking up a renewed token', async () => {
    // This is what makes rotation happen in an idle tab: the rotation itself
    // runs in the server-side `jwt` callback, which only runs when something
    // asks for the session.
    jest.useFakeTimers();
    const renewed: AuthSession = { ...SIGNED_IN, accessToken: 'renewed-access-token' };
    const server = installFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => renewed,
    }));

    try {
      render(
        <AuthProvider session={SIGNED_IN}>
          <TokenReader />
        </AuthProvider>
      );
      await expect(latestProvider?.()).resolves.toBe('okta-access-token');

      await act(async () => {
        jest.advanceTimersByTime(SESSION_REFETCH_SECONDS * 1000);
      });

      expect(server.calls).toHaveLength(1);
      expect(String(server.calls[0]?.[0])).toContain('/api/auth/session');
      await expect(latestProvider?.()).resolves.toBe('renewed-access-token');
    } finally {
      server.restore();
      jest.useRealTimers();
    }
  });
});

describe('useRequireAuth', () => {
  it('sends an unauthenticated visitor to Okta', async () => {
    render(
      <AuthProvider session={null} refetchIntervalSeconds={0}>
        <Guarded />
      </AuthProvider>
    );

    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledWith(OKTA_PROVIDER_ID));
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    expect(mockedSignOut).not.toHaveBeenCalled();
  });

  it('signs out after a failed refresh instead of leaving a silent 401', async () => {
    render(
      <AuthProvider
        session={{ ...SIGNED_IN, error: REFRESH_TOKEN_ERROR }}
        refetchIntervalSeconds={0}
      >
        <Guarded />
      </AuthProvider>
    );

    await waitFor(() => expect(mockedSignOut).toHaveBeenCalledTimes(1));
    // Signing *in* while the broken session cookie is still stored is how a
    // redirect loop starts.
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('redirects once, not on every render', async () => {
    const { rerender } = render(
      <AuthProvider session={null} refetchIntervalSeconds={0}>
        <Guarded />
      </AuthProvider>
    );
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledTimes(1));

    rerender(
      <AuthProvider session={null} refetchIntervalSeconds={0}>
        <Guarded />
      </AuthProvider>
    );

    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-in user where they are', async () => {
    render(
      <AuthProvider session={SIGNED_IN} refetchIntervalSeconds={0}>
        <Guarded />
      </AuthProvider>
    );

    await screen.findByText('authenticated');
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(mockedSignOut).not.toHaveBeenCalled();
  });

  it('does nothing while the session is still loading', async () => {
    // No `session` prop at all: the provider starts in `loading` and fetches.
    // A redirect fired here would bounce a signed-in user off the page on
    // every hard refresh.
    // A request that never settles: the provider stays in `loading` for the
    // whole test, which is the state being asserted about.
    const server = installFetch(() => new Promise<unknown>(() => undefined));

    try {
      render(
        <AuthProvider refetchIntervalSeconds={0}>
          <Guarded />
        </AuthProvider>
      );

      await screen.findByText('loading');
      expect(mockedSignIn).not.toHaveBeenCalled();
      expect(mockedSignOut).not.toHaveBeenCalled();
    } finally {
      server.restore();
    }
  });
});
