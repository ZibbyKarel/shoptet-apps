/**
 * Rate limiting for log lines, keyed by a fixed set of failure kinds.
 *
 * ## Why this exists
 *
 * An IdP outage puts **every** request down the same failure path. Logging one
 * line per request turns a broken dependency into a log flood — which costs
 * money, buries the one line an operator needed, and is trivially amplified by
 * an anonymous caller, since a rejected token is rejected before any rate
 * limiting on identity can apply.
 *
 * Logging nothing is what the review found instead: four genuinely different
 * operator problems (a dead issuer, a mistyped `AUTH_OKTA_ISSUER`, a rejected
 * discovery document, an exhausted JWKS rate limit) all reached the operator as
 * an indistinguishable silent 401.
 *
 * So: **the first occurrence of each kind is logged immediately, and further
 * occurrences of that same kind are counted rather than printed** until the
 * interval elapses. The next line that does get through carries
 * `suppressedSinceLastLog`, so the volume is still visible — an operator sees
 * both *what* is wrong and *how much* of it is happening.
 *
 * ## Why it is keyed by kind and never by input
 *
 * The map is bounded by the number of `AuthFailureKind` members — six. Keying
 * it by anything a caller controls (a `kid`, an issuer, a subject) would make
 * an unbounded map an anonymous caller can grow at will, i.e. trade a log flood
 * for a memory leak. `kid` is *reported inside* a line; it never becomes a key.
 *
 * The precedent is `doc/decision/0035-*`: the readiness probe logs a database
 * outage at `warn` and without the error object, because during an outage it
 * fires once per probe interval forever and a stack per probe is noise rather
 * than signal. Same shape, same answer.
 */

/** An injectable clock, so the interval can be tested without fake timers. */
export type Clock = () => number;

export interface ThrottleDecision {
  /** Whether the caller should emit a log line now. */
  readonly shouldLog: boolean;
  /**
   * How many occurrences of this kind were swallowed since the last emitted
   * line. Only meaningful when `shouldLog` is true, and `0` when nothing was
   * suppressed — the caller omits the field entirely in that case, so a quiet
   * period does not add noise to the line.
   */
  readonly suppressedSinceLastLog: number;
}

export class FailureLogThrottle<TKind extends string> {
  private readonly state = new Map<TKind, { lastLoggedAt: number; suppressed: number }>();

  constructor(
    private readonly intervalMs: number,
    private readonly now: Clock = Date.now
  ) {}

  /**
   * Records an occurrence and decides whether it should be logged.
   *
   * Deliberately has a side effect: the counter has to advance whether or not
   * the line is emitted, and splitting that into "ask" and "tell" invites a
   * caller that asks and then forgets to tell.
   */
  record(kind: TKind): ThrottleDecision {
    const timestamp = this.now();
    const previous = this.state.get(kind);

    if (previous !== undefined && timestamp - previous.lastLoggedAt < this.intervalMs) {
      previous.suppressed += 1;
      return { shouldLog: false, suppressedSinceLastLog: 0 };
    }

    this.state.set(kind, { lastLoggedAt: timestamp, suppressed: 0 });
    return { shouldLog: true, suppressedSinceLastLog: previous?.suppressed ?? 0 };
  }
}
