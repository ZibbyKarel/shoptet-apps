import { resolve } from 'node:path';
import type { NextConfig } from 'next';

/**
 * The wishlist board's Next.js configuration.
 *
 * This is a scaffold: it carries only what a hello world genuinely needs plus
 * the two settings that are expensive to add later because other files are
 * written against them (`output` and `outputFileTracingRoot`, which together
 * decide the layout a Dockerfile would copy from).
 *
 * **Deliberately absent**, and to be taken from `apps/garage/web/next.config.ts`
 * when this app grows the corresponding surface — not invented afresh:
 * the security-header block (CSP, `X-Frame-Options`, `Referrer-Policy`) and
 * `poweredByHeader: false`. They are omitted rather than copied because that
 * file's CSP is reasoned about *its* auth flow and API origin, and a header
 * set copied without that reasoning is the kind of thing that reads strict and
 * stops nothing. This app is not deployed yet.
 *
 * Validation does not happen here for the same reason it does not there: Nx's
 * `@nx/next` plugin loads this file to infer project-graph metadata, so
 * anything that throws would break `lint`, `typecheck` and `graph` whenever a
 * runtime `.env` is absent.
 */
const nextConfig: NextConfig = {
  // Emit `.next/standalone` — a self-contained server plus only the traced
  // node_modules files. Set now because the alternative is discovering at
  // image-build time that the whole workspace `node_modules` has to ship.
  output: 'standalone',

  // Where tracing starts. This app has no node_modules of its own — they are
  // hoisted to the workspace root — so a trace rooted here would miss all of
  // them. Three levels up from `apps/wishlist/web`, the same depth as
  // `apps/garage/web`. Stating it also silences Next.js's root inference,
  // which walks up for a lockfile and would land in the same place.
  outputFileTracingRoot: resolve(__dirname, '..', '..', '..'),
};

export default nextConfig;
