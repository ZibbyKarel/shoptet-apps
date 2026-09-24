/**
 * What makes a sign-out durable: a set of session subjects that have signed out,
 * consulted on every session read.
 *
 * ## Why this exists at all
 *
 * Under `strategy: 'jwt'` the session lives entirely in the cookie, and Auth.js
 * **re-issues that cookie on every request that reads the session** — every page
 * render, every RSC prefetch, every `auth()` call in the proxy. Observed on this
 * application (Task 33): one navigation to `/` was answered with three different
 * session cookies, each request carrying the one the previous response had set.
 *
 * That turns sign-out into a race it cannot reliably win. `POST
 * /api/auth/signout` clears the cookie, but any request already in flight
 * carrying the old cookie answers with a freshly issued one, and the browser
 * applies whichever `Set-Cookie` arrives last. The clear is not last whenever a
 * concurrent render finishes after it — which is what `doc/decision/0189-*`
 * observed under load.
 *
 * No amount of client-side ordering closes that: the application does not
 * control when Next.js's prefetcher issues a request, and it cannot cancel a
 * response already on the wire. And more fundamentally — **deleting a cookie is
 * not a revocation mechanism.** The token remains a valid, self-contained,
 * unexpired credential; the delete is only a request that the browser stop
 * presenting it. Even an ordering fix that won the race every time would leave
 * a copied cookie working. So the fix is to make the token itself invalid.
 *
 * ## Why the key is `sub`, and why that is enough
 *
 * `sub` here is **not** a stable per-person identifier, and the design depends
 * on it not being one. `@auth/core` sets the user id to a fresh
 * `crypto.randomUUID()` on every completed sign-in, deliberately ignoring the
 * provider's profile id:
 *
 * ```js
 * // @auth/core/lib/actions/callback/oauth/callback.js
 * const user = { ...userFromProfile, id: crypto.randomUUID(), … };
 * ```
 *
 * and `token.sub = user.id`. Measured live: the same persona signing in twice
 * through the real OIDC flow produced `sub` values `9efdd0ac…` then
 * `15326704…`.
 *
 * So `sub` identifies **one sign-in session**, not one person, and it survives
 * every re-encode of that session's cookie unchanged. Three consequences, all of
 * them load-bearing:
 *
 * - Revoking a `sub` ends exactly the session that signed out. Other devices,
 *   other browsers, and any later sign-in are untouched — they carry different
 *   subjects.
 * - The token a racing render re-installs carries the **same** `sub` as the one
 *   that signed out, however many times it has been re-encoded. So membership of
 *   this set is decided on a value the race cannot change.
 * - Nothing here compares clocks. An earlier design keyed on `sub` plus an `iat`
 *   cutoff, which was unsound: `iat` is stamped by `jose`'s `setIssuedAt()` at
 *   **encode** time, and a token refresh can run between the revocation check
 *   and that encode, so a racing render could emit `iat` in a later second than
 *   the cutoff and be honoured. A set has no window to lose.
 *
 * ## Scope, and the upgrade path
 *
 * The store is **in-process**, which is sound for the stated single-instance
 * deployment and nothing more — the same posture, and the same reasoning, as
 * `LockService` on the API side. One consequence, accepted deliberately and
 * recorded in `doc/decision/0230-*`: **a restart of the Next.js server forgets
 * every revocation**, so a token that survived a sign-out would work again after
 * a restart until it expires. Running more than one web instance would require
 * moving this behind a shared store (Redis, or a table); the interface below is
 * deliberately small enough that only this file changes.
 *
 * Nothing here is logged. No token value is ever passed to this module in the
 * first place — only `sub`.
 */

import { processGlobalMap } from './process-global';

/** The one field of an Auth.js JWT this module reads. */
export interface RevocableToken {
  /**
   * The session subject. `@auth/core` mints a fresh UUID per sign-in, so this
   * names a session, not a person — see the note above, which the whole design
   * rests on.
   */
  readonly sub?: string | undefined;
}

export interface SignOutRegistry {
  /** Records that this session has signed out. It is over from this point on. */
  readonly revoke: (token: RevocableToken) => void;
  /** True when this session has signed out, or cannot be identified at all. */
  readonly isRevoked: (token: RevocableToken) => boolean;
}

