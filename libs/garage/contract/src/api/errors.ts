/**
 * The error table: one definition per domain error code.
 *
 * Bridge between the Task 3 error contract (`ERROR_CODES`, `errorShapeSchema`)
 * and oRPC's typed-error mechanism.
 *
 * oRPC carries errors as `{ code, message, data }`, where `code` is the key of
 * the procedure's error map. Our contract calls the third field `details`, but
 * it is the same field — see
 * `doc/decision/0018-mapping-error-contract-to-orpc.md`. Nothing here invents
 * a new code: the map below is keyed by `ErrorCode` and TypeScript rejects a
 * key that is not in `ERROR_CODES`.
 *
 * The tools a procedure is *defined* with — `authed`, `contractErrors`,
 * `noInputSchema` — used to live here too. They are in `./builder`, because an
 * input schema in a file called `errors.ts` is filed under the wrong idea, and
 * because the two halves have different audiences: `ERROR_DEFINITIONS` is read
 * by both applications, the builders only ever by the ten procedure modules
 * beside them.
 */

import type { ErrorMapItem } from '@orpc/contract';
import type { ErrorCode } from '../schemas/errors';
import { errorDetailsSchema } from '../schemas/errors';

/**
 * Schema of every error's `data`. Optional, because most failures need nothing
 * beyond their code; the ones that do (a conflicting reservation's id, the
 * month that is locked) put it here.
 */
export const errorDataSchema = errorDetailsSchema.optional();

type ErrorDefinition = ErrorMapItem<typeof errorDataSchema>;

/**
 * The one definition per domain error code: the HTTP status the transport maps
 * it to, and a default message used when the thrower does not supply one.
 *
 * The `message` is a developer-facing fallback for logs and unexpected clients.
 * User-visible Czech copy is keyed off `code` in `libs/shared/i18n` and never comes
 * from here.
 */
export const ERROR_DEFINITIONS = {
  SPOT_ALREADY_RESERVED: {
    status: 409,
    message: 'The parking spot is already reserved for that day.',
    data: errorDataSchema,
  },
  RESERVATION_LIMIT_REACHED: {
    status: 409,
    message: 'The user already has a reservation for that day.',
    data: errorDataSchema,
  },
  MONTHLY_RESERVATION_LIMIT_REACHED: {
    status: 409,
    message: 'The user already holds the maximum number of reservations for that month.',
    data: errorDataSchema,
  },
  PAST_DATE: {
    status: 422,
    message: 'The date is in the past (Europe/Prague).',
    data: errorDataSchema,
  },
  OUT_OF_HORIZON: {
    status: 422,
    message: 'Reservations for that month have not opened yet.',
    data: errorDataSchema,
  },
  NOT_FOUND: {
    status: 404,
    message: 'The requested entity does not exist.',
    data: errorDataSchema,
  },
  FORBIDDEN: {
    status: 403,
    message: 'The caller is not allowed to perform this action.',
    data: errorDataSchema,
  },
  ALREADY_IN_WAITLIST: {
    status: 409,
    message: 'The user is already queued for that spot and day.',
    data: errorDataSchema,
  },
  CANNOT_WAITLIST_OWN_SPOT: {
    status: 422,
    message: 'The user already holds the reservation for that spot and day.',
    data: errorDataSchema,
  },
  SPOT_NOT_OCCUPIED: {
    status: 409,
    message: 'The spot is free — reserve it instead of queueing for it.',
    data: errorDataSchema,
  },
  VALIDATION_FAILED: {
    status: 400,
    message: 'The request is structurally valid but violates a domain rule.',
    data: errorDataSchema,
  },
  CONFLICT: {
    status: 409,
    message: 'The request lost a race against a concurrent change.',
    data: errorDataSchema,
  },
  RESERVATIONS_LOCKED: {
    status: 423,
    message: 'The reservation window for that month is closed.',
    data: errorDataSchema,
  },
} satisfies Record<ErrorCode, ErrorDefinition>;
