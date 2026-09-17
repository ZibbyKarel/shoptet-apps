/**
 * A real contract failure, manufactured once.
 *
 * Five admin specs had a byte-identical (or near-identical) copy of this, and
 * four more files had it in three other spellings. Every copy re-stated the wire
 * envelope `{ json: { defined: false, code, status, message }, meta: [] }` —
 * the one detail `doc/decision/0039-*` says must not be guessed at, and the one
 * `apps/garage/api`'s `ContractExceptionFilter` owns on the other side. Nine
 * restatements is nine chances for a spec to assert its own idea of the wire
 * instead of the wire's.
 *
 * The failure comes off a **real** `RPCLink` — a client built with
 * `createApiClient`, one real procedure called on it, only `fetch` replaced.
 * `apps/garage/web` may not import `@orpc/client` to hand-build an `ORPCError`, and one
 * built here would assert this file's idea of the shape rather than the
 * transport's.
 *
 * It lives in `apps/garage/web/src/testing/` rather than in
 * `libs/shared/api-client/src/__fixtures__/` (where `rpcPayload` already lives) for a
 * structural reason: a lib's `__fixtures__` folder is excluded from that lib's
 * build program and reachable only by relative paths *inside* that lib —
 * `@garage/api-client` exports `src/index.ts` and nothing else, so no file in
 * `apps/garage/web` can import it without a new entry point.
 *
 * **`createApiClient` comes from `jest.requireActual`, not a static import.**
 * `lot-screen.spec.tsx` mocks `@garage/api-client` wholesale, to replace
 * `createApiClient` with an object of `jest.fn()`s it controls directly — that
 * mock would otherwise reach this file too, since a `jest.mock` on a module
 * applies to every importer of it, and the "real transport, only `fetch`
 * replaced" guarantee above would quietly become "the caller's own client
 * double" instead.
 */

import { ERROR_DEFINITIONS } from '@garage/contract';
import type { ErrorCode } from '@garage/contract';

const { createApiClient } =
  jest.requireActual<typeof import('@garage/api-client')>('@garage/api-client');

const API_URL = 'https://api.test/rpc';

/**
 * The rejection the oRPC client hands a component when the API returns `code`.
 *
 * The status is the one the contract itself assigns the code, not a guess:
 * `RPCLink` derives a *different* code from the status when the body cannot be
 * read, so a mismatched pair would silently exercise the wrong error.
 */
export async function failureWithCode(code: ErrorCode): Promise<unknown> {
  const status = ERROR_DEFINITIONS[code].status;
  const body = {
    json: { defined: false as const, code, status, message: 'developer-facing' },
    meta: [],
  };
  const client = createApiClient({
    url: API_URL,
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  });

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
