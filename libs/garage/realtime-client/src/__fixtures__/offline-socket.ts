/**
 * `createRealtimeSocket` + {@link attachOfflineTransport}, for the specs that
 * drive a socket directly rather than through React.
 *
 * Kept apart from `./offline-transport` because that file must stay importable
 * from inside a `jest.mock('../lib/socket', …)` factory, and this one is the
 * part that actually calls into `../lib/socket`.
 */

import { createRealtimeSocket } from '../lib/socket';
import type { RealtimeSocketOptions } from '../lib/socket';
import { attachOfflineTransport } from './offline-transport';
import type { OfflineSocket } from './offline-transport';

export type { OfflineSocket, ProtocolPacket } from './offline-transport';

export type OfflineSocketOptions = Omit<RealtimeSocketOptions, 'autoConnect' | 'forceNew'>;

export function createOfflineSocket(options: OfflineSocketOptions): OfflineSocket {
  return attachOfflineTransport(
    createRealtimeSocket({ ...options, autoConnect: false, forceNew: true })
  );
}
