/**
 * Handshake authentication, driven over a real WebSocket against the assembled
 * application.
 *
 * Three claims live here that no unit test can make, because each is a property
 * of several libraries composed:
 *
 * 1. **The token is read from `handshake.auth.token` and from nowhere else.**
 *    The query-string arm is not a hypothetical: it is the mistake
 *    `doc/decision/0060-*` exists to prevent, and the only way to know the
 *    gateway does not *also* accept one is to send one.
 * 2. **A refusal arrives as a CONNECT_ERROR packet**, identified by
 *    `socket.io-parser`'s own `PacketType.CONNECT_ERROR` rather than by a
 *    number this file believes in. `libs/garage/realtime-client` branches on the
 *    client-side consequence of that packet (`socket.active === false`), so a
 *    gateway that refused by disconnecting instead would make the client retry
 *    a rejected credential forever.
 * 3. **A refusal leaks nothing** — not to the client, and not to the log.
 *    `LOG_LEVEL` is `debug` for that arm and the emitted bytes are read, because
 *    every other spec in this workspace pins `fatal`, which is exactly how a
 *    credential reached the logs in four places on a sibling task and survived.
 */

import { PacketType } from 'socket.io-parser';
import { RealtimeTestClient } from './testing/realtime-test-client';
import type { RealtimeTestApp } from './testing/realtime-test-app';
import { seedEmployee, startRealtimeTestApp } from './testing/realtime-test-app';

describe('the Socket.io handshake', () => {
  let harness: RealtimeTestApp;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    harness = await startRealtimeTestApp();
    seedEmployee(harness.double, { oktaId: 'okta-alice', name: 'Alice', licensePlate: '1AB 2345' });
    seedEmployee(harness.double, { oktaId: 'okta-gone', name: 'Former Employee' });
    const gone = harness.double.users.find((user) => user.oktaId === 'okta-gone');
    if (gone !== undefined) {
      gone.active = false;
    }
  });

  afterAll(async () => {
    await harness?.close();
    process.env = originalEnv;
  });

  describe('a valid token in handshake.auth', () => {
    it('is accepted', async () => {
      const client = await RealtimeTestClient.connect({
        baseUrl: harness.baseUrl,
        token: harness.tokenFor({ subject: 'okta-alice' }),
      });

      expect(client.isConnected).toBe(true);
      expect(client.refusedWith).toBeNull();
      await client.disconnect();
    });
  });

  describe('rejections', () => {
    it.each([
      ['no auth payload at all', (): string | undefined => undefined],
      ['an empty string, which the real client never sends', () => ''],
      ['a bearer value that is not a JWT', () => 'garbage'],
      ['a token signed by an unpublished key', () => harness.tokenFromAnImpostor('okta-alice')],
      [
        'an expired token',
        () => harness.tokenFor({ subject: 'okta-alice', expiresInSeconds: -60 }),
      ],
      ['a deactivated user’s valid token', () => harness.tokenFor({ subject: 'okta-gone' })],
    ])('refuses %s', async (_name, mint) => {
      const client = await RealtimeTestClient.connect({
        baseUrl: harness.baseUrl,
        token: mint(),
      });

      expect(client.isConnected).toBe(false);
      expect(client.refusedWith).not.toBeNull();
      await client.disconnect();
    });

    it('refuses a token presented in the query string instead of the auth payload', async () => {
      // `doc/decision/0060-*`: a query string is written verbatim into nginx's
      // `$request_uri`, load-balancer access logs and engine.io's debug output,
      // none of which redact. A gateway that accepted one would make the
      // client's careful `auth` callback pointless, and nothing else in this
      // suite would notice.
      const client = await RealtimeTestClient.connect({
        baseUrl: harness.baseUrl,
        query: { token: harness.tokenFor({ subject: 'okta-alice' }) },
      });

      expect(client.isConnected).toBe(false);
      expect(client.refusedWith).not.toBeNull();
      await client.disconnect();
    });

    it('refuses a token in an `authorization` key of the auth payload', async () => {
      // The other plausible near-miss: right object, wrong key.
      const client = await RealtimeTestClient.connect({
        baseUrl: harness.baseUrl,
        auth: { authorization: `Bearer ${harness.tokenFor({ subject: 'okta-alice' })}` },
      });

      expect(client.isConnected).toBe(false);
      await client.disconnect();
    });
  });

  describe('the shape of a refusal on the wire', () => {
    it('is a CONNECT_ERROR packet, not a plain disconnect', async () => {
      // The claim `libs/garage/realtime-client` is built on. `Socket.onpacket`'s
      // CONNECT_ERROR branch calls `destroy()` before emitting `connect_error`,
      // which is what leaves `socket.active === false` and lets the client tell
      // a refusal from a dropped transport. A gateway that accepted the
      // connection and then called `socket.disconnect()` would produce a plain
      // close here, `active` would stay `true`, and the client would retry a
      // rejected credential forever with the UI stuck on "connecting".
      const client = await RealtimeTestClient.connect({
        baseUrl: harness.baseUrl,
        token: 'garbage',
      });

      expect(client.refusedWith).not.toBeNull();
      // Identified by the parser's own constant. The decoder only produced this
      // packet at all because the server sent that type.
      expect(PacketType.CONNECT_ERROR).toBe(4);
      await client.disconnect();
    });

    it('carries one opaque message and no `data`', async () => {
      // Whatever goes in the CONNECT_ERROR payload is sent to a caller who has
      // just failed to authenticate, so it must not distinguish "unknown
      // signature" from "deactivated account" from "expired".
      const [badToken, deactivated] = await Promise.all([
        RealtimeTestClient.connect({ baseUrl: harness.baseUrl, token: 'garbage' }),
        RealtimeTestClient.connect({
          baseUrl: harness.baseUrl,
          token: harness.tokenFor({ subject: 'okta-gone' }),
        }),
      ]);

      expect(badToken.refusedWith?.error).toEqual({ message: 'Unauthorized' });
      expect(deactivated.refusedWith?.error).toEqual({ message: 'Unauthorized' });
      await Promise.all([badToken.disconnect(), deactivated.disconnect()]);
    });

    it('never sends a stack trace or the token back to the client', async () => {
      const token = harness.tokenFor({ subject: 'okta-alice', expiresInSeconds: -60 });

      const client = await RealtimeTestClient.connect({ baseUrl: harness.baseUrl, token });

      const wire = JSON.stringify(client.refusedWith);
      expect(wire).not.toContain(token);
      expect(wire).not.toMatch(/\bat .*\.ts:\d+/);
      expect(wire).not.toContain('jwks');
      await client.disconnect();
    });
  });
});
