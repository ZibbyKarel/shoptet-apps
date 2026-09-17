import {
  DATE_A,
  INVALID_DATE,
  NOT_A_UUID,
  TIMESTAMP,
  UUID_B,
  userFixture,
  userSummaryFixture,
} from '../__fixtures__/fixtures';
import {
  cellLockAckSchema,
  cellLockCommandSchema,
  cellLockResultSchema,
  dayRoomCommandSchema,
} from './commands';
import { CLIENT_TO_SERVER_EVENT_SCHEMAS } from './event-maps';

describe('dayRoomCommandSchema', () => {
  it('accepts a day', () => {
    expect(dayRoomCommandSchema.parse({ date: DATE_A })).toEqual({ date: DATE_A });
  });

  it.each([
    ['a calendar-invalid day', { date: INVALID_DATE }],
    ['a month', { date: '2026-09' }],
    ['a timestamp', { date: TIMESTAMP }],
    ['nothing', {}],
    ['a number', { date: 20260915 }],
  ])('rejects %s', (_case, value) => {
    expect(dayRoomCommandSchema.safeParse(value).success).toBe(false);
  });

  it('rejects an unknown key rather than stripping it', () => {
    // Inbound payloads are strict: a client that sends a key this contract does
    // not know disagrees about what a subscription is, and stripping the key
    // would hide the disagreement instead of surfacing it.
    expect(dayRoomCommandSchema.safeParse({ date: DATE_A, room: 'day:*' }).success).toBe(false);
  });
});

describe('cellLockCommandSchema', () => {
  const command = { date: DATE_A, parkingSpotId: UUID_B };

  it('accepts a cell', () => {
    expect(cellLockCommandSchema.parse(command)).toEqual(command);
  });

  it.each([
    ['a non-uuid spot', { ...command, parkingSpotId: NOT_A_UUID }],
    ['a missing spot', { date: DATE_A }],
    ['a missing day', { parkingSpotId: UUID_B }],
    ['an unknown key', { ...command, ttlMs: 999_999 }],
  ])('rejects %s', (_case, value) => {
    expect(cellLockCommandSchema.safeParse(value).success).toBe(false);
  });

  it('carries no TTL — how long a hold lasts is the server’s call', () => {
    expect(Object.keys(cellLockCommandSchema.parse(command)).sort()).toEqual([
      'date',
      'parkingSpotId',
    ]);
  });
});

describe('cellLockAckSchema', () => {
  it('accepts a granted lock', () => {
    const ack = { result: 'ACQUIRED', expiresAt: TIMESTAMP };
    expect(cellLockAckSchema.parse(ack)).toEqual(ack);
  });

  it('accepts a denied lock, with who holds it', () => {
    const ack = { result: 'HELD_BY_OTHER', lockedBy: userSummaryFixture, expiresAt: TIMESTAMP };
    expect(cellLockAckSchema.parse(ack)).toEqual(ack);
  });

  it('does not let a granted lock carry a holder', () => {
    // The discriminated union is what stops a caller reading `lockedBy` off a
    // lock it was actually granted.
    const parsed = cellLockAckSchema.parse({
      result: 'ACQUIRED',
      expiresAt: TIMESTAMP,
      lockedBy: userSummaryFixture,
    }) as Record<string, unknown>;
    expect('lockedBy' in parsed).toBe(false);
  });

  it('requires the holder on a denial', () => {
    expect(
      cellLockAckSchema.safeParse({ result: 'HELD_BY_OTHER', expiresAt: TIMESTAMP }).success
    ).toBe(false);
  });

  it('never leaks a secret through the holder', () => {
    const parsed = cellLockAckSchema.parse({
      result: 'HELD_BY_OTHER',
      lockedBy: userFixture,
      expiresAt: TIMESTAMP,
    });
    expect(parsed.result === 'HELD_BY_OTHER' && Object.keys(parsed.lockedBy).sort()).toEqual([
      'id',
      'licensePlate',
      'name',
    ]);
  });

  it('rejects an unknown result', () => {
    expect(cellLockResultSchema.safeParse('MAYBE').success).toBe(false);
    expect(cellLockAckSchema.safeParse({ result: 'MAYBE', expiresAt: TIMESTAMP }).success).toBe(
      false
    );
  });
});

describe('the inbound surface', () => {
  it('validates every command it accepts, with no escape hatch', () => {
    // The rule the gateway implements: every inbound event is parsed against
    // the schema registered for it. For that to be total, no schema may accept
    // an arbitrary value — a `z.any()` anywhere here would make the rule a
    // formality. Probing with values no legitimate command contains is a
    // behavioural check, not an inspection of the schema's internals.
    for (const [name, schema] of Object.entries(CLIENT_TO_SERVER_EVENT_SCHEMAS)) {
      for (const hostile of [undefined, null, 'string', 42, true, [], {}, { date: null }]) {
        expect([name, schema.safeParse(hostile).success]).toEqual([name, false]);
      }
    }
  });

  it('mutates no domain state: nothing here creates or cancels anything', () => {
    // Reservations are created and cancelled over the API, which authorises and
    // re-checks the reservation window. The socket carries subscriptions and
    // the editing hold only.
    expect(Object.keys(CLIENT_TO_SERVER_EVENT_SCHEMAS).sort()).toEqual([
      'cell:lock',
      'cell:unlock',
      'day:subscribe',
      'day:unsubscribe',
    ]);
  });
});
