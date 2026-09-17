import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApiClient } from '@garage/api-client';
import { ERROR_DEFINITIONS } from '@garage/contract';
import { IntlProvider } from '@garage/i18n';
import cs from '../../../messages/cs.json';
import { ScreenDataGuard, ScreenError, ScreenLoading, screenDataOf } from './screen-state';

/**
 * Every error under test here is produced by a **real** `RPCLink`: a client
 * built with `createApiClient`, a real procedure called on it, and only the
 * `fetch` at the bottom replaced. Nothing constructs an `ORPCError` by hand.
 *
 * That is the point rather than thoroughness for its own sake. `ScreenError`'s
 * whole job is reading a failure that came off the wire, and a hand-built
 * error object would assert this file's idea of the wire shape instead of the
 * transport's — which is exactly the mistake that let `SPOT_ALREADY_RESERVED`
 * ship unreachable once already. It is also why `@orpc/client` is not imported
 * here: `apps/garage/web` may not, and it does not need to.
 */

const API_URL = 'https://api.test/rpc';

/** Answers every request with one canned status and body. */
function transportAnswering(status: number, body: unknown) {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** oRPC's success/error envelope. The payload is not at the top level. */
function rpcPayload(value: unknown) {
  return { json: value, meta: [] };
}

/**
 * A domain failure in oRPC's wire shape (`ORPCErrorJSON`). `defined: false`
 * because `apps/garage/api`'s global filter serialises every domain error that way —
 * `doc/decision/0033-*`, and the reason `toContractError` reads the code and
 * not oRPC's `defined` flag.
 */
function contractErrorBody(code: string, status: number, message: string) {
  return { defined: false as const, code, status, message };
}

/** Drives one real call and returns what it threw. */
async function failureFrom(fetchImpl: () => Promise<Response>): Promise<unknown> {
  const client = createApiClient({ url: API_URL, fetch: fetchImpl });
  const marker = Symbol('resolved');
  const outcome = await client.me.get().then(
    () => marker,
    (error: unknown) => error
  );
  if (outcome === marker) {
    throw new Error('expected the call to reject, but it resolved');
  }
  return outcome;
}

function renderWithIntl(node: ReactNode) {
  render(
    <IntlProvider locale="cs" messages={cs}>
      {node}
    </IntlProvider>
  );
}

describe('ScreenLoading', () => {
  it('announces itself as a status with the Czech label', () => {
    renderWithIntl(<ScreenLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('loading');
  });

  it('lets a screen supply its own label', () => {
    renderWithIntl(<ScreenLoading label="Načítám parkoviště…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Načítám parkoviště…');
  });
});

describe('ScreenError', () => {
  it('shows the Czech sentence for a contract error code', async () => {
    const error = await failureFrom(
      transportAnswering(
        409,
        rpcPayload(
          contractErrorBody(
            'SPOT_ALREADY_RESERVED',
            409,
            ERROR_DEFINITIONS.SPOT_ALREADY_RESERVED.message
          )
        )
      )
    );

    renderWithIntl(<ScreenError error={error} />);

    expect(screen.getByText('errorTitle')).toBeInTheDocument();
    expect(screen.getByText('SPOT_ALREADY_RESERVED')).toBeInTheDocument();
  });

  it('never shows the error’s own developer-facing message', async () => {
    const developerMessage = ERROR_DEFINITIONS.RESERVATION_LIMIT_REACHED.message;
    const error = await failureFrom(
      transportAnswering(
        409,
        rpcPayload(contractErrorBody('RESERVATION_LIMIT_REACHED', 409, developerMessage))
      )
    );

    renderWithIntl(<ScreenError error={error} />);

    expect(screen.queryByText(developerMessage)).not.toBeInTheDocument();
    expect(screen.getByText('RESERVATION_LIMIT_REACHED')).toBeInTheDocument();
  });

  it('falls back to one generic sentence for a transport failure', async () => {
    const error = await failureFrom(() => {
      throw new TypeError('Failed to fetch');
    });

    renderWithIntl(<ScreenError error={error} />);

    expect(screen.getByText('errorUnknown')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it('falls back for a code outside the contract’s closed enum', async () => {
    // A backend answering with something the contract never declared must not
    // put an unknown enum name in front of a user.
    const error = await failureFrom(
      transportAnswering(400, rpcPayload(contractErrorBody('SOMETHING_NEW', 400, 'nope')))
    );

    renderWithIntl(<ScreenError error={error} />);

    expect(screen.getByText('errorUnknown')).toBeInTheDocument();
    expect(screen.queryByText(/SOMETHING_NEW/)).not.toBeInTheDocument();
  });

  it('offers no retry control when there is nothing to retry', () => {
    renderWithIntl(<ScreenError error={new Error('boom')} />);

    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
  });

  it('runs the retry callback when one is supplied', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();

    renderWithIntl(<ScreenError error={new Error('boom')} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the title as a heading only when the page asks for one', () => {
    const { unmount } = render(
      <IntlProvider locale="cs" messages={cs}>
        <ScreenError error={new Error('boom')} />
      </IntlProvider>
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<ScreenError error={new Error('boom')} headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('errorTitle');
  });
});

describe('screenDataOf', () => {
  it('is loading while the query is pending', () => {
    expect(screenDataOf({ isPending: true, isError: false, error: null, data: undefined })).toEqual(
      {
        kind: 'loading',
      }
    );
  });

  it('is loading even when the pending query already carries stale data', () => {
    // Pending wins: a screen that draws its ready branch here would be showing
    // the previous answer as if it were the current one.
    expect(screenDataOf({ isPending: true, isError: false, error: null, data: 'stale' })).toEqual({
      kind: 'loading',
    });
  });

  it('is loading even when the pending query also reports an error', () => {
    // The precedence the six hand-written guards had, kept verbatim: they read
    // `isPending` first, so this mapping changes no screen's output.
    const boom = new Error('boom');
    expect(screenDataOf({ isPending: true, isError: true, error: boom, data: undefined })).toEqual({
      kind: 'loading',
    });
  });

  it('carries the failure through on an error', () => {
    const boom = new Error('boom');
    expect(screenDataOf({ isPending: false, isError: true, error: boom, data: undefined })).toEqual(
      {
        kind: 'error',
        error: boom,
      }
    );
  });

  it('is an error when nothing failed but there is no data either', () => {
    // The combination five prop interfaces used to rule out in prose. It is
    // not "ready with nothing": a screen reaching its ready branch with no
    // data would draw an empty table asserting there are no parking spots,
    // where the truth is an absence. Mapping it to `error` is what the
    // `if (isError || data === undefined)` guards already did.
    expect(
      screenDataOf({ isPending: false, isError: false, error: null, data: undefined })
    ).toEqual({ kind: 'error', error: null });
  });

  it('is ready with the data once there is some', () => {
    const payload = { spots: ['E2.92'] };
    expect(screenDataOf({ isPending: false, isError: false, error: null, data: payload })).toEqual({
      kind: 'ready',
      data: payload,
    });
  });

  it('treats a falsy-but-present payload as data, not as absence', () => {
    // `data === undefined` is the test, never truthiness: an empty list and a
    // zero are real answers.
    expect(screenDataOf({ isPending: false, isError: false, error: null, data: 0 })).toEqual({
      kind: 'ready',
      data: 0,
    });
    expect(screenDataOf({ isPending: false, isError: false, error: null, data: null })).toEqual({
      kind: 'ready',
      data: null,
    });
  });
});

describe('ScreenDataGuard', () => {
  it('draws the loading state and never the children', () => {
    const children = jest.fn(() => <p>drawn</p>);
    renderWithIntl(<ScreenDataGuard state={{ kind: 'loading' }}>{children}</ScreenDataGuard>);

    expect(screen.getByRole('status')).toHaveTextContent('loading');
    expect(children).not.toHaveBeenCalled();
  });

  it('draws the error state, with the retry the caller supplied', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    const children = jest.fn(() => <p>drawn</p>);

    renderWithIntl(
      <ScreenDataGuard state={{ kind: 'error', error: new Error('boom') }} onRetry={onRetry}>
        {children}
      </ScreenDataGuard>
    );
    await user.click(screen.getByRole('button', { name: 'retry' }));

    expect(screen.getByText('errorTitle')).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(children).not.toHaveBeenCalled();
  });

  it('forwards the heading level, because only the page knows its own outline', () => {
    renderWithIntl(
      <ScreenDataGuard state={{ kind: 'error', error: new Error('boom') }} headingLevel={3}>
        {() => <p>drawn</p>}
      </ScreenDataGuard>
    );

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('errorTitle');
  });

  it('offers no retry control when the caller passed none', () => {
    renderWithIntl(
      <ScreenDataGuard state={{ kind: 'error', error: new Error('boom') }}>
        {() => <p>drawn</p>}
      </ScreenDataGuard>
    );

    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
  });

  it('hands the data to the children once it is ready, and draws neither state', () => {
    renderWithIntl(
      <ScreenDataGuard state={{ kind: 'ready', data: 'E2.92' }}>
        {(label) => <p>{label}</p>}
      </ScreenDataGuard>
    );

    expect(screen.getByText('E2.92')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('errorTitle')).not.toBeInTheDocument();
  });
});
