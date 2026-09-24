/**
 * The editing hold on one cell of the day × spot grid.
 *
 * A cell lock is a **courtesy, not an authorization step**
 * (`libs/garage/contract/src/realtime/commands.ts`): holding one books nothing, and a
 * client that never asks for it gets a `CONFLICT` from `reservation.create`
 * instead of a nicer message. What it buys is the "právě upravuje …" state on
 * everybody else's tile while one user has a form open. Nothing in this file
 * may therefore be relied on for correctness of the reservation itself — the
 * unique indexes are what enforce that (`doc/database.md`).
 *
 * ## Why one concrete class, no abstraction for Redis
 *
 * The MVP is a single instance (global constraint 8), so a `Map` in this
 * process *is* the whole truth about who is editing what. `plan.md` puts a
 * multi-instance deployment (and the Redis lock this class would need then)
 * explicitly out of scope, and there is no second implementation to type-check
 * a seam against — so this is a plain `@Injectable()` class rather than an
 * interface with one implementation. See `doc/realtime.md` §"Single instance"
 * for the upgrade path if that constraint ever changes: every method below has
 * a Redis equivalent (`SET NX PX` for {@link acquire}, a Lua compare-and-delete
 * for {@link release}, a per-socket key set for {@link releaseSocket}, keyspace
 * notifications for {@link onExpired}), but an unimplemented Redis class would
 * be untested code kept "because it costs nothing to keep" — this project has
 * already paid for claims that were reasoned rather than exercised.
 *
 * ## Ownership is by user, not by socket — and both are tracked
 *
 * The contract says re-sending `cell:lock` for a cell you already hold
 * **extends** it, and `libs/garage/realtime-client`'s `useCellLock` re-requests the
 * hold on a *new* socket after a reconnect. Keying ownership by socket id would
 * turn that reconnect into `HELD_BY_OTHER` — the user told they are editing
 * against themselves — for however long the server takes to notice the old
 * socket is gone (up to `pingTimeout`, ~20 s, on an abrupt network drop).
 *
 * So the **owner is the user**, and the socket id is carried alongside it so
 * that {@link LockService.releaseSocket} can free a hold when a connection
 * drops. A renewal from a new socket overwrites the recorded socket id, which
 * is what makes the late disconnect of the *old* socket release nothing —
 * exercised by `lock.service.spec.ts`, "a stale socket's disconnect does not
 * drop the hold its user re-took".
 *
 * ## …but *giving one back* is keyed by both
 *
 * {@link LockService.acquire} is keyed by user, because that is what makes a
 * reconnect a renewal. {@link LockService.release} is keyed by user **and
 * socket**, because the two questions are different: "may this connection take
 * the cell?" is about the person, and "is this connection the one currently
 * holding it?" is about the connection. Keying release by user alone answers
 * the second question with the first one, and a user with two live connections
 * on one cell — a second tab, or a page that reloaded before the server noticed
 * the old socket — then has each of them able to drop the other's hold. The
 * result a person sees is a bay that reads `Volné` to everybody while the
 * holder's dialog is still open.
 *
 * The match is exactly the one {@link LockService.releaseSocket} already makes,
 * and it works for the same reason: a renewal re-keys `socketId`, so the
 * *current* connection always matches and a superseded one never does. It costs
 * nothing on the reconnect path — the client re-requests the hold on the new
 * socket before it could ever release it — which is why the objection recorded
 * against this in `doc/decision/0187-*` was retracted there and answered here.
 * See `doc/decision/0220-*`.
 */

import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserSummary } from '@garage/contract';
import type { CellRef } from '@garage/contract/realtime';
import type { ApiEnv } from '../env';

/**
 * One cell of the grid: the pair a hold is held on.
 *
 * The contract's own `CellRef` rather than a second shape — it is exactly the
 * `(date, parkingSpotId)` pair every realtime payload starts from, and
 * redeclaring it here would be the first step towards the two drifting.
 */
export type LockCell = CellRef;

/** Who is asking, and over which connection. */
export interface LockRequester {
  /** The requesting user, in the shape a `cell:locked` broadcast carries. */
  readonly user: UserSummary;
  /** The Socket.io connection the request arrived on. */
  readonly socketId: string;
}

/**
 * The answer to an {@link LockService.acquire}.
 *
 * `outcome` is deliberately the contract's own `CellLockResult` vocabulary, so
 * the gateway maps this onto the acknowledgement without inventing a second set
 * of names. `holder` is the caller when `ACQUIRED` and somebody else when
 * `HELD_BY_OTHER`; `expiresAt` is meaningful in both cases, which is what lets
 * a client that lost the race clear its own "právě upravuje" state when the
 * hold lapses even if it never hears the broadcast.
 */
export interface LockGrant {
  readonly outcome: 'ACQUIRED' | 'HELD_BY_OTHER';
  readonly holder: UserSummary;
  readonly expiresAt: Date;
}

/** Told when a hold lapses on its own, so the gateway can broadcast it. */
export type LockExpiryListener = (cell: LockCell, holder: UserSummary) => void;

/** One live hold. */
interface HeldLock {
  readonly cell: LockCell;
  holder: UserSummary;
  socketId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * `date` and `parkingSpotId` in one string.
 *
 * `|` is safe as a separator because both halves are closed shapes validated by
 * the contract before they reach here — `YYYY-MM-DD` and a UUID — so neither
 * can contain one and no two distinct cells can collide on a key.
 */
function cellKey(cell: LockCell): string {
  return `${cell.date}|${cell.parkingSpotId}`;
}

/**
 * Where editing holds live: an in-process `Map`, TTL'd and swept per hold.
 */
@Injectable()
export class LockService implements OnModuleDestroy {
  /** How long a fresh or renewed hold lasts. Read by the gateway for nothing but its logs. */
  readonly ttlMs: number;

