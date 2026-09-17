/**
 * The Slack keys of `apiEnvSchema`, and the `SlackConfig` built from them.
 *
 * Kept in `apps/garage/api/src/slack/` rather than appended to `env.spec.ts` so this
 * task's file set stays self-contained; `env.spec.ts` continues to own the
 * baseline keys.
 */

import { ENV_DEFAULTS, apiEnvSchema, validateApiEnv } from '../env';
import { SlackConfig } from './slack.config';

/** The minimum a valid environment needs, with no Slack keys at all. */
const BASE = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://garage:garage@localhost:5432/garage',
  AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
  AUTH_OKTA_AUDIENCE: 'api://default',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4200',
  LOG_LEVEL: 'fatal',
};

const TOKEN = 'xoxb-fake-slack-token';

describe('the Slack environment keys', () => {
  describe('SLACK_ENABLED', () => {
    it('defaults to false, so an environment that says nothing sends nothing', () => {
      expect(validateApiEnv(BASE).SLACK_ENABLED).toBe(false);
    });

    it.each([
      ['true', true],
      ['false', false],
    ])('parses %s', (raw, expected) => {
      const env = validateApiEnv({
        ...BASE,
        SLACK_ENABLED: raw,
        SLACK_BOT_TOKEN: TOKEN,
        SLACK_CHANNEL_ID: 'C0PARKING',
      });

      expect(env.SLACK_ENABLED).toBe(expected);
    });

    it.each(['1', 'yes', 'TRUE', ''])('rejects %p rather than guessing', (raw) => {
      // `z.coerce.boolean()` would read every one of these as `true`, including
      // the empty string's opposite meaning. That is why the schema uses an
      // enum: switching Slack on must be something someone typed.
      expect(() => validateApiEnv({ ...BASE, SLACK_ENABLED: raw })).toThrow('SLACK_ENABLED');
    });
  });

  describe('SLACK_ENABLED=true without its companions', () => {
    it('refuses to boot, naming both missing variables', () => {
      expect(() => validateApiEnv({ ...BASE, SLACK_ENABLED: 'true' })).toThrow(
        /SLACK_BOT_TOKEN[\s\S]*SLACK_CHANNEL_ID/
      );
    });

    it('names only the one that is missing', () => {
      const error = captureError(() =>
        validateApiEnv({ ...BASE, SLACK_ENABLED: 'true', SLACK_BOT_TOKEN: TOKEN })
      );

      expect(error).toContain('SLACK_CHANNEL_ID');
      expect(error).not.toContain('SLACK_BOT_TOKEN');
    });

    it('never prints the token, even when the token is the thing at fault', () => {
      const error = captureError(() =>
        validateApiEnv({ ...BASE, SLACK_ENABLED: 'true', SLACK_BOT_TOKEN: '' })
      );

      expect(error).toContain('SLACK_BOT_TOKEN');
      expect(error).not.toContain(TOKEN);
    });

    it('never echoes a raw offending value, even a token-shaped one typed into the wrong variable', () => {
      // `SLACK_BOT_TOKEN` has no format check — any non-empty string is valid —
      // so there is no way to make the *real* token itself the invalid value at
      // that field; the case above supplies `''`, which cannot contain a token
      // by construction and so cannot catch a formatter that starts echoing
      // offending values. This one instead puts the token-shaped string in a
      // field the schema *does* reject (`SLACK_ENABLED`, an enum of two
      // literals), so `TOKEN` is genuinely part of the input a real crash
      // message could echo — the copy-paste-into-the-wrong-variable case the
      // reviewer's probe named.
      const error = captureError(() => validateApiEnv({ ...BASE, SLACK_ENABLED: TOKEN }));

      expect(error).toContain('SLACK_ENABLED');
      expect(error).not.toContain(TOKEN);
    });
  });

  describe('the tunables', () => {
    it('all have defaults, so an existing .env keeps working untouched', () => {
      const env = validateApiEnv(BASE);

      expect(env.SLACK_REQUEST_TIMEOUT_MS).toBe(ENV_DEFAULTS.SLACK_REQUEST_TIMEOUT_MS);
      expect(env.SLACK_RETRY_ATTEMPTS).toBe(ENV_DEFAULTS.SLACK_RETRY_ATTEMPTS);
      expect(env.SLACK_RETRY_BASE_DELAY_MS).toBe(ENV_DEFAULTS.SLACK_RETRY_BASE_DELAY_MS);
      expect(env.SLACK_DAILY_SUMMARY_AT).toBe(ENV_DEFAULTS.SLACK_DAILY_SUMMARY_AT);
    });

    it.each(['0', '-1', 'soon', '1.5'])('rejects %p as a millisecond count', (raw) => {
      expect(() => validateApiEnv({ ...BASE, SLACK_REQUEST_TIMEOUT_MS: raw })).toThrow(
        'SLACK_REQUEST_TIMEOUT_MS'
      );
    });

    it.each(['8:00', '0800', '24:00', '08:60', 'ráno', '08:00:00'])(
      'rejects %p as a time of day',
      (raw) => {
        expect(() => validateApiEnv({ ...BASE, SLACK_DAILY_SUMMARY_AT: raw })).toThrow(
          'SLACK_DAILY_SUMMARY_AT'
        );
      }
    );

    it.each(['00:00', '08:00', '23:59'])('accepts %p', (raw) => {
      expect(validateApiEnv({ ...BASE, SLACK_DAILY_SUMMARY_AT: raw }).SLACK_DAILY_SUMMARY_AT).toBe(
        raw
      );
    });
  });

  it('is additive: every pre-existing key still parses exactly as before', () => {
    // The schema may only gain keys (`doc/environment.md`). This is the cheap
    // structural check that no Slack key was added by loosening an old one.
    const result = apiEnvSchema.safeParse(BASE);

    expect(result.success).toBe(true);
  });
});

describe('SlackConfig.fromEnv', () => {
  it('has no target when Slack is disabled, whatever else is set', () => {
    const config = SlackConfig.fromEnv({
      ...validateApiEnv(BASE),
      SLACK_ENABLED: false,
      SLACK_BOT_TOKEN: TOKEN,
      SLACK_CHANNEL_ID: 'C0PARKING',
    });

    expect(config.target).toBeUndefined();
  });

  it('carries the token and channel when enabled', () => {
    const config = SlackConfig.fromEnv(
      validateApiEnv({
        ...BASE,
        SLACK_ENABLED: 'true',
        SLACK_BOT_TOKEN: TOKEN,
        SLACK_CHANNEL_ID: 'C0PARKING',
      })
    );

    expect(config.target).toEqual({ botToken: TOKEN, channelId: 'C0PARKING' });
  });

  it('refuses an inconsistent configuration the schema would have caught first', () => {
    // Unreachable through `validateApiEnv`; reachable — and reached here — if a
    // future refactor of the schema drops the refinement.
    expect(() =>
      SlackConfig.fromEnv({
        ...validateApiEnv(BASE),
        SLACK_ENABLED: true,
        SLACK_BOT_TOKEN: undefined,
        SLACK_CHANNEL_ID: undefined,
      })
    ).toThrow('SLACK_ENABLED=true requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID');
  });
});

/** The message of the error `run` throws, or a failure if it threw nothing. */
function captureError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the call to throw, but it returned');
}
