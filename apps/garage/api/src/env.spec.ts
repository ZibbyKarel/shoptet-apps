import { validateApiEnv } from './env';

/** A minimal, fully valid environment matching `.env.example`'s dev values. */
function validEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://garage:garage@localhost:5432/garage',
    AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
    AUTH_OKTA_AUDIENCE: 'api://default',
    CORS_ALLOWED_ORIGINS: 'http://localhost:4200,http://localhost:3000',
    LOG_LEVEL: 'info',
    ...overrides,
  };
}

describe('validateApiEnv', () => {
  it('accepts a valid environment and returns typed, parsed values', () => {
    const env = validateApiEnv(validEnv());

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://garage:garage@localhost:5432/garage',
      AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
      AUTH_OKTA_AUDIENCE: 'api://default',
      CORS_ALLOWED_ORIGINS: ['http://localhost:4200', 'http://localhost:3000'],
      LOG_LEVEL: 'info',
      // Operational-baseline keys are optional; these are their defaults.
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 300,
      THROTTLE_STRICT_TTL_MS: 60_000,
      THROTTLE_STRICT_LIMIT: 20,
      BODY_LIMIT: '100kb',
      HEALTH_DB_TIMEOUT_MS: 3_000,
      // Task 15's cell-lock TTL. Defaulted, like every key above it, so that
      // adding it could not break an existing `.env`.
      REALTIME_LOCK_TTL_MS: 30_000,
      // Slack (Task 16) — also all optional. `SLACK_BOT_TOKEN` and
      // `SLACK_CHANNEL_ID` are absent rather than `undefined`: they have no
      // default, so Zod omits the keys entirely, which is what makes
      // `SLACK_ENABLED: false` the only Slack fact a bare `.env` produces.
      // The rest of the Slack behaviour is asserted in
      // `apps/garage/api/src/slack/slack-env.spec.ts`.
      SLACK_ENABLED: false,
      SLACK_REQUEST_TIMEOUT_MS: 5_000,
      SLACK_RETRY_ATTEMPTS: 3,
      SLACK_RETRY_BASE_DELAY_MS: 500,
      SLACK_DAILY_SUMMARY_AT: '08:00',
    });
  });

  it('coerces the operational-baseline overrides that are set', () => {
    const env = validateApiEnv(
      validEnv({
        THROTTLE_TTL_MS: '1000',
        THROTTLE_LIMIT: '5',
        THROTTLE_STRICT_TTL_MS: '2000',
        THROTTLE_STRICT_LIMIT: '2',
        BODY_LIMIT: '1mb',
        HEALTH_DB_TIMEOUT_MS: '250',
      })
    );

    expect(env.THROTTLE_TTL_MS).toBe(1000);
    expect(env.THROTTLE_LIMIT).toBe(5);
    expect(env.THROTTLE_STRICT_TTL_MS).toBe(2000);
    expect(env.THROTTLE_STRICT_LIMIT).toBe(2);
    expect(env.BODY_LIMIT).toBe('1mb');
    expect(env.HEALTH_DB_TIMEOUT_MS).toBe(250);
  });

  it('rejects a BODY_LIMIT without a unit, because body-parser would read it as bytes', () => {
    expect(() => validateApiEnv(validEnv({ BODY_LIMIT: '100' }))).toThrow(/BODY_LIMIT/);
  });

  it.each([
    ['THROTTLE_LIMIT', '0'],
    ['THROTTLE_TTL_MS', '-1'],
    ['HEALTH_DB_TIMEOUT_MS', 'soon'],
  ])('rejects a non-positive %s', (variable, value) => {
    expect(() => validateApiEnv(validEnv({ [variable]: value }))).toThrow(new RegExp(variable));
  });

  it('throws naming a missing required variable, without ever printing a value', () => {
    const env = validEnv();
    delete env.DATABASE_URL;

    let thrown: unknown;
    try {
      validateApiEnv(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('DATABASE_URL');
    // No other variable's value should be echoed back either.
    expect(message).not.toContain('garage:garage@localhost');
  });

  it('throws naming an invalid variable without leaking its value', () => {
    const secretLookingValue = 'not-a-valid-issuer-url-9f3c7a1b';
    const env = validEnv({ AUTH_OKTA_ISSUER: secretLookingValue });

    let thrown: unknown;
    try {
      validateApiEnv(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('AUTH_OKTA_ISSUER');
    expect(message).not.toContain(secretLookingValue);
  });

  it('rejects an out-of-range PORT and a malformed CORS_ALLOWED_ORIGINS together', () => {
    const env = validEnv({ PORT: '99999', CORS_ALLOWED_ORIGINS: 'not-a-url' });

    let thrown: unknown;
    try {
      validateApiEnv(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('PORT');
    expect(message).toContain('CORS_ALLOWED_ORIGINS');
  });
});
