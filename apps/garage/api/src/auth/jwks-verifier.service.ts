/**
 * Signature verification against the issuer's JWKS — the reusable half of auth.
 *
 * The HTTP side reaches this through `JwtStrategy` (`passport-jwt` calls
 * {@link JwksVerifierService.getSigningKey} as its `secretOrKeyProvider`); the
 * Socket.io gateway in Task 15 cannot run a Passport HTTP strategy on a
 * handshake, so it calls {@link JwksVerifierService.verifyToken} directly. Both
 * paths share one `JwksClient` — one cache, one rate limiter, one rotation
 * behaviour — and one `jwtVerifyOptions`.
 *
 * ## Three properties this class is responsible for
 *
 * 1. **Nothing is trusted before the signature verifies.** The only part of an
 *    unverified token read here is the JOSE header (`kid`, `alg`), which is
 *    unavoidable: you cannot pick a key without knowing which key was claimed.
 *    The header is used to *look up* a key, never to decide anything. `alg` is
 *    checked against {@link ACCEPTED_JWT_ALGORITHMS} before a key is fetched,
 *    so `{"alg":"none"}` and an HMAC-with-the-public-key forgery are refused
 *    without touching the network (`jsonwebtoken` would refuse them again).
 * 2. **A cache miss is never an auth bypass.** Every failure path below throws.
 *    There is no branch that returns a token as valid because a key could not
 *    be fetched, and `cacheMaxAgeFallback` (jwks-rsa's "serve a stale key while
 *    the endpoint is down" option) is deliberately not enabled — see
 *    `doc/decision/0043-*`.
 * 3. **A failure is diagnosable from the logs and opaque to the caller.** Every
 *    rejection here reaches the client as the same bare 401 — that is
 *    deliberate, and unchanged. But the four *operator* problems behind it (a
 *    dead issuer, a mistyped `AUTH_OKTA_ISSUER`, a rejected discovery document,
 *    an exhausted JWKS rate limit) are genuinely different, and used to be
 *    indistinguishable in the logs because this class rethrew silently and
 *    Passport's `fail(info)` path discards `info`. They are now reported
 *    through `nestjs-pino`, classified by {@link AuthFailureKind} and rate
 *    limited by {@link FailureLogThrottle} — see {@link reportFailure} for the
 *    level and volume reasoning.
 *
 *    **No secret or token is ever logged.** A line carries the failure kind,
 *    the configured issuer, a truncated `kid`, and the underlying error's
 *    *message*. The raw JWT is never passed to the logger, no `Error` object is
 *    either, and `buildLoggerOptions` redacts `authorization` on the request
 *    side.
 *
 * ## Why discovery, not a hardcoded `/v1/keys`
 *
 * Okta serves its JWKS at `${issuer}/v1/keys`; `mock-oauth2-server` serves it
 * at `${issuer}/jwks`. A hardcoded suffix would work in exactly one of dev and
 * production, which would break the "same code, only the env value differs"
 * rule the moment it was deployed. The `jwks_uri` therefore comes from the
 * issuer's own OIDC discovery document, resolved **lazily** (a constructor
 * fetch would make module boot depend on the IdP being reachable) and cached
 * for the process lifetime.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtHeader } from 'jsonwebtoken';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as z from 'zod';
import type { ApiEnv } from '../env';
import { FailureLogThrottle } from './failure-log-throttle';
import type { JwtVerificationRules } from './jwt-verify-options';
import { ACCEPTED_JWT_ALGORITHMS, jwtVerifyOptions } from './jwt-verify-options';
import type { AuthTokenClaims } from './token-claims';
import { authTokenClaimsSchema } from './token-claims';

/** Path appended to the issuer to reach its OIDC discovery document (RFC 8414). */
const OIDC_DISCOVERY_PATH = '/.well-known/openid-configuration';

/**
 * Why a key could not be produced. This is the operator-facing classification —
 * the *caller* sees the same 401 for all of them.
 *
 * The first four are server-side: something is wrong with the deployment or the
 * IdP, nobody can log in, and an operator has to act. The last two are
 * caller-side: somebody sent a token this API was never going to accept, which
 * is normal background noise on a public endpoint.
 */
export const AUTH_FAILURE_KINDS = [
  /** The discovery endpoint could not be reached, or did not answer 2xx. */
  'issuer-unreachable',
  /** It answered, but the document is not one we may trust. */
  'discovery-rejected',
  /** Discovery succeeded; fetching the JWKS itself failed. */
  'jwks-unavailable',
  /** Too many JWKS fetches in a minute — see `JWKS_REQUESTS_PER_MINUTE`. */
  'jwks-rate-limited',
  /** The JWKS was fetched and contains no key with the token's `kid`. */
  'signing-key-not-found',
  /** Not a JWT, or a header asking for an algorithm we do not accept. */
  'malformed-token',
] as const;

