/**
 * The **one** set of JWT verification rules in this application.
 *
 * Two callers verify tokens — the `passport-jwt` strategy on the HTTP side and
 * `JwksVerifierService.verifyToken()` (which the Socket.io gateway in Task 15
 * uses, because a Passport HTTP strategy cannot run on a WebSocket handshake).
 * Both must apply *identical* rules, so the rules are built once here and
 * `JwtStrategy` spreads the very object the verifier holds, rather than
 * constructing an equivalent one.
 *
 * ### The trap this shape exists to avoid
 *
 * `passport-jwt` builds its verification options as
 *
 * ```js
 * assign({}, options.jsonWebTokenOptions, {
 *   audience: options.audience, issuer: options.issuer,
 *   algorithms: options.algorithms, ignoreExpiration: !!options.ignoreExpiration,
 * })
 * ```
 *
 * — the four explicit keys **overwrite** whatever `jsonWebTokenOptions`
 * contained, with `undefined` if they were not passed at the top level. Passing
 * these rules only as `jsonWebTokenOptions` therefore silently disables issuer
 * *and* audience checking. {@link JwtVerificationRules} uses exactly the key
 * names `passport-jwt` reads at the top level and `jsonwebtoken.verify`
 * accepts, and carries no others, so one object spreads correctly into both.
 * `auth-pipeline.spec.ts` proves it by rejecting a wrong-issuer and a
 * wrong-audience token through the real stack.
 */

import type { Algorithm } from 'jsonwebtoken';
import type { ApiEnv } from '../env';

/**
 * Signature algorithms accepted. An allow-list, never a default: without it,
 * `jsonwebtoken` would accept any algorithm the token's own header asks for —
 * including `none`, and including HMAC, where the "verification key" would be
 * the RSA *public* key an attacker can simply download from the JWKS endpoint.
 */
export const ACCEPTED_JWT_ALGORITHMS = ['RS256'] as const satisfies Algorithm[];

/**
 * Exactly the four rules, and nothing else.
 *
 * Structurally assignable to `jsonwebtoken`'s `VerifyOptions` and spreadable
 * into `passport-jwt`'s `StrategyOptions`. Deliberately *not* `VerifyOptions`
 * itself: a wider type would let a future edit smuggle in `clockTolerance` or
 * `ignoreNotBefore` on one path only.
 */
export interface JwtVerificationRules {
  algorithms: Algorithm[];
  issuer: string;
  audience: string;
  /**
   * Stated rather than left to the default, because it is the one rule whose
   * accidental flip would be invisible in every test that uses a fresh token.
   */
  ignoreExpiration: false;
}

/** The environment this application validates tokens against. */
export type JwtIssuerConfig = Pick<ApiEnv, 'AUTH_OKTA_ISSUER' | 'AUTH_OKTA_AUDIENCE'>;

/**
 * Builds the verification rules for the configured issuer.
 *
 * Only the values differ between dev, e2e and production: dev and e2e point
 * `AUTH_OKTA_ISSUER` at `mock-oauth2-server`, production at the Okta org. There
 * is no branch on `NODE_ENV` anywhere in this file or its callers.
 *
 * No `clockTolerance` is set. This is a single-instance deployment on an
 * NTP-synchronised host; a tolerance is a window in which an expired token is
 * still accepted, and there is no observed skew problem to trade it for.
 */
export function jwtVerifyOptions(env: JwtIssuerConfig): JwtVerificationRules {
  return {
    algorithms: [...ACCEPTED_JWT_ALGORITHMS],
    issuer: env.AUTH_OKTA_ISSUER,
    audience: env.AUTH_OKTA_AUDIENCE,
    ignoreExpiration: false,
  };
}
