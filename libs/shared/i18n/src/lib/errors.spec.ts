/**
 * @jest-environment node
 *
 * `@garage/contract`'s barrel also pulls in `@orpc/client` at runtime
 * (through the oRPC procedure builders), which references the web
 * `TransformStream` global that jsdom — this project's default test
 * environment, needed by `provider.spec.tsx` — does not provide. This file
 * never touches the DOM, so it runs under plain Node instead.
 */

import { ERROR_CODES } from '@garage/contract';
import type { ErrorCode } from '@garage/contract';
import { createErrorTranslator } from './errors';

/**
 * A fixture, not the real catalog: the real ones live in `apps/garage/web/messages`
 * and their completeness is guarded there (`apps/garage/web/messages/messages.spec.ts`),
 * because that is where they can be read for *every* locale at once. This spec
 * is about the translator, not about the copy.
 */
const messages = {
  errors: Object.fromEntries(ERROR_CODES.map((code) => [code, `sentence for ${code}`])),
};

it('resolves every contract error code through the namespace', () => {
  const translate = createErrorTranslator('cs', messages);

  for (const code of ERROR_CODES) {
    expect(translate(code as ErrorCode)).toBe(`sentence for ${code}`);
  }
});

it('reads the catalog it is given, so two locales cannot share one translator', () => {
  const czech = createErrorTranslator('cs', { errors: { FORBIDDEN: 'Nemáte oprávnění.' } });
  const english = createErrorTranslator('en', { errors: { FORBIDDEN: 'You’re not allowed.' } });

  expect(czech('FORBIDDEN' as ErrorCode)).toBe('Nemáte oprávnění.');
  expect(english('FORBIDDEN' as ErrorCode)).toBe('You’re not allowed.');
});