  private readonly locks = new Map<string, HeldLock>();
  private readonly expiryListeners: LockExpiryListener[] = [];

  constructor(configService: ConfigService<ApiEnv, true>) {
    this.ttlMs = configService.get('REALTIME_LOCK_TTL_MS', { infer: true });
  }

  /**
   * Takes the hold, or extends it if the caller already has it.
   *
   * Idempotent for the current holder by design: the contract has no separate
   * heartbeat command, so a renewal *is* a second `cell:lock`.
   */
  acquire(cell: LockCell, requester: LockRequester): LockGrant {
    const key = cellKey(cell);
    const existing = this.locks.get(key);

    if (existing !== undefined && existing.holder.id !== requester.user.id) {
      // `expiresAt` is checked rather than trusting the timer to have fired:
      // a timer is scheduled, not instantaneous, and under a busy event loop
      // (or a test's fake clock) a lapsed hold can still be in the map.
      if (existing.expiresAt > Date.now()) {
        return {
          outcome: 'HELD_BY_OTHER',
          holder: existing.holder,
          expiresAt: new Date(existing.expiresAt),
        };
      }
      // Lapsed but not yet swept. Dropped **without** notifying: the caller is
      // about to be granted the cell and the gateway will broadcast
      // `cell:locked` for them, so a `cell:unlocked` fired afterwards would
      // clear a hold that is live on every client that just heard about it.
      clearTimeout(existing.timer);
      this.locks.delete(key);
    }

    const expiresAt = Date.now() + this.ttlMs;
    if (existing !== undefined) {
      clearTimeout(existing.timer);
    }
    this.locks.set(key, {
      cell,
      holder: requester.user,
      socketId: requester.socketId,
      expiresAt,
      timer: this.scheduleExpiry(key),
    });

    return { outcome: 'ACQUIRED', holder: requester.user, expiresAt: new Date(expiresAt) };
  }

  /**
   * Gives a hold back. Returns `true` only if this **connection** is the one
   * currently holding the cell — the same `(user, socketId)` pair
   * {@link acquire} last recorded.
   *
   * A `false` is not an error worth telling the client about — the three ways
   * to get one are a client releasing a hold that already lapsed, a client
   * releasing a cell somebody else holds, and a *superseded* connection of the
   * holder releasing a hold its user has since re-taken elsewhere. The first is
   * routine; the second is a client disagreeing with the contract; the third is
   * the one this signature exists for, and in all three the answer is to do
   * nothing, which is what returning `false` causes.
   */
  release(cell: LockCell, requester: LockRequester): boolean {
    const key = cellKey(cell);
    const existing = this.locks.get(key);
    // Both halves, and `socketId` is the load-bearing one: `holder.id` alone
    // lets a superseded connection of the same user drop the hold the current
    // one is renewing. See the file header, "…but *giving one back* is keyed by
    // both".
    if (
      existing === undefined ||
      existing.holder.id !== requester.user.id ||
      existing.socketId !== requester.socketId
    ) {
      return false;
    }
    clearTimeout(existing.timer);
    this.locks.delete(key);
    return true;
  }

  /**
   * Frees every hold whose *current* connection is this one. Returns the cells
   * that were actually freed, so the gateway can broadcast `cell:unlocked` for
   * each — the guarantee `libs/garage/realtime-client` relies on when it says "a
   * dropped socket drops the server's lock with it".
   */
  releaseSocket(socketId: string): LockCell[] {
    const released: LockCell[] = [];
    for (const [key, lock] of this.locks) {
      // `lock.socketId`, not "any socket this user ever had": a renewal from a
      // reconnected socket overwrote it, so the old socket's late disconnect
      // matches nothing and the fresh hold survives.
      if (lock.socketId !== socketId) {
        continue;
      }
      clearTimeout(lock.timer);
      this.locks.delete(key);
      released.push(lock.cell);
    }
    return released;
  }

  /**
   * Registers a listener for holds that lapse on their own.
   *
   * **This is load-bearing, not bookkeeping.** `useCellLock` puts a contended
   * cell into `held-by-other` and then *sits still* — it deliberately does not
   * poll — so a hold that lapses with no broadcast leaves every other client
   * showing "právě upravuje …" for a user who closed their laptop. See
   * `doc/decision/0111-*`.
   */
  onExpired(listener: LockExpiryListener): void {
    this.expiryListeners.push(listener);
  }

  /**
   * Clears every pending expiry timer.
   *
   * Every timer is `unref`ed already, so none of them can hold the process
   * open — this is about not firing a broadcast into a server that is closing.
   */
  onModuleDestroy(): void {
    for (const lock of this.locks.values()) {
      clearTimeout(lock.timer);
    }
    this.locks.clear();
  }

  /**
   * One timer per hold, rescheduled on every renewal.
   *
   * A single sweeping interval was the alternative and is worse on both axes:
   * it fires forever on an idle server, and it makes expiry granular to the
   * sweep period, so `cell:unlocked` would arrive up to one period after the
   * `expiresAt` every client was told. Per-hold timers are exact, and there are
   * never more of them than there are open editing forms.
   */
  private scheduleExpiry(key: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.expire(key);
    }, this.ttlMs);
    // A pending hold must never be the reason the process refuses to exit.
    // Guarded because Jest's fake timers do not always provide `unref`.
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
    return timer;
  }

  private expire(key: string): void {
    const lock = this.locks.get(key);
    if (lock === undefined) {
      return;
    }
    this.locks.delete(key);
    for (const listener of this.expiryListeners) {
      listener(lock.cell, lock.holder);
    }
  }
}
