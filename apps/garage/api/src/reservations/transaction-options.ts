/**
 * The one set of transaction options every reservation mutation uses.
 *
 * `timeout` is raised above Prisma's 5 s default because these transactions can
 * legitimately *wait*: `SELECT … FOR UPDATE` in the cancel path blocks against a
 * concurrent `waitlist.leave` on the same rows, the insert blocks on the unique
 * index against a concurrent create for the same cell, and a bulk confirmation
 * blocks on another confirmation's uncommitted keys. `maxWait` is how long to
 * wait for a *connection from the pool*, which is a different and much shorter
 * thing.
 *
 * It lives here, once, because it is one decision: the three services used to
 * hold byte-identical copies under three names, and the next person to tune the
 * timeout would have changed one of them with nothing to say the other two had
 * drifted.
 */
export const RESERVATION_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
