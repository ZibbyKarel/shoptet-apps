/**
 * The guard is the whole of I-2's fix, so it is asserted against the exact
 * shapes it exists to tell apart — including a managed-hostname URL, which is
 * the case the previous `NODE_ENV === 'production'` check let straight through.
 */

import { ALLOW_DESTRUCTIVE_RESET_ENV, assertDisposableDatabase } from './disposable-database';

const LOCAL = 'postgresql://garage:pw@localhost:5432/garage';
const PRODUCTION = 'postgresql://garage:pw@prod.example.com:5432/garage';

/** An environment with the override absent, whatever the real one holds. */
const NO_OVERRIDE: NodeJS.ProcessEnv = {};
const OVERRIDDEN: NodeJS.ProcessEnv = { [ALLOW_DESTRUCTIVE_RESET_ENV]: '1' };

describe('assertDisposableDatabase — hosts it accepts', () => {
  it.each([
    ['localhost', LOCAL],
    ['127.0.0.1', 'postgresql://garage:pw@127.0.0.1:5432/garage'],
    ['an IPv6 loopback literal', 'postgresql://garage:pw@[::1]:5432/garage'],
    ['a Compose service name', 'postgresql://garage:pw@postgres:5432/garage'],
    ['a Compose network alias', 'postgresql://garage:pw@garage-postgres:5432/garage'],
  ])('accepts %s', (_label, url) => {
    expect(() => assertDisposableDatabase(url, NO_OVERRIDE)).not.toThrow();
    expect(assertDisposableDatabase(url, NO_OVERRIDE).overridden).toBe(false);
  });

  it('reports the host and database so the caller can print them', () => {
    expect(assertDisposableDatabase(LOCAL, NO_OVERRIDE)).toEqual({
      url: LOCAL,
      host: 'localhost',
      database: 'garage',
      overridden: false,
    });
  });
});

describe('assertDisposableDatabase — hosts it refuses', () => {
  it.each([
    ['a managed hostname', PRODUCTION],
    ['an RDS endpoint', 'postgresql://u:pw@db.eu-central-1.rds.amazonaws.com:5432/garage'],
    ['a bare public IP', 'postgresql://u:pw@203.0.113.10:5432/garage'],
    ['a routable IPv6 address', 'postgresql://u:pw@[2001:db8::1]:5432/garage'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertDisposableDatabase(url, NO_OVERRIDE)).toThrow(/Refusing to run/);
  });

  it('names the host it refused, and never the password', () => {
    expect(() => assertDisposableDatabase(PRODUCTION, NO_OVERRIDE)).toThrow(/prod\.example\.com/);
    try {
      assertDisposableDatabase(PRODUCTION, NO_OVERRIDE);
    } catch (error) {
      expect((error as Error).message).not.toContain('pw');
    }
  });

  it('refuses a missing connection string', () => {
    expect(() => assertDisposableDatabase(undefined, NO_OVERRIDE)).toThrow(
      /DATABASE_URL is not set/
    );
    expect(() => assertDisposableDatabase('', NO_OVERRIDE)).toThrow(/DATABASE_URL is not set/);
  });

  it('refuses a string that is not a URL at all, without echoing it', () => {
    expect(() => assertDisposableDatabase('garage@@@not a url', NO_OVERRIDE)).toThrow(
      /not a valid connection URL/
    );
  });

  it('is not fooled by "production" appearing in a local URL, or absent from a remote one', () => {
    // The guard reads the host, not the words in the string.
    expect(() =>
      assertDisposableDatabase('postgresql://u:pw@localhost:5432/production', NO_OVERRIDE)
    ).not.toThrow();
    expect(() =>
      assertDisposableDatabase('postgresql://u:pw@harmless.example.net:5432/dev', NO_OVERRIDE)
    ).toThrow(/Refusing to run/);
  });
});

describe('assertDisposableDatabase — the explicit override', () => {
  it('lets a remote host through, and says so', () => {
    expect(assertDisposableDatabase(PRODUCTION, OVERRIDDEN)).toEqual({
      url: PRODUCTION,
      host: 'prod.example.com',
      database: 'garage',
      overridden: true,
    });
  });

  it('accepts only the exact value 1', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      expect(() =>
        assertDisposableDatabase(PRODUCTION, { [ALLOW_DESTRUCTIVE_RESET_ENV]: value })
      ).toThrow(/Refusing to run/);
    }
  });

  it('does not mark a local database as overridden even when the flag is set', () => {
    expect(assertDisposableDatabase(LOCAL, OVERRIDDEN).overridden).toBe(false);
  });
});
