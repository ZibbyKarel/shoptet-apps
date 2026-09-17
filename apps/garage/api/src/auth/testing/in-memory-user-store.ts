/**
 * An in-memory stand-in for `PrismaService` that **enforces the unique
 * constraints**.
 *
 * Docker is unavailable in this environment, so no real Postgres backs these
 * tests. The one property that would be worthless to fake loosely is the one
 * that makes JIT provisioning correct under concurrency: `User.oktaId`,
 * `User.email` and `User.icsToken` are unique in the schema, and it is the
 * database rejecting the second insert — with P2002 — that stops two parallel
 * first requests from creating two rows. So this store raises a real
 * `Prisma.PrismaClientKnownRequestError` with the same `code` and `meta.target`
 * Postgres would, and every write yields to the microtask queue first, so the
 * interleaving under `Promise.all` is genuine rather than assumed.
 *
 * What it cannot prove is stated plainly in the task report: this is a faithful
 * model of the constraint, not the constraint. The real race against Postgres
 * is exercised only in CI, where the container is available.
 *
 * Spec-only support code, excluded from `tsconfig.app.json`.
 */

import { randomUUID } from 'node:crypto';
import type { User } from '@garage/database';
import { Prisma } from '@garage/database';

const CLIENT_VERSION = '7.10.0';

/** Columns that are `@unique` on `model User`. */
const UNIQUE_COLUMNS = ['oktaId', 'email', 'icsToken'] as const;
type UniqueColumn = (typeof UNIQUE_COLUMNS)[number];

function uniqueViolation(column: UniqueColumn): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${column}\`)`,
    { code: 'P2002', clientVersion: CLIENT_VERSION, meta: { target: [column] } }
  );
}

/** Lets every concurrent caller reach its write before any of them commits. */
function tick(): Promise<void> {
  return Promise.resolve();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export interface UserSeed {
  id?: string;
  oktaId: string;
  email: string;
  name: string;
  role?: 'USER' | 'ADMIN';
  active?: boolean;
  icsToken?: string;
}

export class InMemoryUserStore {
  private readonly rows = new Map<string, User>();

  /** Every `create` this store has performed. The concurrency assertion. */
  createCount = 0;

  /**
   * Milliseconds an insert waits before it commits.
   *
   * A microtask tick is enough to interleave callers that are already inside
   * this process (`auth-user.service.spec.ts`). It is **not** enough when the
   * callers arrive over real HTTP: each `fetch` costs enough event-loop time
   * that the first request finishes provisioning before the second has read,
   * so the race never happens and the concurrency assertion holds trivially.
   * That was caught by a mutation test — deleting the P2002 retry left the
   * HTTP-level concurrency test green. Holding the insert open for a few
   * milliseconds puts every concurrent request inside `create` at once, which
   * is the situation the retry exists for.
   */
  createDelayMs = 0;

  constructor(seeds: UserSeed[] = []) {
    for (const seed of seeds) {
      this.insert({
        id: seed.id ?? randomUUID(),
        oktaId: seed.oktaId,
        email: seed.email,
        name: seed.name,
        licensePlate: null,
        role: seed.role ?? 'USER',
        active: seed.active ?? true,
        icsToken: seed.icsToken ?? randomUUID(),
        preferredParkingSpotId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  /** All rows, for assertions. */
  all(): User[] {
    return [...this.rows.values()];
  }

  /**
   * The subset of `PrismaService` `AuthUserService` uses, shaped so it can be
   * dropped in with `{ provide: PrismaService, useValue: store.asPrismaService() }`.
   */
  asPrismaService(): { client: { user: UserDelegate } } {
    return { client: { user: this.userDelegate() } };
  }

  private userDelegate(): UserDelegate {
    return {
      findUnique: async ({ where }) => {
        await tick();
        return this.find(where) ?? null;
      },
      create: async ({ data }) => {
        await tick();
        if (this.createDelayMs > 0) {
          await sleep(this.createDelayMs);
        }
        const row: User = {
          id: randomUUID(),
          licensePlate: null,
          role: 'USER',
          active: true,
          preferredParkingSpotId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        this.insert(row);
        this.createCount += 1;
        return row;
      },
      update: async ({ where, data }) => {
        await tick();
        const existing = this.find(where);
        if (existing === undefined) {
          throw new Prisma.PrismaClientKnownRequestError('Record not found', {
            code: 'P2025',
            clientVersion: CLIENT_VERSION,
          });
        }
        const updated: User = { ...existing, ...data, updatedAt: new Date() };
        this.rows.delete(existing.id);
        try {
          this.insert(updated);
        } catch (error) {
          // Put the original back: a rejected write must not lose the row.
          this.rows.set(existing.id, existing);
          throw error;
        }
        return updated;
      },
    };
  }

  private find(where: UserWhereUnique): User | undefined {
    return this.all().find(
      (row) =>
        (where.id !== undefined && row.id === where.id) ||
        (where.oktaId !== undefined && row.oktaId === where.oktaId) ||
        (where.email !== undefined && row.email === where.email)
    );
  }

  private insert(row: User): void {
    for (const column of UNIQUE_COLUMNS) {
      if (this.all().some((existing) => existing[column] === row[column])) {
        throw uniqueViolation(column);
      }
    }
    this.rows.set(row.id, row);
  }
}

interface UserWhereUnique {
  id?: string;
  oktaId?: string;
  email?: string;
}

interface UserDelegate {
  findUnique(args: { where: UserWhereUnique }): Promise<User | null>;
  create(args: { data: Pick<User, 'oktaId' | 'email' | 'name' | 'icsToken'> }): Promise<User>;
  update(args: { where: UserWhereUnique; data: Partial<User> }): Promise<User>;
}
