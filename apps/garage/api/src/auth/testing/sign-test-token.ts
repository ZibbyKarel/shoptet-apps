/**
 * Token minting for the auth tests — real RS256 signatures, real headers.
 *
 * Spec-only support code, excluded from `tsconfig.app.json`. See
 * `oidc-test-issuer.ts` for why the tests use genuine cryptography instead of
 * a stubbed verifier.
 */

import * as jwt from 'jsonwebtoken';
import type { TestSigningKey } from './oidc-test-issuer';

export interface TestTokenOptions {
  key: TestSigningKey;
  issuer: string;
  audience: string;
  subject: string;
  email?: string | undefined;
  name?: string | undefined;
  /** Seconds until expiry. Negative mints an already-expired token. */
  expiresInSeconds?: number;
  /** Overrides the `kid` in the header without changing the signing key. */
  kid?: string;
}

/** Signs a token the API should accept, unless an option is deliberately wrong. */
export function signTestToken(options: TestTokenOptions): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const lifetime = options.expiresInSeconds ?? 3600;

  return jwt.sign(
    {
      sub: options.subject,
      iss: options.issuer,
      aud: options.audience,
      iat: nowInSeconds - 60,
      exp: nowInSeconds + lifetime,
      ...(options.email === undefined ? {} : { email: options.email }),
      ...(options.name === undefined ? {} : { name: options.name }),
    },
    options.key.privateKey,
    { algorithm: 'RS256', keyid: options.kid ?? options.key.kid }
  );
}

/**
 * An unsigned token whose header claims `alg: none`.
 *
 * Hand-assembled rather than minted with a library, because the attack this
 * pins is precisely a client sending bytes no honest library would produce.
 */
export function forgeUnsignedToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
}
