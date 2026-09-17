/**
 * Structured logging.
 *
 * Every log line is one JSON object on stdout — no `console.log` anywhere in
 * the app, and no pretty-printer even in development. A pretty transport runs
 * the formatter on a worker thread, which is one more thing to close during
 * graceful shutdown and one more way for the last lines before exit to be lost;
 * `nx serve api | npx pino-pretty` gives a developer the same output without
 * putting that in the process.
 *
 * ## Request correlation
 *
 * `genReqId` reuses an inbound `x-request-id` when there is one (so a value set
 * by a proxy or by the web app survives the hop) and mints a UUID otherwise.
 * The id is echoed back in the `x-request-id` response header, so a user
 * reporting a failure can quote something that is greppable in the logs.
 *
 * ## Redaction
 *
 * `authorization` and `cookie` carry bearer tokens and session cookies. They
 * are removed rather than masked so that no prefix of a token survives.
 *
 * Headers are not the only place a credential arrives, though. The ICS feed
 * puts its token **in the path**, which the default request serializer writes
 * twice — once as `req.url`, once again as `req.params` — so {@link serializeRequest}
 * below rewrites the first and drops the second. `redact` cannot do the first
 * job (it removes whole keys; the url is still wanted, minus one segment) and
 * would be an odd place for the second.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params as PinoParams } from 'nestjs-pino';
import type { ApiEnv } from '../env';
import { HEALTH_ROUTE_PREFIX } from '../health/health.controller';
import { redactIcsToken } from './redact-ics-token';

/** The header a request id is read from and echoed back on. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * What `pino-std-serializers` produces for a request, of which only the two
 * fields this file rewrites are named. Declared structurally rather than
 * imported: `pino-http` re-exports the type under a name that has moved between
 * versions, and everything else on the object is passed through untouched.
 */
interface SerializedRequest {
  url?: string;
  params?: unknown;
  [key: string]: unknown;
}

/**
 * The request as it is written to the log.
 *
 * `pino-http` hands this the **already-serialized** object (it wraps a custom
 * `req` serializer in `wrapRequestSerializer`), so this is a rewrite of the
 * default output rather than a replacement for it.
 *
 * Two changes, both about the ICS feed's token — see `./redact-ics-token.ts`:
 *
 * - **`url` is redacted**, not dropped. The path is how anyone reads a log; a
 *   feed request that logged no URL at all would be indistinguishable from any
 *   other request in the file.
 * - **`params` is dropped entirely.** It is not the route's parameters: this
 *   serializer runs from `nestjs-pino`'s catch-all middleware, so what lands
 *   there is that middleware's own splat — `{ path: ['calendar', '<token>.ics'] }`
 *   — a second, differently-shaped copy of the URL and nothing else. Removing
 *   it costs no information and closes the whole class: any future secret in a
 *   path leaks through `params` too, and only `url` is easy to remember.
 */
export function serializeRequest(request: SerializedRequest): SerializedRequest {
  const { params: _params, ...rest } = request;
  return typeof request.url === 'string' ? { ...rest, url: redactIcsToken(request.url) } : rest;
}

export function buildLoggerOptions(env: Pick<ApiEnv, 'LOG_LEVEL' | 'NODE_ENV'>): PinoParams {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,

      genReqId(request: IncomingMessage, response: ServerResponse) {
        const existing = request.headers[REQUEST_ID_HEADER];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        response.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },

      // Fixed keys so a log aggregator can index them without a per-field rule.
      messageKey: 'message',
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      base: { app: 'api', env: env.NODE_ENV },

      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        remove: true,
      },

      serializers: { req: serializeRequest },

      // Severity of the per-request line: a 5xx or a thrown error is `error`, a
      // 4xx is `warn`, everything else `info`. Note this never fires for the
      // health probes — `exclude` below drops their request logging entirely.
      customLogLevel(_request, response, error) {
        if (error !== undefined || response.statusCode >= 500) {
          return 'error';
        }
        if (response.statusCode >= 400) {
          return 'warn';
        }
        return 'info';
      },
    },

    // `nestjs-pino`'s own per-request log line is suppressed for the probe
    // routes; the requests still reach the app and errors still surface through
    // the exception filter's logger.
    exclude: [`${HEALTH_ROUTE_PREFIX}/live`, `${HEALTH_ROUTE_PREFIX}/ready`],
  };
}
