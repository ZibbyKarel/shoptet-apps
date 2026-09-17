/**
 * A feature component reading, mutating and invalidating through TanStack
 * Query and `@garage/api-client`, end to end.
 *
 * Ported from `libs/query`'s `app-usage.spec.tsx`, which existed to
 * demonstrate the (now-removed) wrapper's API was sufficient for real feature
 * code. That demonstration's premise is gone (`doc/decision/0308-*`), so the
 * one test that read its own source to prove no `@tanstack/*`/`@orpc/*` import
 * was needed is dropped; the rest is still exactly the coverage this app's
 * query wiring needs — a real `RPCLink` with only `fetch` stubbed, so a
 * mistake in the retry policy or the invalidation key shows up here, not just
 * in production.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toContractError, createApiQueryUtils } from '@garage/api-client';
import type { ApiClient, ApiQueryUtils } from '@garage/api-client';
import { createQueryClient } from './query-client';
import {
  contractErrorResponse,
  rpcPayload,
  stubApi,
  transportErrorResponse,
} from '../../testing/stub-api';
import type { StubbedApi, StubbedResponse } from '../../testing/stub-api';

const DAY = { date: '2026-09-15' };
const SPOT_ID = '22222222-2222-4222-8222-222222222222';

const DAY_OVERVIEW = {
  date: DAY.date,
  window: null,
  canReserve: true,
  spots: [],
  myReservation: null,
};

/** Renders `ui` inside the app's provider, exactly as `apps/garage/web` will. */
function renderWithApi(client: ApiClient, ui: (utils: ApiQueryUtils) => React.ReactElement) {
  const utils = createApiQueryUtils(client);
  const queryClient = createQueryClient({
    defaultOptions: { queries: { retryDelay: () => 0 } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui(utils)}</QueryClientProvider>);
}

function DayOverview({ utils }: { utils: ApiQueryUtils }) {
  const { data, error, isPending } = useQuery(utils.overview.day.queryOptions({ input: DAY }));

  if (isPending) {
    return <p>Načítám…</p>;
  }
  if (error) {
    // The whole point of the error contract: a component switches on a member
    // of `ERROR_CODES`, never on an HTTP status or an oRPC type.
    return <p role="alert">{toContractError(error)?.code ?? 'UNKNOWN'}</p>;
  }
  return <p>{data.date}</p>;
}

function ReserveButton({ utils }: { utils: ApiQueryUtils }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    ...utils.reservation.create.mutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: utils.overview.key() }),
  });

  return (
    <>
      <button type="button" onClick={() => create.mutate({ parkingSpotId: SPOT_ID, ...DAY })}>
        Rezervovat
      </button>
      {create.error ? <p role="alert">{toContractError(create.error)?.code}</p> : null}
    </>
  );
}

function alwaysRespond(response: StubbedResponse): StubbedApi {
  return stubApi(() => response);
}

describe('a feature component using TanStack Query and @garage/api-client directly', () => {
  it('renders data fetched through a contract procedure', async () => {
    const api = alwaysRespond({ status: 200, body: rpcPayload(DAY_OVERVIEW) });

    renderWithApi(api.client, (utils) => <DayOverview utils={utils} />);

    expect(await screen.findByText('2026-09-15')).toBeInTheDocument();
    expect(api.requests[0]?.url).toBe('https://api.test/rpc/overview/day');
  });

  it('surfaces a domain failure as a contract error code', async () => {
    const api = alwaysRespond(contractErrorResponse('FORBIDDEN'));

    renderWithApi(api.client, (utils) => <DayOverview utils={utils} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('FORBIDDEN');
    // Not retried: a 4xx is an answer, and the user sees it immediately.
    expect(api.requests).toHaveLength(1);
  });

  it('reports a failure with no contract code as unknown rather than inventing one', async () => {
    const api = alwaysRespond(transportErrorResponse(429, 'ThrottlerException'));

    renderWithApi(api.client, (utils) => <DayOverview utils={utils} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('UNKNOWN');
  });

  it('sends a mutation once and does not retry it', async () => {
    const api = alwaysRespond(contractErrorResponse('SPOT_ALREADY_RESERVED'));

    renderWithApi(api.client, (utils) => <ReserveButton utils={utils} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rezervovat' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('SPOT_ALREADY_RESERVED');
    expect(api.requests).toHaveLength(1);
  });

  it('refetches the overview after a successful mutation invalidates it', async () => {
    const api = stubApi((callIndex) =>
      callIndex === 1
        ? { status: 200, body: rpcPayload({ id: 'r1' }) }
        : { status: 200, body: rpcPayload(DAY_OVERVIEW) }
    );

    renderWithApi(api.client, (utils) => (
      <>
        <DayOverview utils={utils} />
        <ReserveButton utils={utils} />
      </>
    ));

    await screen.findByText('2026-09-15');
    expect(api.requests).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Rezervovat' }));

    // overview, mutation, overview again — the invalidation reached the query
    // through the branch key, with no key written by hand anywhere above.
    await waitFor(() => expect(api.requests).toHaveLength(3));
    expect(api.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/rpc/overview/day',
      '/rpc/reservation/create',
      '/rpc/overview/day',
    ]);
  });
});
