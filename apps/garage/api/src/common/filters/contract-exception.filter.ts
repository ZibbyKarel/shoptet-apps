/**
 * The global exception filter — the last thing between a thrown value and the
 * client.
 *
 * Three responsibilities, in this order of importance:
 *
 * 1. **A stack trace is logged, never sent.** Every branch below builds its
 *    response body from a fixed set of fields; the original error only ever
 *    reaches `this.logger`.
 * 2. **Domain failures come out as contract error codes** from the closed
 *    `ERROR_CODES` enum, with the status `ERROR_DEFINITIONS` assigns them.
 *    Nothing here invents a code or a status.
 * 3. **A Prisma constraint violation becomes the domain error it actually is.**
 *    What a database error *means* is decided by
 *    `common/errors/prisma-error-mapping.ts`, which this filter is only one
 *    consumer of — the cancellation retry loop is another. The filter's own job
 *    is the last step: turn the code that module returns into a response.
 *
 * ## Response shapes
 *
 * Which shape an error body has — oRPC's error JSON for a domain error, Nest's
 * `{ statusCode, message }` for a transport failure, and whether either is
 * wrapped in the RPC envelope — is decided by `common/errors/error-body.ts`.
 * This file only chooses which of them a given throw is.
 *
 * Two transport failures arrive as something other than an `HttpException` and
 * are handled explicitly below — see {@link asExposedClientError} (the body
 * parser's 413, which used to come out as a 500) and
 * {@link isHealthCheckResult} (terminus' 503 payload, which used to be
 * overwritten). Both were found by probing a running server; neither is
 * reachable from a unit test that calls a controller method directly.
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import { ERROR_DEFINITIONS } from '@garage/contract';
import { Prisma } from '@garage/database';
import { redactIcsToken } from '../../logging/redact-ics-token';
import { DomainError } from '../errors/domain-error';
import type { RpcEnvelope, TransportErrorBody } from '../errors/error-body';
import {
  asExposedClientError,
  contractErrorBody,
  INTERNAL_ERROR_BODY,
  isHealthCheckResult,
  isRpcRequest,
  rpcEnvelope,
} from '../errors/error-body';
import { mapPrismaErrorCode } from '../errors/prisma-error-mapping';

@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(ContractExceptionFilter.name)
    private readonly logger: PinoLogger
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    // Only contract errors are enveloped. Transport failures keep Nest's shape
    // even on an RPC path (`doc/decision/0033-*`): the closed enum has no member
    // for "no such route" or "too many requests", and dressing one up as an
    // oRPC error would hand the frontend a code it has no copy for. The oRPC
    // client falls back to the HTTP status for those, which is correct.
    const wrap = <T>(body: T): T | RpcEnvelope<T> =>
      isRpcRequest(http.getRequest<Request>()) ? rpcEnvelope(body) : body;

    if (exception instanceof DomainError) {
      // Expected: a rule was violated. `warn`, not `error` — this is not a
      // defect, and logging it at `error` would drown the ones that are.
      this.logger.warn(
        { err: exception, errorCode: exception.code, details: exception.details },
        'Domain rule violated'
      );
      response
        .status(exception.status)
        .json(wrap(contractErrorBody(exception.code, exception.details)));
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const code = mapPrismaErrorCode(exception);
      if (code === undefined) {
        this.logger.error({ err: exception, prismaCode: exception.code }, 'Unmapped Prisma error');
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(INTERNAL_ERROR_BODY);
        return;
      }
      this.logger.warn(
        { err: exception, prismaCode: exception.code, errorCode: code },
        'Database constraint mapped to a contract error'
      );
      // `exception.meta` is not forwarded as `data`: it names constraints and
      // columns, which is server internals.
      response.status(ERROR_DEFINITIONS[code].status).json(wrap(contractErrorBody(code)));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: TransportErrorBody = { statusCode: status, message: exception.message };
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        const payload = exception.getResponse();
        if (exception instanceof ServiceUnavailableException && isHealthCheckResult(payload)) {
          // A failing health probe. Logged at `warn` and **without** `err`: during
          // a database outage this fires once per probe interval forever, and a
          // stack per probe is noise, not signal. The reason is already in the
          // payload.
          this.logger.warn({ healthCheck: payload }, 'Health check reported not ready');
          response.status(status).json(payload);
          return;
        }
        this.logger.error({ err: exception }, 'Server-side HTTP exception');
        response.status(status).json(INTERNAL_ERROR_BODY);
        return;
      }
      // A 4xx the framework produced: no such route, a malformed body, a
      // throttled caller. Logged **without** `err`, for the same reason the
      // oversized-body branch below drops it — the stack is ten frames of
      // `@nestjs/core` router internals with no diagnostic value, and 404 is the
      // most common status on any public endpoint, so a scanner walking URLs
      // would otherwise write a multi-kilobyte log line per probe. The method
      // and path are what actually answer "what were they asking for", and they
      // are what is kept.
      //
      // Unlike `DomainError` above, which keeps its stack: there the frames name
      // the service and the rule that rejected the request, which is exactly the
      // question a reader has, and only an authenticated caller can trigger one.
      const request = http.getRequest<Request>();
      // Both string fields go through `redactIcsToken`, because both carry the
      // ICS feed's token on the path this branch is *most* likely to run for.
      // `path` obviously; `reason` less so — Nest's message for an unrouted URL
      // is `Cannot GET <url>`, so a token one character away from a valid one
      // (no `.ics`, say) arrives here embedded in the message.
      this.logger.warn(
        {
          statusCode: status,
          method: request.method,
          path: redactIcsToken(request.path),
          reason: redactIcsToken(exception.message),
        },
        'Request rejected'
      );
      response.status(status).json(body);
      return;
    }

    const clientError = asExposedClientError(exception);
    if (clientError !== undefined) {
      // A client input error caught before routing (an oversized body). `warn`,
      // and no `err`: forwarding the stack of something an anonymous caller can
      // trigger at will turns a client mistake into a log-flood vector.
      this.logger.warn(
        { statusCode: clientError.statusCode, errorType: (exception as { type?: unknown }).type },
        'Request rejected before routing'
      );
      response.status(clientError.statusCode).json(clientError);
      return;
    }

    // Anything else is a defect. The closed contract enum has no member for
    // "the server broke", and inventing one would let a bug masquerade as a
    // domain outcome the frontend knows how to explain.
    this.logger.error({ err: exception }, 'Unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(INTERNAL_ERROR_BODY);
  }
}
