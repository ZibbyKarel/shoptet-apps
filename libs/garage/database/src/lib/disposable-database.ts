/**
 * The guard both destructive scripts in this lib run before they touch a row.
 *
 * ## Why it does not look at `NODE_ENV`
 *
 * `reset-e2e.ts` used to refuse only when `NODE_ENV === 'production'`. That
 * check was inert in exactly the situation it existed for: `NODE_ENV` is unset
 * in a plain shell, `nx run database:reset-e2e` sets only `SWC_NODE_PROJECT`,
 * and `apps/garage/web-e2e`'s `globalSetup` spawns the script with the environment it
 * inherited. So the one variable that actually decided which database was
 * emptied — `DATABASE_URL` — was never consulted, and the one that was
 * consulted was almost never set. The final review found it as I-2; see
 * `doc/decision/0276-destructive-database-scripts-are-guarded-by-the-connection-string.md`.
 *
 * The property that matters is *which database this is*, and the connection
 * string is the only thing that states it. So that is what is checked.
 *
 * ## What counts as disposable
 *
 * A host that cannot be anything but a developer's own machine or a container
 * on the same Compose network:
 *
 * - `localhost`, `127.0.0.1`, `::1` — the host loopback.
 * - Any single-label hostname (`postgres`, `garage-postgres`) — a Docker
 *   Compose service name or network alias. A single label is not resolvable on
 *   the public internet, so a managed database can never be addressed this way:
 *   RDS, Cloud SQL, Neon and Supabase all hand out fully-qualified names.
 *
 * Everything else is refused. The escape hatch is deliberate and loud:
 * `GARAGE_ALLOW_DESTRUCTIVE_RESET=1` in the environment. Somebody who wants
 * to seed a shared staging database can still do it, but they have to say so in
 * the same command, and the host they are about to write to is printed either
 * way.
 */

/** Hosts that are the machine running the script, whatever it is called. */
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/** Set to `1` to run a destructive script against a host that is not local. */
export const ALLOW_DESTRUCTIVE_RESET_ENV = 'GARAGE_ALLOW_DESTRUCTIVE_RESET';

export interface DisposableDatabase {
  /**
   * The connection string, unchanged. Returned so a caller can narrow
   * `string | undefined` to `string` by having gone through the guard, instead
   * of asserting the type it already checked.
   */
  readonly url: string;
  /** Host from the connection string, for the caller to print. */
  readonly host: string;
  /** Database name from the connection string, for the caller to print. */
  readonly database: string;
  /** `true` when the host was not local and the override let it through. */
  readonly overridden: boolean;
}

/**
 * Throws unless `url` names a database it is safe to delete rows from.
 *
 * Returns the host and database name rather than nothing, so the caller can
 * print *what it is about to write to* before it writes — the second half of
 * the fix, and the half a reader notices.
 *
 * @param url the connection string, normally `DATABASE_URL`
 * @param env the environment to read the override from; injected for the tests
 * @throws when `url` is absent, unparseable, or names a remote host without the
 *   explicit override
 */
export function assertDisposableDatabase(
  url: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): DisposableDatabase {
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set — copy .env.example to .env (see doc/environment.md).'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Never echo the string back: it carries the password.
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }

  // `postgresql:` is not a "special scheme", so WHATWG parsing leaves an IPv6
  // literal in its brackets — measured: `new URL('postgresql://u@[::1]/d')`
  // gives `hostname === '[::1]'`, not `'::1'` as it would for `http:`.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  const database = parsed.pathname.replace(/^\//, '');
  const overridden = env[ALLOW_DESTRUCTIVE_RESET_ENV] === '1';

  if (isDisposableHost(host)) {
    return { url, host, database, overridden: false };
  }

  if (overridden) {
    return { url, host, database, overridden: true };
  }

  throw new Error(
    `Refusing to run a destructive script against "${host}": it is not a ` +
      'local or Compose-internal database. These scripts delete rows and ' +
      'overwrite settings. If you really mean this host, set ' +
      `${ALLOW_DESTRUCTIVE_RESET_ENV}=1 in the same command.`
  );
}

/**
 * Whether a host can only be this machine or a container beside it.
 *
 * `host` arrives with any IPv6 brackets already stripped by the caller, so a
 * loopback literal is `::1`. The `:` test below is what rejects a *non*-loopback
 * IPv6 address, which has no dots and would otherwise read as a single label.
 */
function isDisposableHost(host: string): boolean {
  if (LOOPBACK_HOSTS.includes(host)) {
    return true;
  }
  // A Compose service name or network alias: one label, no dots. `.localhost`
  // and `.internal` are deliberately *not* special-cased — they are more
  // characters to get wrong for no gain over the override.
  return host !== '' && !host.includes('.') && !host.includes(':');
}
