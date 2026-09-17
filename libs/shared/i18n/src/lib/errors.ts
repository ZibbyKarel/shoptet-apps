/**
 * UI copy for the contract's closed error-code enum
 * (`libs/garage/contract/src/schemas/errors.ts`, `doc/contract.md`), outside React.
 *
 * Inside a component, `useTranslations('errors')` is the way — it reads the
 * catalog already on the provider. This factory exists for the plain-TypeScript
 * callers (a server action, a non-component helper) that have a catalog in hand
 * but no React context, and it goes through the same next-intl ICU resolution,
 * so the two paths cannot drift.
 *
 * The catalog is a parameter because it now lives in the application
 * (`apps/garage/web/messages/*.json`) and there is more than one of them — see
 * `./provider.tsx`.
 */

import { createTranslator } from 'next-intl';
import type { ErrorCode } from '@garage/contract';
import type { Locale } from './locale';
import type { AppMessages } from './provider';

/**
 * Builds the `code → sentence` function for one locale's catalog.
 *
 * Completeness is not this function's job to assert: `ErrorCode` is a closed
 * union, and `apps/garage/web/messages/messages.spec.ts` fails if any locale's
 * `errors` namespace is missing one of its members — which is a better place
 * for that check than here, because it can see every locale at once.
 */
export function createErrorTranslator(
  locale: Locale,
  messages: AppMessages
): (code: ErrorCode) => string {
  // `createTranslator` infers its key type from the `messages` argument, so a
  // `Record<string, unknown>` would infer `never` and make `translator(code)`
  // a type error. Narrowing to the one namespace this function reads is what
  // gives it `ErrorCode` keys — and it is an honest narrowing: a catalog whose
  // `errors` namespace is incomplete fails
  // `apps/garage/web/messages/messages.spec.ts`, which is the check that makes this
  // assertion safe rather than hopeful.
  const translator = createTranslator({
    locale,
    namespace: 'errors',
    messages: messages as { readonly errors: Readonly<Record<ErrorCode, string>> },
  });

  return (code) => translator(code);
}
