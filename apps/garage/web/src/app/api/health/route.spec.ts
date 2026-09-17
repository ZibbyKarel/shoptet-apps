import { GET, UPSTREAM_TIMEOUT_MS } from './route';
import type { HealthBody } from './route';

/**
 * The readiness probe, driven through its real handler.
 *
 * The one property worth guarding above all the others is the **URL it asks**:
 * the API's probes are excluded from `setGlobalPrefix`, so they answer at
 * `/health/ready` and not under `/api`. Building that path off the configured
 * `NEXT_PUBLIC_API_URL` *including* its prefix produces a probe that is red on
 * a perfectly healthy deployment, which is the failure this file exists to
 * make impossible.
 */

const API_URL = 'http://api.test:3000/api';

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API_URL;
});

afterEach(() => {
  fetchSpy?.mockRestore();
  delete process.env.NEXT_PUBLIC_API_URL;
});

/** Replaces `fetch` with one that answers `status`, and records the calls. */
function upstreamAnswering(status: number): jest.SpyInstance {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
  return fetchSpy;
}

/** Replaces `fetch` with one that rejects the way a named failure does. */
function upstreamThrowing(error: Error): jest.SpyInstance {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(error);
  return fetchSpy;
}

async function probe(): Promise<{ status: number; body: HealthBody }> {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as HealthBody };
}

describe('GET /api/health', () => {
  it('asks the API at /health/ready, not at /api/health/ready', async () => {
    const spy = upstreamAnswering(200);

    await probe();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test:3000/health/ready');
    expect(url).not.toContain('/api/health');
  });

  it('answers 200 and status ok when the API is ready', async () => {
    upstreamAnswering(200);

    await expect(probe()).resolves.toEqual({
      status: 200,
      body: { status: 'ok', checks: { api: { status: 'up' } } },
    });
  });

  it('answers 503 and "not-ready" when the API answers 503', async () => {
    // Terminus answers 503 while Postgres is down. That is an answer, not an
    // outage — the distinction an operator needs.
    upstreamAnswering(503);

    await expect(probe()).resolves.toEqual({
      status: 503,
      body: { status: 'error', checks: { api: { status: 'down', reason: 'not-ready' } } },
    });
  });

  it('answers 503 and "unreachable" when the connection fails', async () => {
    upstreamThrowing(new TypeError('fetch failed'));

    await expect(probe()).resolves.toEqual({
      status: 503,
      body: { status: 'error', checks: { api: { status: 'down', reason: 'unreachable' } } },
    });
  });

  it('answers 503 and "timeout" when the API does not answer in time', async () => {
    // `AbortSignal.timeout` rejects with a `TimeoutError`; the two failures
    // are told apart by `name`, not by a message.
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    upstreamThrowing(timeout);

    await expect(probe()).resolves.toEqual({
      status: 503,
      body: { status: 'error', checks: { api: { status: 'down', reason: 'timeout' } } },
    });
  });

  it('answers 503 and "not-configured" when the API URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const spy = upstreamAnswering(200);

    await expect(probe()).resolves.toEqual({
      status: 503,
      body: { status: 'error', checks: { api: { status: 'down', reason: 'not-configured' } } },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaks nothing about the upstream failure beyond a fixed reason', async () => {
    upstreamThrowing(new TypeError('connect ECONNREFUSED 10.0.0.7:3000'));

    const { body } = await probe();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('10.0.0.7');
    expect(serialized).not.toContain('api.test');
  });

  it('is never cached, on the response or on the request it makes', async () => {
    const spy = upstreamAnswering(200);

    const response = await GET();

    expect(response.headers.get('cache-control')).toBe('no-store');
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe('no-store');
  });

  it('bounds the wait, and does so below the API’s own database timeout', async () => {
    // `HEALTH_DB_TIMEOUT_MS` defaults to 3000 ms on the API side; waiting less
    // than that would report `timeout` for a probe that was about to answer.
    expect(UPSTREAM_TIMEOUT_MS).toBeGreaterThan(3_000);

    const spy = upstreamAnswering(200);
    await GET();

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
