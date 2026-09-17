/**
 * The wire shape of a contract error body, independent of the filter that
 * writes it: that a code carries the status and message the contract assigns
 * rather than a local guess, and that the result satisfies `errorShapeSchema`.
 */

import { errorShapeSchema } from '@garage/contract';
import { contractErrorBody } from './error-body';

describe('contractErrorBody', () => {
  it('carries the status and message the contract assigns, not a local guess', () => {
    expect(contractErrorBody('RESERVATIONS_LOCKED')).toEqual({
      defined: false,
      code: 'RESERVATIONS_LOCKED',
      status: 423,
      message: 'The reservation window for that month is closed.',
    });
  });

  it('keeps OUT_OF_HORIZON and RESERVATIONS_LOCKED distinct (ruling window-3)', () => {
    const notYetOpen = contractErrorBody('OUT_OF_HORIZON');
    const alreadyClosed = contractErrorBody('RESERVATIONS_LOCKED');

    expect(notYetOpen.code).not.toBe(alreadyClosed.code);
    expect(notYetOpen.status).toBe(422);
    expect(alreadyClosed.status).toBe(423);
  });

  it('produces a body that satisfies the Task 3 error contract', () => {
    const body = contractErrorBody('SPOT_ALREADY_RESERVED', { reservationId: 'abc' });

    // `data` is `details` under oRPC's name for the same field (decision 0018).
    expect(
      errorShapeSchema.safeParse({
        code: body.code,
        message: body.message,
        details: body.data,
      }).success
    ).toBe(true);
  });

  it('omits data entirely when there are no details', () => {
    expect(contractErrorBody('NOT_FOUND')).not.toHaveProperty('data');
  });
});