export type AuthFailureKind = (typeof AUTH_FAILURE_KINDS)[number];

/**
 * How long one kind of failure stays quiet after being logged.
 *
 * An IdP outage sends every request down this path, so a line per request would
 * be a flood. One line a minute per kind, carrying the count of everything it
 * swallowed, tells an operator both what broke and how hard.
 */
const AUTH_FAILURE_LOG_INTERVAL_MS = 60_000;

/** Longest `kid` echoed into a log line. It is attacker-controlled input. */
const MAX_LOGGED_KID_LENGTH = 64;

/**
 * A key lookup that failed, carrying why.
 *
 * The `kind` is what makes the four operator-actionable cases distinguishable
 * in the logs. The message is developer-facing; it never reaches the client,
 * because Passport turns any rejection here into a bare `UnauthorizedException`.
 */
export class JwksVerificationError extends Error {
  constructor(
    readonly kind: AuthFailureKind,
    message: string
  ) {
    super(message);
    this.name = 'JwksVerificationError';
  }
}

/**
 * How long a fetch of the discovery document or the JWKS may take. Short on
 * purpose: an unreachable IdP must fail the request quickly rather than hold a
 * connection open until the client gives up.
 */
const JWKS_REQUEST_TIMEOUT_MS = 5_000;

/**
 * How long a signing key is reused before it is fetched again.
 *
 * Rotation does **not** depend on this expiring. `jwks-rsa` memoises per `kid`
 * and does not cache failures, so a token signed with a *new* `kid` is a cache
 * miss and triggers an immediate refetch — a rotated key is picked up on the
 * first request that uses it, not up to ten minutes later. This TTL only bounds
 * how long a *withdrawn* key stays usable.
 */
const JWKS_CACHE_MAX_AGE_MS = 600_000;

/** How many distinct `kid`s are kept. An issuer publishes a handful at most. */
const JWKS_CACHE_MAX_ENTRIES = 5;

/**
 * Ceiling on JWKS fetches per minute.
 *
 * Because an unknown `kid` is a cache miss, an unauthenticated caller could
 * otherwise make the API hammer the IdP by presenting tokens with random `kid`s.
 * When the limit is hit `jwks-rsa` raises an error, so the request is rejected —
 * the failure mode is "some logins fail during a flood", never "a token is
 * accepted without a key".
 */
const JWKS_REQUESTS_PER_MINUTE = 12;

/**
 * The two fields of the discovery document this application uses. Loose, like
 * every other document an external system owns: an issuer adding metadata must
 * not break authentication.
 */
const discoveryDocumentSchema = z.looseObject({
  issuer: z.string().min(1),
  jwks_uri: z.url(),
});

/** Trailing slashes are insignificant in a URL prefix; `iss` comparison is not. */
function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Classifies whatever `jwks-rsa` (or this class) threw.
 *
 * `jwks-rsa` marks endpoint failures with `isEndpointUnavailable` and names its
 * other two error classes, which is enough to tell "the JWKS could not be
 * fetched" from "we fetched it and your `kid` is not in it" from "you are
 * asking too often". Anything unrecognised is treated as an endpoint problem
 * rather than a caller problem, because the alternative — logging a genuine
 * outage at `debug` — is the failure this classification exists to prevent.
 */
function asVerificationError(error: unknown): JwksVerificationError {
  if (error instanceof JwksVerificationError) {
    return error;
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'JwksRateLimitError') {
    return new JwksVerificationError('jwks-rate-limited', message);
  }
  if (name === 'SigningKeyNotFoundError') {
    return new JwksVerificationError('signing-key-not-found', message);
  }
  return new JwksVerificationError('jwks-unavailable', message);
}

@Injectable()
export class JwksVerifierService {
  private readonly issuer: string;
  private readonly verifyOptions: JwtVerificationRules;

  /**
   * Memoised client. `null` while unresolved *or* after a failed attempt: a
   * transient discovery outage must not leave every later request inheriting
   * one rejected promise.
   */
  private clientPromise: Promise<JwksClient> | null = null;

  /** One log line per failure kind per minute. See {@link reportFailure}. */
  private readonly failureLog = new FailureLogThrottle<AuthFailureKind>(
    AUTH_FAILURE_LOG_INTERVAL_MS
  );

