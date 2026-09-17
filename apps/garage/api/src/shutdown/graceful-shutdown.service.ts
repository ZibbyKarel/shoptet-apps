/**
 * Graceful shutdown.
 *
 * `app.enableShutdownHooks()` in `main.ts` makes Nest listen for SIGTERM/SIGINT
 * and then, in order: stop accepting new connections, let in-flight requests
 * finish, and call every provider's `onModuleDestroy` / `onApplicationShutdown`.
 * `PrismaService.onModuleDestroy` closes the database pool inside that window.
 *
 * ## The hook Task 15 must use
 *
 * Socket.io does not close itself. A live WebSocket is not an "in-flight
 * request", so Nest's HTTP shutdown will not touch it and the process hangs
 * until the orchestrator's kill timeout. **Task 15 registers the gateway's
 * close here**:
 *
 * ```ts
 * // in the Socket.io gateway's onModuleInit, or its module's constructor
 * gracefulShutdown.registerCloser('socket.io', async () => {
 *   await new Promise<void>((resolve) => this.server.close(() => resolve()));
 * });
 * ```
 *
 * The name to grep for is **`GracefulShutdownService.registerCloser`**. Closers
 * run in `onApplicationShutdown`, i.e. after HTTP has stopped accepting
 * connections, and each one is awaited and individually guarded: a closer that
 * throws is logged and the remaining ones still run, because a half-closed
 * process is worse than a noisy log line.
 */

import type { OnApplicationShutdown } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/** A resource-closing callback. Must resolve, or reject — never hang forever. */
export type ShutdownCloser = () => Promise<void> | void;

@Injectable()
export class GracefulShutdownService implements OnApplicationShutdown {
  private readonly closers = new Map<string, ShutdownCloser>();

  constructor(
    @InjectPinoLogger(GracefulShutdownService.name)
    private readonly logger: PinoLogger
  ) {}

  /**
   * Registers a resource to close on shutdown.
   *
   * @param name  Identifies the resource in shutdown logs, e.g. `'socket.io'`.
   *              Registering the same name twice replaces the previous closer,
   *              so a module that re-initialises cannot leak duplicates.
   */
  registerCloser(name: string, close: ShutdownCloser): void {
    this.closers.set(name, close);
    this.logger.debug({ resource: name }, 'Shutdown closer registered');
  }

  /** Registered closer names, in registration order. Used by the unit test. */
  registeredClosers(): string[] {
    return [...this.closers.keys()];
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.closers.size === 0) {
      return;
    }
    this.logger.info({ signal, closers: this.registeredClosers() }, 'Closing resources');

    for (const [name, close] of this.closers) {
      try {
        await close();
        this.logger.info({ resource: name }, 'Resource closed');
      } catch (error) {
        // Deliberately not rethrown: one failing closer must not prevent the
        // rest from running.
        this.logger.error({ err: error, resource: name }, 'Resource failed to close');
      }
    }
  }
}