export interface SignOutRegistryOptions {
  /**
   * How long a revocation is kept, in seconds. Set to the session `maxAge`
   * (`createAuthConfig`, `DEFAULT_SESSION_MAX_AGE_SECONDS` = 30 days).
   *
   * This is the **only** thing the clock is used for. It is garbage collection,
   * never part of the accept/reject decision — which is exactly what the
   * previous `iat`-cutoff design got wrong.
   *
   * ### The boundary is not exact, and the direction matters
   *
   * This used to say the entry is dropped "once the revoked token could no
   * longer be valid anyway". Derive it instead of asserting it, and it does not
   * quite hold — the retention window closes **δ + 15 s before** the token does:
   *
   * - The entry is dropped at `revokedAt + retentionSeconds` (see `prune`).
   * - A token's `exp` is set from its **last re-encode**, not from the sign-in:
   *   Auth.js re-issues the cookie on every session read, so a render racing the
   *   sign-out by δ seconds carries `exp = revokedAt + δ + maxAge`.
   * - `@auth/core`'s `decode()` verifies with `clockTolerance: 15` (`jwt.js`),
   *   so that token is still accepted for a further 15 s past its own `exp`.
   *
   * With `retentionSeconds === maxAge`, the token outlives the entry that would
   * refuse it by `δ + 15` seconds. Widening retention would close it, and that
   * is deliberately not done, because the gap is not reachable: to use it a
   * holder must present a copied cookie **30 days** after the sign-out, and by
   * then its access token expired long ago and the renewal that would replace it
   * fails on a refresh token of the same age — which fails closed and signs out
   * (`doc/decision/0048-*`). The window buys a session that cannot make an
   * authenticated API call.
   *
   * Recorded rather than rounded off because the reasoning this file was
   * rewritten to escape was exactly this: a clock claim asserted instead of
   * derived.
   */
  readonly retentionSeconds: number;
  /** Clock seam, in Unix seconds. Used for retention only. */
  readonly now?: () => number;
  /**
   * Where the revocations live. Defaults to a private map, which is what a test
   * wants; the application passes {@link sharedRevokedStore} — see there for why
   * that is not optional in Next.js.
   */
  readonly revoked?: Map<string, number>;
}

const unixSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Thrown when this module is loaded somewhere it cannot work.
 *
 * A boot failure, on purpose. See {@link sharedRevokedStore}.
 */
export class SignOutRevocationUnavailableError extends Error {
  constructor(runtime: string) {
    super(
      // `''` is not a formatting accident and not a misconfiguration: it is what
      // Next.js inlines for the **browser** compilation
      // (`next/dist/build/define-env.js:79`), so naming it that way is the
      // diagnosis a reader needs. `"" runtime` would read as a bug in this
      // message instead.
      runtime === ''
        ? 'Sign-out revocation cannot work in a browser bundle (NEXT_RUNTIME is "", ' +
            'which is what Next.js inlines for the client compilation): it keeps per-process ' +
            'server state. Import @garage/auth/client from a client component, not ' +
            '@garage/auth (doc/decision/0231-*).'
        : `Sign-out revocation cannot work on the "${runtime}" runtime: it keeps ` +
            'per-process state, and the Edge runtime gives each bundle its own ' +
            'isolate. Serve apps/garage/web on the Node.js runtime (doc/decision/0100-*, ' +
            'doc/decision/0231-*).'
    );
    this.name = 'SignOutRevocationUnavailableError';
  }
}

