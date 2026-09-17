import { NOT_A_UUID, UUID_B, userFixture } from '../__fixtures__/fixtures';
import { buildIcsFeedUrl } from './ics';
import { myProfileSchema, regenerateIcsTokenOutputSchema, updateMySettingsInputSchema } from './me';

describe('myProfileSchema', () => {
  it('keeps the ICS token — it is the caller’s own record', () => {
    const parsed = myProfileSchema.parse(userFixture);
    expect(parsed.icsToken).toBe(userFixture.icsToken);
    expect(parsed.preferredParkingSpotId).toBe(userFixture.preferredParkingSpotId);
  });

  it('accepts a profile with neither licence plate nor preferred spot', () => {
    expect(
      myProfileSchema.safeParse({
        ...userFixture,
        licensePlate: null,
        preferredParkingSpotId: null,
      }).success
    ).toBe(true);
  });

  it('rejects a profile missing the token', () => {
    const withoutToken: Record<string, unknown> = { ...userFixture };
    delete withoutToken['icsToken'];
    expect(myProfileSchema.safeParse(withoutToken).success).toBe(false);
  });
});

describe('updateMySettingsInputSchema', () => {
  it('accepts an empty patch — nothing changes', () => {
    expect(updateMySettingsInputSchema.parse({})).toEqual({});
  });

  it('distinguishes "unchanged" (absent) from "clear" (null)', () => {
    expect(updateMySettingsInputSchema.parse({ licensePlate: null })).toEqual({
      licensePlate: null,
    });
    expect(updateMySettingsInputSchema.parse({ preferredParkingSpotId: null })).toEqual({
      preferredParkingSpotId: null,
    });
    expect(updateMySettingsInputSchema.parse({ licensePlate: '1AB 2345' })).toEqual({
      licensePlate: '1AB 2345',
    });
  });

  it('accepts setting a preferred spot', () => {
    expect(updateMySettingsInputSchema.parse({ preferredParkingSpotId: UUID_B })).toEqual({
      preferredParkingSpotId: UUID_B,
    });
  });

  it('rejects an empty plate, an over-long plate and a non-uuid spot', () => {
    expect(updateMySettingsInputSchema.safeParse({ licensePlate: '' }).success).toBe(false);
    expect(updateMySettingsInputSchema.safeParse({ licensePlate: 'X'.repeat(17) }).success).toBe(
      false
    );
    expect(
      updateMySettingsInputSchema.safeParse({ preferredParkingSpotId: NOT_A_UUID }).success
    ).toBe(false);
  });
});

describe('regenerateIcsTokenOutputSchema', () => {
  it('returns just the token, which the client turns into a URL', () => {
    const parsed = regenerateIcsTokenOutputSchema.parse({ icsToken: 'new-token' });
    expect(parsed.icsToken).toBe('new-token');
    expect(buildIcsFeedUrl('https://parking.example.com', parsed.icsToken)).toBe(
      'https://parking.example.com/api/calendar/new-token.ics'
    );
  });

  it('rejects an empty token — the feed URL would then address the collection', () => {
    expect(regenerateIcsTokenOutputSchema.safeParse({ icsToken: '' }).success).toBe(false);
    expect(regenerateIcsTokenOutputSchema.safeParse({}).success).toBe(false);
  });
});
