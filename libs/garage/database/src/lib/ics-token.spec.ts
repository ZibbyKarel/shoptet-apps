import { userSchema } from '@garage/contract';
import { SEED_ICS_TOKEN_BYTES, generateSeedIcsToken } from './ics-token';

/** 32 bytes in base64url is 43 characters with no padding. */
const EXPECTED_LENGTH = Math.ceil((SEED_ICS_TOKEN_BYTES * 8) / 6);

describe('generateSeedIcsToken', () => {
  it('carries 32 bytes of entropy, the same as a token the API mints', () => {
    expect(SEED_ICS_TOKEN_BYTES).toBe(32);
    expect(generateSeedIcsToken()).toHaveLength(EXPECTED_LENGTH);
  });

  it('is base64url — URL-safe, because it goes in a path segment', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateSeedIcsToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('is different every time, which is the whole point', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSeedIcsToken));
    expect(tokens.size).toBe(200);
  });

  it('satisfies the contract schema', () => {
    const icsTokenSchema = userSchema.pick({ icsToken: true });
    expect(() => icsTokenSchema.parse({ icsToken: generateSeedIcsToken() })).not.toThrow();
  });
});
