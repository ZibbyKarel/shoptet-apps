/**
 * The claim set the API is willing to read out of a **verified** access token.
 *
 * ## Why this schema is not in `libs/garage/contract`
 *
 * Global constraint 1 puts every FE↔BE shape in the contract. This is not one:
 * these claims are minted by the identity provider and travel issuer→BE. The
 * frontend never constructs, reads or types against them — it receives a
 * session from Auth.js and forwards the opaque bearer token. Putting an Okta
 * claim set in the shared contract would invite the frontend to depend on the
 * IdP's token format, which is exactly the coupling the contract exists to
 * prevent.
 *
 * ## Why it is validated at all
 *
 * `jsonwebtoken.verify` returns `string | JwtPayload`, where `JwtPayload` is
 * `{ [key: string]: any }`. Everything downstream — the `oktaId` we provision
 * against above all — would otherwise be `any`. Parsing here is what turns a
 * verified-but-untyped blob into a value the provisioning code can trust.
 *
 * **Order matters:** nothing in this file may be read before the signature has
 * been checked. `JwksVerifierService` parses *after* `jsonwebtoken.verify`
 * resolves, and the only thing it reads from an unverified token is the JOSE
 * header's `kid`/`alg` (which it needs in order to find the key at all).
 */

import * as z from 'zod';

/**
 * A loose object on purpose: an OIDC access token carries a dozen claims we
 * have no interest in (`scp`, `jti`, `ver`, `cid`, …), and rejecting a token
 * because the IdP added a field would be a self-inflicted outage. Only the
 * claims the API actually consumes are declared, and each is checked.
 *
 * `iss`, `aud` and `exp` are deliberately **absent**: they are enforced by
 * `jsonwebtoken.verify` against `jwtVerifyOptions`, before this schema ever
 * runs. Re-declaring them here as plain strings would look like validation
 * while checking nothing.
 */
export const authTokenClaimsSchema = z.looseObject({
  /**
   * The subject. This is the value stored as `User.oktaId` — the identity the
   * application provisions against, never the email.
   */
  sub: z.string().min(1),

  /**
   * Company email. Optional because a token minted without the `email` scope
   * simply does not carry it, and an *already provisioned* caller (matched by
   * `sub`) does not need it. A caller who is not yet provisioned and has no
   * email cannot be created — `AuthUserService` rejects that case explicitly
   * rather than inventing a placeholder address.
   */
  email: z.email().optional(),

  /** Display name. Falls back to the email when the IdP does not send it. */
  name: z.string().min(1).optional(),
});

export type AuthTokenClaims = z.infer<typeof authTokenClaimsSchema>;
