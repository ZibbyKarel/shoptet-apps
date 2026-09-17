/**
 * How a failure that came back over the wire is read as a contract error.
 *
 * Every case here goes through a real `RPCLink` with a stubbed `fetch`, so what
 * is asserted is what the transport actually produces — not what an oRPC error
 * object constructed by hand would look like.
 */

import { ERROR_CODES, ERROR_DEFINITIONS } from '@garage/contract';
import type { ErrorCode } from '@garage/contract';
import { createApiClient, errorStatus, toContractError } from '../index';
import { failingTransport, rpcPayload, stubTransport } from '../__fixtures__/stub-transport';

const URL_BASE = 'https://api.test/rpc';

/**
 * A domain error in oRPC's wire shape, `ORPCErrorJSON`.
 *
 * `defined: false` because an error the server did not declare on the procedure
 * carries that flag — which is every domain error this backend sends
 * (`doc/decision/0033-*`), and the reason `toContractError` reads the code
 * rather than that flag.
 *
 * This is a **local restatement**, not a shared fixture: nothing here is
 * imported from `apps/garage/api`, and nothing can be — `libs/shared/api-client` is
 * `type:util`/`scope:web`, `apps/garage/api` is `type:app`/`scope:api`, and the Nx
 * boundaries forbid both directions. So this helper proves nothing about what
 * the server actually sends. See the note on the last test in this file.
 */
function contractErrorBody(code: ErrorCode, data?: Record<string, unknown>) {
  const definition = ERROR_DEFINITIONS[code];
  return {
    defined: false as const,
    code,
    status: definition.status,
    message: definition.message,
    ...(data === undefined ? {} : { data }),
  };
}

/** Calls one procedure through a real link and returns whatever it threw. */
async function failedCall(response: { status: number; body: unknown }): Promise<unknown> {
  const transport = stubTransport(() => response);
  const client = createApiClient({ url: URL_BASE, fetch: transport.fetch });
  return rejectionOf(
    client.reservation.create({
      parkingSpotId: '22222222-2222-4222-8222-222222222222',
      date: '2026-09-15',
    })
  );
}

