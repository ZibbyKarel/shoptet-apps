import { SOCKET_IO_PATH } from './socket-path';

describe('SOCKET_IO_PATH', () => {
  it('is a non-empty path, so a caller cannot accidentally configure an empty prefix', () => {
    expect(SOCKET_IO_PATH.startsWith('/')).toBe(true);
    expect(SOCKET_IO_PATH.length).toBeGreaterThan(1);
  });

  it('is Socket.io’s own default, restated rather than changed', () => {
    // Pinned literally: the two consumer specs
    // (`apps/garage/api/src/realtime/realtime-io.adapter.spec.ts` and
    // `libs/garage/realtime-client/src/lib/socket.spec.ts`) each assert their own
    // configured path against *this* export rather than against this literal,
    // which is what actually catches a hardcoded copy drifting back in on
    // either side. This test only pins the value itself.
    expect(SOCKET_IO_PATH).toBe('/socket.io');
  });
});
