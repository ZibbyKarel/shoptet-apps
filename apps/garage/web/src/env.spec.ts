import { validateWebEnv } from './env';

/** A minimal, fully valid environment matching `.env.example`'s dev values. */
function validEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    NEXT_PUBLIC_API_URL: 'http://localhost:3000/api',
    AUTH_SECRET: 'a'.repeat(32),
    AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
    AUTH_OKTA_CLIENT_ID: 'web-client-id',
    AUTH_OKTA_CLIENT_SECRET: 'web-client-secret',
    ...overrides,
  };
}

describe('validateWebEnv', () => {
  it('accepts a valid environment and returns typed values', () => {
    const env = validateWebEnv(validEnv());

    expect(env).toEqual({
      NODE_ENV: 'development',
      NEXT_PUBLIC_API_URL: 'http://localhost:3000/api',
      AUTH_SECRET: 'a'.repeat(32),
      AUTH_OKTA_ISSUER: 'http://localhost:8080/default',
      AUTH_OKTA_CLIENT_ID: 'web-client-id',
      AUTH_OKTA_CLIENT_SECRET: 'web-client-secret',
    });
  });

  it('throws naming a missing required variable, without ever printing a value', () => {
    const env = validEnv();
    delete env.AUTH_OKTA_CLIENT_SECRET;

    let thrown: unknown;
    try {
      validateWebEnv(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('AUTH_OKTA_CLIENT_SECRET');
    expect(message).not.toContain('web-client-id');
  });

  it('throws naming an invalid variable without leaking its value', () => {
    const secretLookingValue = 'too-short-secret-9f3c7a1b';
    const env = validEnv({ AUTH_SECRET: secretLookingValue });

    let thrown: unknown;
    try {
      validateWebEnv(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('AUTH_SECRET');
    expect(message).not.toContain(secretLookingValue);
  });
});