/** The reason a promise rejected. Fails the test if it resolves instead. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  const marker = Symbol('resolved');
  const outcome = await promise.then(
    () => marker,
    (error: unknown) => error
  );
  if (outcome === marker) {
    throw new Error('expected the call to reject, but it resolved');
  }
  return outcome;
}

describe('toContractError', () => {
  it('maps a domain error from the wire onto its contract code, status and details', async () => {
    const error = await failedCall({
      status: 409,
      body: rpcPayload(contractErrorBody('SPOT_ALREADY_RESERVED', { reservationId: 'abc' })),
    });

    expect(toContractError(error)).toEqual({
      code: 'SPOT_ALREADY_RESERVED',
      status: 409,
      message: ERROR_DEFINITIONS.SPOT_ALREADY_RESERVED.message,
      details: { reservationId: 'abc' },
    });
  });

  it('does not narrow on oRPC’s `defined` flag, which this backend always sends as false', async () => {
    const error = await failedCall({
      status: 423,
      body: rpcPayload(contractErrorBody('RESERVATIONS_LOCKED')),
    });

    // `defined: false` is what `contractErrorBody()` writes for *every* domain
    // error. oRPC's own `isDefinedError` narrows on exactly that flag, so it
    // would reject this error; the code-based check does not.
    expect(toContractError(error)).toEqual({
      code: 'RESERVATIONS_LOCKED',
      status: 423,
      message: ERROR_DEFINITIONS.RESERVATIONS_LOCKED.message,
      details: undefined,
    });
  });

  it.each(ERROR_CODES)(
    'maps %s, so no code in the closed enum is left unreadable',
    async (code) => {
      const error = await failedCall({
        status: ERROR_DEFINITIONS[code].status,
        body: rpcPayload(contractErrorBody(code)),
      });

      expect(toContractError(error)?.code).toBe(code);
    }
  );

  it('leaves `details` undefined when the error carried none', async () => {
    const error = await failedCall({
      status: 404,
      body: rpcPayload(contractErrorBody('NOT_FOUND')),
    });

    expect(toContractError(error)?.details).toBeUndefined();
  });

  it('returns null for a code outside the closed enum', async () => {
    const error = await failedCall({
      status: 409,
      body: rpcPayload({
        defined: false,
        code: 'SOMETHING_NEW',
        status: 409,
        message: 'A code this frontend has never heard of.',
      }),
    });

    expect(toContractError(error)).toBeNull();
  });

  it('returns null for a transport failure the contract has no code for', async () => {
    // The throttler's 429 keeps Nest's `{ statusCode, message }` shape and
    // carries no `code` at all (`doc/decision/0033-*`).
    const error = await failedCall({
      status: 429,
      body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
    });

    expect(toContractError(error)).toBeNull();
  });

  it('returns null when the request never reached a server', async () => {
    const client = createApiClient({ url: URL_BASE, fetch: failingTransport() });
    const error = await rejectionOf(client.me.get({}));

    expect(error).toBeInstanceOf(TypeError);
    expect(toContractError(error)).toBeNull();
  });

  it('returns null for a plain thrown value', () => {
    expect(toContractError(new Error('boom'))).toBeNull();
    expect(toContractError('boom')).toBeNull();
    expect(toContractError(undefined)).toBeNull();
  });

  /**
   * Documents a property of `@orpc/client@1.15.0`, and **nothing about
   * `apps/garage/api`**.
   *
   * The RPC protocol reads a response payload out of a `{ json, meta }`
   * envelope. An error body placed at the top level instead deserialises to
   * `undefined`, fails oRPC's `isORPCErrorJson`, and the client falls back to a
   * code synthesised from the HTTP status — so the domain code is lost, and at
   * 409 it is replaced by `CONFLICT`, which is *also* a member of `ERROR_CODES`.
   * It does not fail closed: the wrong domain error arrives looking valid.
   *
   * `apps/garage/api` **used to** write its error body at the top level
   * (`response.status(...).json(body)`, `doc/decision/0033-*`), which produced
   * exactly this failure against a real server. It no longer does:
   * `rpcEnvelope` in `apps/garage/api/src/common/errors/error-body.ts` wraps every
   * contract-error body on an `/api/rpc` path in `{ json: … }`
   * (`doc/decision/0058-*`), and the guard
   * that watches it lives in `apps/garage/api/src/orpc/orpc-pipeline.spec.ts`, which
   * asserts the enveloped shape against a live server. That is where the guard
   * has to be: the coupling cannot be written from here, because the Nx
   * boundaries forbid a `type:util`/`scope:web` lib from depending on
   * `type:app`/`scope:api`.
   *
   * **This test therefore guards nothing about the server, and never did** —
   * its input is hand-written here, so it passes unchanged whichever body the
   * filter produces. It is kept because the oRPC behaviour it pins is
   * load-bearing for `toContractError` and is not obvious from the package's
   * documentation: it is the reason `toContractError` must **not** be loosened
   * to read a top-level body (`doc/decision/0039-*`, "Risk if this is wrong").
   */
  it('loses the domain code when a body is not wrapped in the RPC envelope', async () => {
    const error = await failedCall({
      status: 409,
      body: contractErrorBody('SPOT_ALREADY_RESERVED', { reservationId: 'abc' }),
    });

    expect(toContractError(error)?.code).toBe('CONFLICT');
    expect(toContractError(error)?.code).not.toBe('SPOT_ALREADY_RESERVED');
  });
});

describe('errorStatus', () => {
  it('reports the status of a domain error', async () => {
    const error = await failedCall({
      status: 423,
      body: rpcPayload(contractErrorBody('RESERVATIONS_LOCKED')),
    });

    expect(errorStatus(error)).toBe(423);
  });

  it('reports the status of a transport failure that carried no contract code', async () => {
    const error = await failedCall({
      status: 429,
      body: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
    });

    expect(errorStatus(error)).toBe(429);
  });

  it('reports 500 for an unknown server failure', async () => {
    const error = await failedCall({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error' },
    });

    expect(errorStatus(error)).toBe(500);
  });

  it('is undefined when there was no response at all', async () => {
    const client = createApiClient({ url: URL_BASE, fetch: failingTransport() });
    const error = await rejectionOf(client.me.get({}));

    expect(errorStatus(error)).toBeUndefined();
  });
});
