import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { RealtimeProvider } from '@garage/realtime-client';
import { RealtimeBoundary } from './realtime-boundary';

/**
 * `RealtimeBoundary` has exactly one rule — when the socket is allowed to open
 * — and this is that rule.
 *
 * Both seams are stubbed at the **wrapper**: `@garage/realtime-client` and
 * `@garage/auth/client`. Nothing here names `socket.io-client` or
 * `next-auth`, which `apps/garage/web` may not import at all; a real socket would need
 * a running gateway, and that is Task 15's suite and the e2e run, not this one.
 *
 * The stub renders its children so the boundary is still shown to be
 * transparent: holding the connection closed must not hold the application
 * closed.
 */

jest.mock('@garage/realtime-client', () => ({
  RealtimeProvider: jest.fn(({ children }: { children: ReactNode }) => <>{children}</>),
}));

jest.mock('@garage/auth/client', () => ({
  useSession: () => ({ status: mockSessionStatus }),
  useAccessTokenProvider: () => mockGetAccessToken,
}));

const mockGetAccessToken = async () => 'irrelevant';
let mockSessionStatus: 'authenticated' | 'unauthenticated' | 'loading' = 'unauthenticated';

const realtimeProviderMock = jest.mocked(RealtimeProvider);

/** The props the boundary handed the provider on its last render. */
function lastProps() {
  const call = realtimeProviderMock.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('RealtimeProvider was never rendered');
  }
  return call[0];
}

function renderBoundary(status: typeof mockSessionStatus, url: string) {
  mockSessionStatus = status;
  render(
    <RealtimeBoundary url={url}>
      <span>screen</span>
    </RealtimeBoundary>
  );
}

const API_ORIGIN = 'http://localhost:3000';

describe('RealtimeBoundary', () => {
  beforeEach(() => {
    realtimeProviderMock.mockClear();
  });

  it('opens the socket once there is a session', () => {
    renderBoundary('authenticated', API_ORIGIN);

    expect(lastProps().enabled).toBe(true);
    expect(lastProps().url).toBe(API_ORIGIN);
    expect(lastProps().getAccessToken).toBe(mockGetAccessToken);
  });

  it('holds the socket closed for a signed-out visitor', () => {
    renderBoundary('unauthenticated', API_ORIGIN);

    expect(lastProps().enabled).toBe(false);
  });

  it('holds the socket closed while the session is still loading', () => {
    renderBoundary('loading', API_ORIGIN);

    expect(lastProps().enabled).toBe(false);
  });

  it('holds the socket closed when there is no URL, session or not', () => {
    // The build-time render with no environment. `io('')` would dial the page's
    // own origin, which is not the API.
    renderBoundary('authenticated', '');

    expect(lastProps().enabled).toBe(false);
  });

  it('renders the application either way', () => {
    renderBoundary('unauthenticated', API_ORIGIN);

    expect(screen.getByText('screen')).toBeInTheDocument();
  });
});
