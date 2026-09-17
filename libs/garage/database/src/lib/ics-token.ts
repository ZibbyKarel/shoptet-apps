/**
 * Fresh ICS feed tokens for the development seed.
 *
 * ## Why this exists at all
 *
 * `seed-data.ts` used to carry four of them as literals — sequential,
 * UUID-shaped, and committed:
 *
 * ```
 * icsToken: '019917a0-0000-7000-8000-000000000001'   // …0002, …0003, …0004
 * ```
 *
 * `GET /api/calendar/:icsToken.ics` is `@Public()` by design: the token *is*
 * the credential. So those four lines published every seeded account's whole
 * reservation calendar to anyone who had read the repository, and
 * `doc/decision/0080-*` — which makes a wrong token's 404 indistinguishable
 * from an unrouted 404, so tokens cannot be enumerated — protected nothing for
 * them, because they needed no enumerating. The final review raised it as its
 * only Critical; see
 * `doc/decision/0275-the-development-seed-generates-its-ics-tokens.md`.
 *
 * ## Why base64url and not hex
 *
 * `apps/garage/api/src/auth/auth-user.service.ts` mints a real token as
 * `randomBytes(32).toString('base64url')`, and `me.service.ts` regenerates it
 * the same way. A seeded account whose token is the *shape* of a real one is
 * one fewer difference between the development database and a real one — and
 * shape is exactly what an ICS token is, since nothing parses it. The entropy
 * is identical either way: 32 bytes from the platform CSPRNG.
 *
 * This is duplicated rather than imported because `libs/garage/database` is a lib and
 * `apps/garage/api` is an application: the dependency only runs the other way. Three
 * lines, and `ics-token.spec.ts` pins the shape both sides produce.
 */

import { randomBytes } from 'node:crypto';

/**
 * Bytes of entropy in a seeded `icsToken`, matching `ICS_TOKEN_BYTES` in
 * `apps/garage/api/src/auth/auth-user.service.ts`.
 */
export const SEED_ICS_TOKEN_BYTES = 32;

/**
 * A new feed token. `randomBytes` (CSPRNG), never `Math.random`, and never a
 * value that could be written down in a file.
 */
export function generateSeedIcsToken(): string {
  return randomBytes(SEED_ICS_TOKEN_BYTES).toString('base64url');
}
