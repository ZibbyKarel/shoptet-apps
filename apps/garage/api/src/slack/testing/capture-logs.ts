/**
 * A `PinoLogger` that writes into memory, so a spec can read the log lines the
 * application actually emitted.
 *
 * ## Why this exists
 *
 * Every other spec in `apps/garage/api` pins `LOG_LEVEL: 'fatal'`, which is the right
 * default — a test suite that printed request logs would be unreadable. But it
 * means **no test in this project has ever read a log line**, and that is
 * precisely how a bearer credential reached the logs in four places on an
 * earlier task and survived review. Redaction that nothing reads back is a
 * comment, not a control.
 *
 * So the Slack specs assert against real pino output at `trace`: the real
 * serializers, the real JSON, the real object pino builds from what the code
 * passed it — including any property pino adds that the call site did not.
 *
 * `__resetOutOfContextForTests` is not decoration either. `PinoLogger` caches
 * its underlying pino instance in a module-level variable and only builds one
 * if it is unset, so a second `captureLogs()` in the same file would silently
 * keep writing to the first spec's array.
 */

import pino from 'pino';
import { PinoLogger, __resetOutOfContextForTests } from 'nestjs-pino/PinoLogger';

export interface CapturedLogs {
  /** Hand this to the class under test. */
  readonly logger: PinoLogger;
  /** Every line emitted so far, parsed. */
  lines(): Record<string, unknown>[];
  /** Every line, as raw JSON text — for asserting a secret appears *nowhere*. */
  raw(): string;
}

export function captureLogs(): CapturedLogs {
  __resetOutOfContextForTests();

  const written: string[] = [];
  const instance = pino(
    {
      level: 'trace',
      // The same two fixed keys `buildLoggerOptions` installs, so a spec reads
      // `"level": "error"` and `"message": …` — what the running application
      // writes — rather than pino's raw `50` and `msg`.
      formatters: { level: (label: string) => ({ level: label }) },
      messageKey: 'message',
    },
    {
      write(chunk: string): void {
        written.push(chunk);
      },
    }
  );

  return {
    logger: new PinoLogger({ pinoHttp: { logger: instance } }),
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    raw: () => written.join(''),
  };
}