  constructor(
    configService: ConfigService<ApiEnv, true>,
    @InjectPinoLogger(JwksVerifierService.name) private readonly logger: PinoLogger
  ) {
    this.issuer = configService.get('AUTH_OKTA_ISSUER', { infer: true });
    this.verifyOptions = jwtVerifyOptions({
      AUTH_OKTA_ISSUER: this.issuer,
      AUTH_OKTA_AUDIENCE: configService.get('AUTH_OKTA_AUDIENCE', { infer: true }),
    });
  }

  /**
   * The options both verification paths use. Exposed so `JwtStrategy` can
   * spread the *same object* into its `passport-jwt` configuration instead of
   * rebuilding an equivalent one.
   */
  get options(): JwtVerificationRules {
    return this.verifyOptions;
  }

  /**
   * Resolves the PEM public key a raw token claims to be signed with.
   *
   * This is `passport-jwt`'s `secretOrKeyProvider` in method form. It rejects —
   * it never returns a fallback key — when the header is unreadable, the
   * algorithm is not allow-listed, the issuer is unreachable, or no published
   * key matches the `kid`.
   *
   * It is also the **single chokepoint both transports pass through**, which is
   * why the failure reporting lives here rather than in the guard or the
   * gateway: an operator gets the same diagnosis whether the token arrived on an
   * HTTP request or a Socket.io handshake.
   */
  async getSigningKey(rawToken: string): Promise<string> {
    let kid: string | undefined;
    try {
      const header = this.readHeader(rawToken);
      kid = header.kid;
      const client = await this.getClient();
      const key = await client.getSigningKey(header.kid);
      return key.getPublicKey();
    } catch (error) {
      const failure = asVerificationError(error);
      this.reportFailure(failure, kid);
      throw failure;
    }
  }

