/**
 * The sign-out registry: what makes a sign-out outlive the cookie that carried
 * it.
 *
 * The property the whole design rests on is that `sub` names a **sign-in
 * session**, not a person — `@auth/core` mints a fresh UUID per sign-in — and
 * that re-encoding a session's cookie never changes it. So the tests below are
 * about membership, and there is deliberately **no clock in any accept/reject
 * assertion**: an earlier design keyed on `sub` plus an `iat` cutoff, and its
 * unsoundness (a refresh can push the encode into a later second than the
 * cutoff) is exactly what the set removes.
 *
 * The clock still appears, in the retention tests only, and only as garbage
 * collection.
 */

import { createSignOutRegistry, SignOutRevocationUnavailableError } from './revocation';
import { sharedRevokedStore } from './revocation';
import type { SignOutRegistry } from './revocation';

/** One sign-in session's subject. `@auth/core` shape: a UUID. */
const SESSION_A = '9efdd0ac-6b1e-4d0e-9a7d-2b5c1f0a3e11';
/** A *different* sign-in by the same human being. */
const SESSION_B = '15326704-0c8a-4a1f-8d33-7e9b2c4d6a02';
const RETENTION = 30 * 24 * 60 * 60;

/** A registry on a clock the test moves by hand. */
function registryAt(start: number): { registry: SignOutRegistry; setNow: (t: number) => void } {
  let current = start;
  const registry = createSignOutRegistry({
    retentionSeconds: RETENTION,
    now: () => current,
  });
  return { registry, setNow: (t) => (current = t) };
}

describe('createSignOutRegistry', () => {
  it('lets an untouched session through', () => {
    const { registry } = registryAt(1000);

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(false);
  });

  it('revokes the session that signed out', () => {
    const { registry } = registryAt(1000);

    registry.revoke({ sub: SESSION_A });

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(true);
  });

  it('revokes a token re-encoded at any later time, because `sub` survives re-encoding', () => {
    // The defect itself, and the reason there is no clock here. A render racing
    // the sign-out answers with a *newly encoded* token — new `jti`, new `iat`,
    // possibly a whole second later than the sign-out because a refresh round
    // trip ran in between — but the same `sub`. Membership does not care.
    const { registry, setNow } = registryAt(1000);

    registry.revoke({ sub: SESSION_A });
    setNow(1002);

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(true);
  });

  it('does not revoke a later sign-in by the same person', () => {
    // `@auth/core` mints a fresh `sub` per sign-in, so signing back in produces
    // a subject this registry has never seen. No "forget" step is needed, and
    // an earlier version of the code had one that could not fire.
    const { registry } = registryAt(1000);

    registry.revoke({ sub: SESSION_A });

    expect(registry.isRevoked({ sub: SESSION_B })).toBe(false);
  });

  it('fails closed on a token with no subject', () => {
    // Such a token can never be cleared from the set, so it can never be
    // honoured either. Nothing downstream would catch it: `isAuthorized` reads
    // `auth.user`, which Auth.js builds from `name`/`email`, and never `sub`.
    const { registry } = registryAt(1000);

    expect(registry.isRevoked({})).toBe(true);
    expect(registry.isRevoked({ sub: '' })).toBe(true);
  });

  it('records nothing for a token with no subject', () => {
    const { registry } = registryAt(1000);

    registry.revoke({});

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(false);
  });

  it('is idempotent', () => {
    const { registry } = registryAt(1000);

    registry.revoke({ sub: SESSION_A });
    registry.revoke({ sub: SESSION_A });

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(true);
  });

  // The boundary is retention, not token validity — those differ by δ + 15 s,
  // and `retentionSeconds`' docblock derives the difference. These two tests
  // assert the window the code actually implements.
  it('drops a revocation once the retention window has closed', () => {
    const { registry, setNow } = registryAt(1000);
    registry.revoke({ sub: SESSION_A });
    expect(registry.isRevoked({ sub: SESSION_A })).toBe(true);

    // Pruning happens on write, so a later sign-out by anyone is what sweeps.
    setNow(1000 + RETENTION);
    registry.revoke({ sub: SESSION_B });

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(false);
    expect(registry.isRevoked({ sub: SESSION_B })).toBe(true);
  });

  it('keeps a revocation for the whole retention window', () => {
    const { registry, setNow } = registryAt(1000);
    registry.revoke({ sub: SESSION_A });

    setNow(1000 + RETENTION - 1);
    registry.revoke({ sub: SESSION_B });

    expect(registry.isRevoked({ sub: SESSION_A })).toBe(true);
  });
});

