/**
 * jsdom, with one consistent set of fetch/stream Web APIs — Node's.
 *
 * A copy of `libs/query/jest-environment-web.cjs`, for the same reason and
 * with the same contents; `doc/decision/0037-*` explains the mechanism in
 * full. Two things in `apps/garage/web` need it:
 *
 * - `src/shell/screen-state/screen-state.spec.tsx` builds its errors by driving a **real**
 *   `RPCLink` (through `createApiClient`) rather than hand-rolling an oRPC
 *   error object — which means `@orpc/client` is imported, and merely
 *   importing it in bare jsdom fails with
 *   `ReferenceError: TransformStream is not defined`;
 * - `src/app/api/health/route.spec.ts` drives the route handler, which builds
 *   a `Response` and calls `fetch`.
 *
 * Copied rather than shared because a Jest environment is a file path in a
 * project's own config, and the two projects have different Jest setups (`next/jest`
 * here, the Nx preset there). If a third project needs it, move it to the
 * workspace root and point all three at it.
 *
 * Filling in only the *missing* names is not enough: jsdom's `AbortController`
 * produces a signal Node's `Request` rejects, so the whole family has to come
 * from one realm and every name below is replaced rather than defaulted.
 *
 * ## Why `FormData`, `Blob` and `File` are *not* replaced here
 *
 * `libs/query`'s copy overrides all three. This one deliberately does not, and
 * the reason was measured rather than reasoned: React 19 implements a form
 * `action` by calling `new FormData(formElement)`, and **Node's `FormData`
 * does not accept an element** — the login screen's submit test failed with
 * `TypeError: FormData constructor: Argument 1 could not be converted to:
 * undefined`. jsdom's `FormData` does accept one.
 *
 * The consistency argument in `doc/decision/0037-*` still stands for the
 * fetch/stream family, which is why the rest is replaced; it only bites when
 * one object is *passed* to another realm's constructor, and nothing here
 * builds a `Request` out of a `FormData` — the oRPC calls in these tests send
 * JSON.
 */

const JSDOMEnvironment = require('jest-environment-jsdom').default;

const WEB_GLOBALS = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextEncoder',
  'TextDecoder',
  'structuredClone',
  'AbortController',
  'AbortSignal',
];

class WebApiJSDOMEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);

    const unavailable = WEB_GLOBALS.filter((name) => globalThis[name] === undefined);
    if (unavailable.length > 0) {
      // Fail loudly rather than leave jsdom's half-set in place and let the
      // failure surface later as an unrelated-looking TypeError.
      throw new Error(
        `This Node runtime does not provide: ${unavailable.join(', ')}. ` +
          'jest-environment-web.cjs cannot give jsdom a consistent fetch implementation.'
      );
    }

    for (const name of WEB_GLOBALS) {
      this.global[name] = globalThis[name];
    }
  }
}

module.exports = WebApiJSDOMEnvironment;
