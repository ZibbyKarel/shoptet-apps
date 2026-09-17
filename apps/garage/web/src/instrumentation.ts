/**
 * Next.js calls `register()` exactly once, when a new server instance is
 * initiated (`next dev` / `next start`, in both the Node.js and Edge
 * runtimes) — before any request is handled. That makes it the right place
 * for fail-fast environment validation: a missing or malformed variable
 * crashes the process here, with a readable message, instead of failing
 * later inside a component or route handler.
 *
 * The actual validation lives in `./instrumentation-node`, loaded only for
 * the Node.js runtime via the pattern Next.js documents for runtime-specific
 * instrumentation code — it uses `process.exit`, which does not exist in the
 * Edge runtime, so it must not be statically bundled into the edge chunk.
 *
 * See `doc/decision/0008-web-env-validation-instrumentation-hook.md` for why
 * this lives here rather than in `next.config.ts`.
 */
export async function register(): Promise<void> {
  // The env schema only covers server-side/Node.js concerns (Auth.js
  // secrets, the Okta issuer, the API base URL) — nothing the Edge runtime
  // needs, so we skip validation there rather than pulling `zod` into an
  // Edge bundle for no reason.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
