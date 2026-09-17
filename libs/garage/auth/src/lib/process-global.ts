/**
 * A `Map` hung off `globalThis` under a registry symbol, shared by every bundle
 * in the realm.
 *
 * **This indirection is not defensive style.** Next.js compiles the proxy, the
 * `/api/auth/*` route handlers and the server components into *separate
 * bundles*, each with its own module registry, so a module-level `Map` gives
 * each of them a private one. Measured on this application: a single
 * `next start` process built **three** `createAuthConfig` instances
 * (`doc/decision/0231-*`). `globalThis` crosses that boundary because all three
 * bundles run in the same V8 realm, which is true here precisely because the
 * proxy runs on the Node.js runtime (`doc/decision/0100-*`).
 *
 * `Symbol.for` rather than `Symbol`: the global symbol registry is shared by
 * everything in the realm, so two copies of a module resolve the same key. A
 * plain `Symbol()` would be a different key in each copy, which is the whole
 * problem this exists to solve.
 *
 * Both callers wrote this out themselves, with the "why `Symbol.for`" and "why
 * `globalThis`" reasoning in both places and a note in each pointing at the
 * other. The one real difference between them — whether an access off the
 * Node.js runtime is refused — is the `guard` parameter, so it is now a fact
 * about a call rather than a difference a reader has to reconstruct from two
 * comments. What stays at each call site is what is specific to it: why *that*
 * state has to be process-global, and what its failure mode is.
 *
 * Not re-exported from `libs/garage/auth/src/index.ts`, and neither are its callers:
 * an accessor that hands out a process-global mutable map is something any
 * importer could `.clear()`.
 */

/** `globalThis` as what it is here: a bag keyed by registry symbols. */
type SymbolKeyed<V> = Record<symbol, Map<string, V> | undefined>;

/**
 * Builds the accessor for one process-global map.
 *
 * @param name Suffix of the registry key, namespaced to `@garage/auth:`.
 *   It identifies the slot across every bundle in the realm, so changing it is
 *   changing the storage.
 * @param guard Runs before **every** access, not once at module load: a
 *   caller whose state cannot work off the Node.js runtime wants the refusal on
 *   the call that would have used it. Throw from here to refuse.
 */
export function processGlobalMap<V>(name: string, guard?: () => void): () => Map<string, V> {
  const key = Symbol.for(`@garage/auth:${name}`);

  return () => {
    guard?.();

    const container = globalThis as SymbolKeyed<V>;
    const existing = container[key];
    if (existing !== undefined) return existing;

    const created = new Map<string, V>();
    container[key] = created;
    return created;
  };
}
