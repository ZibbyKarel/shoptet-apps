import { GracefulShutdownService } from './graceful-shutdown.service';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
} as never;

describe('GracefulShutdownService', () => {
  let service: GracefulShutdownService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GracefulShutdownService(logger);
  });

  it('runs registered closers on shutdown, in registration order', async () => {
    const order: string[] = [];
    service.registerCloser('socket.io', () => {
      order.push('socket.io');
    });
    service.registerCloser('other', () => {
      order.push('other');
    });

    await service.onApplicationShutdown('SIGTERM');

    expect(order).toEqual(['socket.io', 'other']);
  });

  it('awaits an async closer before moving on', async () => {
    let finished = false;
    service.registerCloser('socket.io', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });

    await service.onApplicationShutdown('SIGTERM');

    expect(finished).toBe(true);
  });

  it('keeps closing the rest when one closer throws', async () => {
    const closed: string[] = [];
    service.registerCloser('broken', () => {
      throw new Error('close failed');
    });
    service.registerCloser('socket.io', () => {
      closed.push('socket.io');
    });

    // A half-closed process is worse than a noisy log line, so this must not
    // reject.
    await expect(service.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined();
    expect(closed).toEqual(['socket.io']);
  });

  it('replaces a closer registered twice under the same name', async () => {
    const calls: string[] = [];
    service.registerCloser('socket.io', () => {
      calls.push('first');
    });
    service.registerCloser('socket.io', () => {
      calls.push('second');
    });

    await service.onApplicationShutdown('SIGTERM');

    expect(service.registeredClosers()).toEqual(['socket.io']);
    expect(calls).toEqual(['second']);
  });

  it('is a no-op when nothing registered — Task 15 has not landed yet', async () => {
    await expect(service.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined();
    expect(service.registeredClosers()).toEqual([]);
  });
});
