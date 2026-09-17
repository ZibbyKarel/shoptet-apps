import { ERROR_CODES, errorCodeSchema, errorShapeSchema } from './errors';

describe('ERROR_CODES', () => {
  it('is the closed list required by the contract', () => {
    expect([...ERROR_CODES]).toEqual([
      'SPOT_ALREADY_RESERVED',
      'RESERVATION_LIMIT_REACHED',
      'MONTHLY_RESERVATION_LIMIT_REACHED',
      'PAST_DATE',
      'OUT_OF_HORIZON',
      'NOT_FOUND',
      'FORBIDDEN',
      'ALREADY_IN_WAITLIST',
      'CANNOT_WAITLIST_OWN_SPOT',
      'SPOT_NOT_OCCUPIED',
      'VALIDATION_FAILED',
      'CONFLICT',
      'RESERVATIONS_LOCKED',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('keeps the two window codes distinct', () => {
    // OUT_OF_HORIZON  = the target month is NOT_YET_OPEN.
    // RESERVATIONS_LOCKED = the target month is LOCKED.
    expect(ERROR_CODES).toContain('OUT_OF_HORIZON');
    expect(ERROR_CODES).toContain('RESERVATIONS_LOCKED');
  });
});

describe('errorCodeSchema', () => {
  it.each(ERROR_CODES)('accepts %s', (code) => {
    expect(errorCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(['INTERNAL_ERROR', 'not_found', '', null, 500])('rejects %p', (value) => {
    expect(errorCodeSchema.safeParse(value).success).toBe(false);
  });
});

describe('errorShapeSchema', () => {
  it('accepts an error without details', () => {
    const result = errorShapeSchema.safeParse({
      code: 'RESERVATIONS_LOCKED',
      message: 'Rezervace pro tento měsíc jsou uzamčené.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an error with structured details', () => {
    const result = errorShapeSchema.safeParse({
      code: 'SPOT_ALREADY_RESERVED',
      message: 'Spot is already reserved.',
      details: { parkingSpotId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', date: '2026-09-15' },
    });
    expect(result.success).toBe(true);
  });

  it.each<[string, unknown]>([
    ['an unknown code', { code: 'NOPE', message: 'x' }],
    ['a missing message', { code: 'NOT_FOUND' }],
    ['an empty message', { code: 'NOT_FOUND', message: '' }],
    ['a missing code', { message: 'x' }],
    ['non-object details', { code: 'NOT_FOUND', message: 'x', details: 'oops' }],
  ])('rejects %s', (_description, value) => {
    expect(errorShapeSchema.safeParse(value).success).toBe(false);
  });

  it('does not invent a details key when none was given', () => {
    const result = errorShapeSchema.parse({ code: 'FORBIDDEN', message: 'x' });
    expect('details' in result).toBe(false);
  });
});
