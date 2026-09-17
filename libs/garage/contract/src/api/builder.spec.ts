/**
 * The procedure builders, split out of `errors.spec.ts` when `builder.ts` was
 * split out of `errors.ts`. The same assertions, against the module that now
 * holds them.
 */

import { ERROR_DEFINITIONS } from './errors';
import { authed, contractErrors } from './builder';

describe('contractErrors', () => {
  it('picks exactly the requested definitions', () => {
    const picked = contractErrors('NOT_FOUND', 'CONFLICT');
    expect(Object.keys(picked).sort()).toEqual(['CONFLICT', 'NOT_FOUND']);
    expect(picked.NOT_FOUND).toBe(ERROR_DEFINITIONS.NOT_FOUND);
  });

  it('narrows the type to the picked codes', () => {
    const picked = contractErrors('NOT_FOUND');
    // Type-level assertion: the result must not be widened to every code.
    const keys: 'NOT_FOUND'[] = Object.keys(picked) as (keyof typeof picked)[];
    expect(keys).toEqual(['NOT_FOUND']);
  });

  it('returns an empty map for no codes', () => {
    expect(contractErrors()).toEqual({});
  });
});

describe('authed', () => {
  it('declares FORBIDDEN on every procedure derived from it', () => {
    // A deactivated user is rejected before any handler runs, so FORBIDDEN is
    // reachable everywhere and is declared once rather than thirty times.
    expect(Object.keys(authed['~orpc'].errorMap)).toEqual(['FORBIDDEN']);
  });
});
