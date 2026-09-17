/**
 * The mechanism `sharedRevokedStore` and `sharedRefreshStates` are both built
 * on, tested where it now lives rather than twice through its two callers.
 *
 * The property that matters is the one the duplication was there to provide:
 * two independently created accessors for the same `name` reach the **same**
 * map, because the key is a registry symbol and the storage is `globalThis`.
 * That is what a second copy of a module in a second Next.js bundle looks like
 * from in here, and it cannot be observed any other way in a single process.
 */

import { processGlobalMap } from './process-global';

const NAME = 'process-global-spec';
const KEY = Symbol.for(`@garage/auth:${NAME}`);
// The second name one case needs, hoisted beside the first: the string and the
// symbol are derived from one source here, so they cannot drift apart, and the
// slot is cleared in `afterEach` rather than at the end of that case. An
// assertion that throws would skip an inline `delete` and leak a populated
// registry entry into every case after it.
const OTHER_NAME = 'process-global-spec-other';
const OTHER_KEY = Symbol.for(`@garage/auth:${OTHER_NAME}`);

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
  delete (globalThis as Record<symbol, unknown>)[OTHER_KEY];
});

describe('processGlobalMap', () => {
  it('hands back the same map on every call', () => {
    const access = processGlobalMap<number>(NAME);

    expect(access()).toBe(access());
  });

  it('shares one map between two accessors built separately — the whole point', () => {
    // Two `processGlobalMap` calls stand in for two copies of a module in two
    // Next.js bundles. A plain `Symbol()` key would give each a private slot,
    // which is the failure this exists to prevent.
    const first = processGlobalMap<number>(NAME);
    const second = processGlobalMap<number>(NAME);

    first().set('a', 1);

    expect(second().get('a')).toBe(1);
    expect(second()).toBe(first());
  });

  it('keys the storage under the namespaced registry symbol', () => {
    processGlobalMap<number>(NAME)().set('a', 1);

    expect((globalThis as Record<symbol, unknown>)[KEY]).toBeInstanceOf(Map);
  });

  it('does not share between different names', () => {
    processGlobalMap<number>(NAME)().set('a', 1);

    expect(processGlobalMap<number>(OTHER_NAME)().has('a')).toBe(false);
  });

  it('runs the guard before every access, not once at construction', () => {
    const guard = jest.fn();
    const access = processGlobalMap<number>(NAME, guard);

    expect(guard).not.toHaveBeenCalled();
    access();
    access();
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('creates nothing when the guard throws', () => {
    const access = processGlobalMap<number>(NAME, () => {
      throw new Error('refused');
    });

    expect(() => access()).toThrow('refused');
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBeUndefined();
  });
});
