/**
 * `@garage/form` — the only place in the workspace allowed to import
 * `react-hook-form` (enforced in `eslint.config.mjs`, see `doc/wrappers.md`).
 *
 * The bridge between `libs/garage/contract`'s Zod schemas and the design system's
 * input primitives (`Input`, `Select`, `Checkbox`, ...):
 *
 * - `useAppForm` — wires a Zod schema into react-hook-form via
 *   `@hookform/resolvers/zod`.
 * - `FormProvider` — supplies the resulting form as context to the tree
 *   below it.
 * - `FormField` — connects one field's value and Zod error message to one
 *   primitive, without the primitive ever seeing react-hook-form itself.
 *
 * Deliberately narrow: this is the whole API. See `doc/wrappers.md` for why.
 */
/**
 * Named rather than `export *`, so that what leaves this lib is a decision
 * someone made. The four types below are the option and render-argument types
 * of `useAppForm` and `FormField` — a consumer annotating its own variable
 * wants them — but under a star they were published by accident, which is the
 * same shape as the shelves the other wrappers had grown.
 */
export { useAppForm } from './lib/use-app-form';
export type { AppForm, UseAppFormOptions } from './lib/use-app-form';

export { FormField } from './lib/form-field';
export type { FormFieldProps, FormFieldRenderArgs } from './lib/form-field';

export { FormProvider } from './lib/form-provider';
export type { FormProviderProps } from './lib/form-provider';

/**
 * Re-exported so a consumer already inside a `FormProvider` tree can type its
 * own props (a `name`, a submit handler, a field-value shape) without a
 * second, direct `react-hook-form` import — this lib stays the only allowed
 * import site for the package itself.
 */
export type {
  Control,
  ControllerRenderProps,
  FieldPath,
  FieldValues,
  SubmitHandler,
} from 'react-hook-form';
