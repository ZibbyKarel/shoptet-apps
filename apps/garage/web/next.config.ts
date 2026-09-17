import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Environment validation deliberately does NOT happen here. `next.config.ts`
// is also loaded by Nx's `@nx/next` plugin to infer project graph metadata
// (e.g. for `lint`/`typecheck`/`graph`), so anything that throws in this file
// would break those commands whenever a full runtime `.env` isn't present.
// Fail-fast validation instead lives in `src/instrumentation.ts`'s
// `register()`, which Next.js calls only when an actual server instance
// boots (`next dev` / `next start`) — see `doc/decision/0008-*` and
// `doc/environment.md`.

/**
 * The Content-Security-Policy, and what it deliberately leaves out.
 *
 * Every directive here is one that **cannot** break this application, and that
 * is the whole design of it. `frame-ancestors 'none'` is the clickjacking
 * control the review asked for; `base-uri 'self'` stops an injected `<base>`
 * from re-pointing every relative URL on the page; `object-src 'none'` retires
 * the plugin surface; `form-action 'self'` keeps a form from posting anywhere
 * else (the Okta hand-off is a navigation, not a form post, so the sign-in flow
 * is unaffected).
 *
 * There is **no `default-src`, `script-src`, `style-src` or `connect-src`**,
 * and that is a decision rather than an oversight — see
 * `doc/decision/0259-*`:
 *
 * - Next.js injects its own inline bootstrap and RSC-payload `<script>` tags
 *   into every document. A `script-src` without a per-request nonce would have
 *   to carry `'unsafe-inline'` to keep them working, which is a policy that
 *   reads strict and stops nothing.
 * - A real nonce has to be minted per request in middleware — and this app's
 *   middleware is `src/proxy.ts`, which is where authentication is decided.
 *   Threading a nonce through it is a change to the auth path, not a header
 *   tweak, and is not something to do in a fix round.
 * - `connect-src` would have to name the API origin, and `headers()` is
 *   resolved into the routes manifest at **build** time while
 *   `NEXT_PUBLIC_API_URL` is supplied at run time. A policy baked from the
 *   build environment would silently refuse every oRPC call and the Socket.io
 *   handshake in any deployment whose API origin differs from the builder's.
 *
 * So this is the subset that is worth having without a nonce pipeline, stated
 * honestly, with the upgrade path written down.
 */
const CONTENT_SECURITY_POLICY = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  // The legacy companion to `frame-ancestors`, for anything that does not read
  // CSP yet. The two say the same thing; browsers that understand both prefer
  // the CSP.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The origin travels cross-site, the path never does. A reservation URL
  // carries a date and nothing secret, but the referrer is the classic way a
  // path ends up in somebody else's logs.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
] as const;

const nextConfig: NextConfig = {
  // The framework and its version are not the attacker's to have for free.
  poweredByHeader: false,

  // Applied to every response the app serves, `/api/*` included: an
  // `X-Content-Type-Options` on the HTML and not on the JSON would be the half
  // of this worth the least.
  headers: async () => [{ source: '/:path*', headers: [...SECURITY_HEADERS] }],

  // Emit `.next/standalone` — a self-contained server plus only the
  // node_modules files the build actually traced. That is what
  // `apps/garage/web/Dockerfile` copies; without it the image would have to carry the
  // whole workspace `node_modules` (an order of magnitude larger, and full of
  // build tooling a running server must not have).
  //
  // It is additive: `.next/` keeps everything it had, so `nx run web:start`
  // (`next start`) and the Playwright suite that depends on it are unaffected.
  output: 'standalone',

  // Where tracing starts. This is an Nx monorepo: `apps/garage/web` has no
  // node_modules of its own, they are hoisted to the workspace root, and a
  // trace rooted at `apps/garage/web` would silently miss every one of them. Next.js
  // infers a root by walking up for a lockfile and would land here anyway —
  // stating it removes the inference (and the warning it prints) and makes the
  // resulting `.next/standalone/apps/garage/web/server.js` layout the Dockerfile
  // copies from a documented fact rather than an observed one.
  outputFileTracingRoot: resolve(__dirname, '..', '..', '..'),
};

export default nextConfig;
