import { DAY_ROOM_PREFIX, roomForDate } from './rooms';

describe('roomForDate', () => {
  it('names the room after the day', () => {
    expect(roomForDate('2026-09-15')).toBe('day:2026-09-15');
  });

  it('is pure: the same day always gives the same room', () => {
    expect(roomForDate('2026-09-15')).toBe(roomForDate('2026-09-15'));
  });

  it('gives different days different rooms', () => {
    expect(roomForDate('2026-09-15')).not.toBe(roomForDate('2026-09-16'));
  });

  it('uses the exported prefix', () => {
    expect(roomForDate('2026-09-15').startsWith(DAY_ROOM_PREFIX)).toBe(true);
  });

  it('does not normalise: a room name is exactly the prefix plus the day', () => {
    // Anything else and the gateway and the client could compute two different
    // names for the same day.
    expect(roomForDate('2026-01-01')).toBe(`${DAY_ROOM_PREFIX}2026-01-01`);
  });

  it.each([
    ['a month', '2026-09'],
    ['a timestamp', '2026-09-15T00:00:00.000Z'],
    ['a calendar-invalid day', '2026-02-30'],
    ['a non-existent month', '2026-13-01'],
    ['an unpadded day', '2026-9-1'],
    ['empty', ''],
    ['a path traversal attempt', '../../day:2026-09-15'],
  ])('throws on %s', (_case, value) => {
    expect(() => roomForDate(value)).toThrow(TypeError);
  });

  it('throws on a non-string, which TypeScript alone cannot prevent at a boundary', () => {
    // `DateOnly` is an unbranded string alias (doc/decision/0014-*), so a value
    // arriving from a socket can be anything at runtime.
    expect(() => roomForDate(undefined as unknown as string)).toThrow(TypeError);
    expect(() => roomForDate(42 as unknown as string)).toThrow(TypeError);
  });
});