  /**
   * Verifies a raw token end to end and returns its parsed claims.
   *
   * Signature, issuer, audience and expiry are all checked here, by
   * `jsonwebtoken` against {@link options}. Task 15's Socket.io handshake calls
   * this; the HTTP path reaches the identical checks through `passport-jwt`,
   * which is handed the same options object.
   */
  async verifyToken(rawToken: string): Promise<AuthTokenClaims> {
    const key = await this.getSigningKey(rawToken);
    const payload = await new Promise<unknown>((resolve, reject) => {
      jwt.verify(rawToken, key, this.verifyOptions, (error, decoded) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(decoded);
      });
    });
    return authTokenClaimsSchema.parse(payload);
  }

  /**
   * Reads the JOSE header of an unverified token.
   *
   * `jwt.decode` performs no verification, which is why the only things taken
   * from its result are `kid` (a cache lookup key) and `alg` (checked against
   * the allow-list immediately). The payload is not read here at all.
   */
  private readHeader(rawToken: string): JwtHeader {
    const decoded = jwt.decode(rawToken, { complete: true });
    if (decoded === null) {
      throw new JwksVerificationError(
        'malformed-token',
        'The bearer token is not a well-formed JWT.'
      );
    }
    const { header } = decoded;
    if (!(ACCEPTED_JWT_ALGORITHMS as readonly string[]).includes(header.alg)) {
      // Refused before a key is fetched. `alg: none` and `alg: HS256` (signed
      // with the public key an attacker downloaded from the JWKS endpoint) both
      // land here.
      throw new JwksVerificationError(
        'malformed-token',
        `Unsupported token signature algorithm: ${header.alg}`
      );
    }
    return header;
  }

  private getClient(): Promise<JwksClient> {
    this.clientPromise ??= this.buildClient().catch((error: unknown) => {
      this.clientPromise = null;
      throw error;
    });
    return this.clientPromise;
  }

  private async buildClient(): Promise<JwksClient> {
    const jwksUri = await this.discoverJwksUri();
    this.logger.info({ jwksUri }, 'Resolved the issuer JWKS endpoint');
    return new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cacheMaxEntries: JWKS_CACHE_MAX_ENTRIES,
      rateLimit: true,
      jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
      timeout: JWKS_REQUEST_TIMEOUT_MS,
      // `cacheMaxAgeFallback` is intentionally unset: it keeps serving a stale
      // key while the JWKS endpoint is unreachable, which is precisely the
      // window in which a revoked key would still be trusted.
    });
  }

  /**
   * Fetches and validates the issuer's OIDC discovery document.
   *
   * Two checks beyond "it parsed", both of which matter:
   *
   * - the document's own `issuer` must equal the configured one, so a
   *   misconfigured `AUTH_OKTA_ISSUER` fails loudly at the first request
   *   instead of validating tokens against some other tenant's keys;
   * - `jwks_uri` must live on the same origin as the issuer, so a tampered or
   *   mistaken document cannot redirect key material to a third party.
   */
  private async discoverJwksUri(): Promise<string> {
    const discoveryUrl = `${withoutTrailingSlash(this.issuer)}${OIDC_DISCOVERY_PATH}`;

    // `issuer-unreachable` and `discovery-rejected` are separated here because
    // they need different actions: the first is "the IdP is down or the URL is
    // wrong", the second is "the IdP answered and we refused what it said".
    let response: Response;
    try {
      response = await fetch(discoveryUrl, {
        signal: AbortSignal.timeout(JWKS_REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new JwksVerificationError(
        'issuer-unreachable',
        `OIDC discovery at ${discoveryUrl} could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (!response.ok) {
      throw new JwksVerificationError(
        'issuer-unreachable',
        `OIDC discovery at ${discoveryUrl} answered HTTP ${response.status}.`
      );
    }

    const parsed = discoveryDocumentSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new JwksVerificationError(
        'discovery-rejected',
        `OIDC discovery at ${discoveryUrl} is not a usable document (needs "issuer" and "jwks_uri").`
      );
    }
    const document = parsed.data;

    if (withoutTrailingSlash(document.issuer) !== withoutTrailingSlash(this.issuer)) {
      throw new JwksVerificationError(
        'discovery-rejected',
        `OIDC discovery at ${discoveryUrl} declares issuer "${document.issuer}", ` +
          `which does not match AUTH_OKTA_ISSUER.`
      );
    }
    if (new URL(document.jwks_uri).origin !== new URL(this.issuer).origin) {
      throw new JwksVerificationError(
        'discovery-rejected',
        `OIDC discovery at ${discoveryUrl} points jwks_uri at a different origin.`
      );
    }

    return document.jwks_uri;
  }

  /**
   * Turns a classified failure into at most one log line per minute.
   *
   * ## Level
   *
   * The four server-side kinds are `error`: nobody can log in, and every one of
   * them needs a human. A `warn` would be defensible for a transient outage, but
   * `discovery-rejected` in particular is a permanent misconfiguration that will
   * never heal on its own, and splitting the four across two levels would mean
   * an operator has to know which is which before they can find any of them.
   *
   * The two caller-side kinds are `debug`. A malformed bearer token and a `kid`
   * from another issuer are what a public endpoint receives all day; they are
   * not defects, nobody acts on them, and at the default `LOG_LEVEL=info` they
   * cost nothing. Logging them at `warn` would also hand an anonymous caller a
   * cheap way to fill the log — the same reasoning `ContractExceptionFilter`
   * already applies to an oversized request body.
   *
   * ## Volume
   *
   * `FailureLogThrottle` emits the first occurrence of a kind immediately and
   * then stays quiet for {@link AUTH_FAILURE_LOG_INTERVAL_MS}, counting what it
   * swallowed and attaching the count to the next line that gets through. So an
   * IdP outage produces one line a minute reading
   * `suppressedSinceLastLog: 4127` rather than 4127 lines — the operator learns
   * both the cause and the blast radius. The throttle is keyed by kind only,
   * never by anything a caller controls, so its map is bounded at six entries.
   *
   * ## What is in the line
   *
   * The kind, the configured issuer, a truncated `kid`, and the underlying
   * error's *message*. Deliberately **no `err` object** — the stack adds nothing
   * an operator can act on here and would be repeated every minute for the
   * duration of an outage; this follows the same call `doc/decision/0035-*` made
   * for the readiness probe. And, of course, no token: the raw JWT is never
   * passed to the logger on any path.
   */
  private reportFailure(failure: JwksVerificationError, kid: string | undefined): void {
    const { shouldLog, suppressedSinceLastLog } = this.failureLog.record(failure.kind);
    if (!shouldLog) {
      return;
    }

    const context = {
      authFailure: failure.kind,
      issuer: this.issuer,
      reason: failure.message,
      ...(kid === undefined ? {} : { kid: kid.slice(0, MAX_LOGGED_KID_LENGTH) }),
      ...(suppressedSinceLastLog > 0 ? { suppressedSinceLastLog } : {}),
    };

    if (failure.kind === 'malformed-token' || failure.kind === 'signing-key-not-found') {
      this.logger.debug(context, 'Rejected a token this API cannot verify');
      return;
    }
    this.logger.error(context, 'Cannot verify tokens — the issuer or its JWKS is unusable');
  }
}