describe('sharedRevokedStore', () => {
  const runtime = process.env['NEXT_RUNTIME'];
  afterEach(() => {
    if (runtime === undefined) delete process.env['NEXT_RUNTIME'];
    else process.env['NEXT_RUNTIME'] = runtime;
  });

  it('hands out one map for the whole process', () => {
    // Necessary but nowhere near sufficient: two calls into *one* module
    // instance. A module-level `const map = new Map()` passes this identically,
    // which is the whole point of the test below.
    expect(sharedRevokedStore()).toBe(sharedRevokedStore());
  });

  it('hands the same map to two independent module registries', () => {
    // **This is the test that pins the fix.** `doc/decision/0231-*` exists
    // because Next.js gives the proxy, the `/api/auth/*` handlers and the
    // server components each their own module registry, so a module-level map
    // would be three maps and sign-out would be enforced on none of the paths
    // that matter. Every other test in this file — and in `config.spec.ts` —
    // runs inside one registry, so none of them can tell "one map per module
    // registry" from "one map per realm", and the final review measured exactly
    // that: the whole body of `sharedRevokedStore` replaced by a module-level
    // `const Map` left 100/100 tests green.
    //
    // `jest.isolateModules` gives a fresh registry per call, which is the
    // closest thing in-process to what Next.js does. `Symbol.for` + `globalThis`
    // is what carries the map across; a module-level map would not survive it.
    let first: Map<string, number> | undefined;
    let second: Map<string, number> | undefined;

    jest.isolateModules(() => {
      first = jest
        .requireActual<typeof import('./revocation')>('./revocation')
        .sharedRevokedStore();
    });
    jest.isolateModules(() => {
      second = jest
        .requireActual<typeof import('./revocation')>('./revocation')
        .sharedRevokedStore();
    });

    expect(first).toBeDefined();
    expect(first).toBe(second);

    // Identity is the mechanism; this is the property it buys — a revocation
    // written by the bundle that handled the sign-out is read by the bundle
    // that does the authorizing.
    first?.set('probe-subject', 1);
    expect(second?.get('probe-subject')).toBe(1);
    second?.delete('probe-subject');
  });

  it('serves the Node.js runtime', () => {
    process.env['NEXT_RUNTIME'] = 'nodejs';

    expect(() => sharedRevokedStore()).not.toThrow();
  });

  it('refuses to boot on the Edge runtime rather than silently not enforcing', () => {
    // Edge gives each bundle its own isolate, so the cross-bundle sharing this
    // control depends on would stop happening — with no error and nothing
    // logged. That is precisely how the first implementation of this fix failed.
    // A boot failure is the correct direction for a security control.
    process.env['NEXT_RUNTIME'] = 'edge';

    expect(() => sharedRevokedStore()).toThrow(SignOutRevocationUnavailableError);
  });

  it('refuses a set-but-empty NEXT_RUNTIME rather than reading it as "not Next.js"', () => {
    // `''` is a variable that was *set*, to something that is not `nodejs`. An
    // earlier guard exempted it beside `undefined`, so the one value that looks
    // most like a misconfiguration was the one value that slipped through — a
    // security guard failing open on its most likely bad input.
    process.env['NEXT_RUNTIME'] = '';

    expect(() => sharedRevokedStore()).toThrow(SignOutRevocationUnavailableError);
  });

  it('serves a process where NEXT_RUNTIME is absent, which is not the same as blank', () => {
    // Jest is such a process, and so is any plain Node import of `libs/garage/auth`.
    // Absent means "not Next.js at all"; there is no non-Node runtime to refuse.
    delete process.env['NEXT_RUNTIME'];

    expect(() => sharedRevokedStore()).not.toThrow();
  });
});