/**
 * The one revocation map for the whole Node process.
 *
 * **The sharing is not defensive style; without it the feature does not work at
 * all.** `createAuth()` runs once per Next.js bundle, and a module-level `Map`
 * would give each of them a private one (`processGlobalMap` in
 * `./process-global` has the measurement). Observed here before the fix: the
 * sign-out event reached exactly one of the three registries, and every later
 * authorization check ran against a different, empty one. Sign-out looked
 * revoked from the endpoint that performed it and was honoured nowhere it
 * mattered.
 *
 * ### Why this throws rather than warns
 *
 * On the Edge runtime each bundle is a separate isolate with its own
 * `globalThis`, so the sharing above would stop happening — silently. The proxy
 * would go back to an empty registry and sign-out would stop being enforced on
 * the very path that enforces it, with no error and nothing logged. That is the
 * exact failure mode the first implementation of this fix had, and only an
 * end-to-end test caught it.
 *
 * A security control whose failure mode is "the property quietly does not hold"
 * must not be defended by a comment. Refusing to boot turns a silent disable
 * into an immediate, obvious failure, which is the correct direction here.
 *
 * ### Absent is permitted; blank is not
 *
 * Only `NEXT_RUNTIME` being **unset** is allowed through alongside `'nodejs'`,
 * and it has to be: this module also runs outside Next.js entirely — Jest, and
 * any plain Node process that imports `libs/garage/auth` — where the variable does not
 * exist and there is nothing to refuse.
 *
 * An **empty string is not that case**, and it is worth being precise about
 * where it comes from, because an earlier version of this comment guessed and
 * guessed wrong ("a variable someone set"). Measured, at
 * `node_modules/next/dist/build/define-env.js:79`:
 *
 * ```js
 * 'process.env.NEXT_RUNTIME': isEdgeServer ? 'edge' : isNodeServer ? 'nodejs' : ''
 * ```
 *
 * `''` is the value **Next.js itself inlines into the browser compilation** —
 * it is not a misconfiguration, it is the marker for "this bundle is the client
 * one". Refusing it is still right: a module that keeps per-process server
 * state has nothing to do in a browser, and `''` is not `nodejs`. But the
 * consequence is not "an odd environment variable failed loudly". It is: **if
 * the server/client entry-point boundary ever leaks — a client component
 * reaching for `@garage/auth` instead of `@garage/auth/client` — this
 * throws during module evaluation in the user's browser** rather than
 * degrading quietly. That is the direction this guard wants, and it is a louder
 * failure than the one the boundary tests (`client-boundary.spec.ts`) already
 * catch at build time. Measured on the committed build: `.next/static` contains
 * no `signed-out-sessions`, so no browser bundle carries this module today.
 *
 * An earlier version exempted `''` next to `undefined`, which made the value
 * Next.js stamps on every client bundle the one value that bypassed the check —
 * the guard failing open on the shape most likely to reach it. It is now
 * treated like any other non-Node value: it throws.
 */
export const sharedRevokedStore = processGlobalMap<number>(
  'signed-out-sessions',
  requireNodeRuntime
);

/** The guard above, as a function, so `processGlobalMap` can run it. */
function requireNodeRuntime(): void {
  const runtime = process.env['NEXT_RUNTIME'];
  if (runtime !== undefined && runtime !== 'nodejs') {
    throw new SignOutRevocationUnavailableError(runtime);
  }
}

/**
 * Builds a registry over a revocation map.
 *
 * The registry object itself is per Auth.js configuration; the *map* it reads is
 * whatever the caller supplies. `createAuthConfig` supplies
 * {@link sharedRevokedStore} so that every bundle Next.js builds sees the same
 * sign-outs; a test supplies nothing and gets a private map.
 */
export function createSignOutRegistry(options: SignOutRegistryOptions): SignOutRegistry {
  const { retentionSeconds, now = unixSeconds, revoked = new Map<string, number>() } = options;

  /**
   * Drops entries older than the retention window.
   *
   * Not quite "entries that can no longer refuse anything": that is true to
   * within `δ + 15 s`, and {@link SignOutRegistryOptions.retentionSeconds}
   * derives the difference and why it is left standing.
   *
   * Run on write rather than on a timer: a timer would keep the process alive
   * and would run forever in a test, and the map only grows on a sign-out —
   * which is exactly when this is called.
   */
  const prune = (current: number): void => {
    for (const [subject, revokedAt] of revoked) {
      if (revokedAt + retentionSeconds <= current) revoked.delete(subject);
    }
  };

  return {
    revoke: (token) => {
      const subject = token.sub;
      // A token with no subject cannot be recorded, and does not need to be:
      // `isRevoked` refuses it unconditionally.
      if (subject === undefined || subject === '') return;
      const current = now();
      prune(current);
      revoked.set(subject, current);
    },

    isRevoked: (token) => {
      const subject = token.sub;
      // Fails closed, and the asymmetry with `revoke` is the point: a token this
      // module cannot key is a token it can never clear, and this is a function
      // whose whole job is to refuse. Nothing downstream would catch it either
      // — `isAuthorized` tests `auth.user`, which Auth.js builds from `name` and
      // `email`, and never looks at `sub`. Unreachable in practice, since
      // `@auth/core` always sets a subject.
      if (subject === undefined || subject === '') return true;
      return revoked.has(subject);
    },
  };
}
