import { useForm } from 'react-hook-form';
import type { FieldValues, UseFormProps, UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';

/**
 * Options for {@link useAppForm}: every `UseFormProps` react-hook-form itself
 * accepts, minus `resolver` (which `useAppForm` always derives from
 * `schema`), plus the schema itself.
 *
 * `useAppForm` is parameterised directly on `TIn`/`TOut` (the field-value and
 * submitted-value shapes), not on the schema's own type — see the comment on
 * `useAppForm` for why that is what lets `zodResolver`'s result flow through
 * with no cast. `schema` is typed as `z.ZodType<TOut, TIn>` rather than a
 * `libs/garage/contract` schema — this lib is domain-free and validates whatever Zod
 * object schema a caller (in `apps/garage/web` or a future `type:feature` lib)
 * passes in.
 */
export interface UseAppFormOptions<TIn extends FieldValues, TOut extends FieldValues = TIn>
  extends Omit<UseFormProps<TIn, unknown, TOut>, 'resolver'> {
  /** The single source of truth for this form's shape and validation rules. */
  readonly schema: z.ZodType<TOut, TIn>;
}

/**
 * `UseFormReturn` typed from one Zod schema: field values are `TIn`
 * (what `register`/`Controller` read and write, before Zod's own transforms),
 * and `handleSubmit`'s callback receives `TOut` (after them) — the same split
 * react-hook-form itself makes between "field values" and "transformed
 * values".
 */
export type AppForm<TIn extends FieldValues, TOut extends FieldValues = TIn> = UseFormReturn<
  TIn,
  unknown,
  TOut
>;

/**
 * The one place `useForm` is called in the whole workspace.
 *
 * Wires a Zod schema into react-hook-form via `@hookform/resolvers/zod`, so
 * every form in the product validates against the same schema its submit
 * request will ultimately be checked against again by the contract
 * (`libs/garage/contract`) — never a hand-duplicated set of validation rules.
 *
 * A typo in a field name passed to `register`/`control` elsewhere is a
 * compile error, because `TIn`/`TOut` drive both the field-value type and the
 * submitted-value type; nothing here falls back to `any`.
 *
 * `useAppForm` is generic over `TIn`/`TOut` themselves, not over the schema's
 * own type (an earlier version was generic over `TSchema extends
 * z.ZodType<FieldValues, FieldValues>` and cast `zodResolver`'s result through
 * `unknown` — see decision 0031). `zodResolver`'s own signature is generic
 * over a type parameter `T extends Zod4Type<Output, Input>` that it infers
 * from its `schema` argument. Inference behaves differently depending on
 * *how* the argument's type mentions the caller's generics:
 * - when `schema`'s declared type is a bare, still-unresolved type parameter
 *   (`schema: TSchema`), TypeScript can only match `T` against `TSchema`'s
 *   *constraint*, not its eventual instantiation, so `Output`/`Input` widen to
 *   the constraint's `FieldValues`/`FieldValues` — a mismatch with the
 *   caller-facing `Resolver<TIn, unknown, TOut>` `useForm` expects below;
 * - when `schema`'s declared type instead *applies* the caller's generics
 *   structurally (`schema: z.ZodType<TOut, TIn>`), `TOut`/`TIn` sit in
 *   argument positions TypeScript can unify against directly, the same way
 *   `function unwrap<A>(x: Box<A>): A` infers `A` from `Box<A>` even though
 *   `A` is still generic. `zodResolver` then reports exactly `Resolver<TIn,
 *   unknown, TOut>`, which is what `useForm` needs — no cast required.
 *
 * **Exercised, not just reasoned:** `use-app-form.spec.tsx`, "the TIn/TOut
 * split", is the only place in the workspace where a schema's input and output
 * types actually differ — every other form here (and both `apps/garage/web` call
 * sites, which write `useAppForm<TValues>` and let `TOut` default to `TIn`)
 * uses a schema where they coincide, so nothing else can tell the two-parameter
 * form from the one-parameter one. That suite pins both halves:
 *
 * - at runtime, `handleSubmit` receives `age: 42` from a field holding `'42'`;
 * - at compile time, `form.getValues('age')` is a `string` and `values.age` in
 *   `handleSubmit` is a `number`, with a `@ts-expect-error` on the assignment
 *   that only type-errors while the two are different. Collapse `TOut` back to
 *   `TIn` and `typecheck` fails twice — measured, not assumed.
 */
export function useAppForm<TIn extends FieldValues, TOut extends FieldValues = TIn>(
  options: UseAppFormOptions<TIn, TOut>
): AppForm<TIn, TOut> {
  const { schema, ...formOptions } = options;

  const resolver = zodResolver(schema);

  return useForm<TIn, unknown, TOut>({
    ...formOptions,
    resolver,
  });
}
