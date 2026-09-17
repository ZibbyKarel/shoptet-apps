/**
 * Unit-level coverage of `useAppForm` + `FormField` on their own, with a bare
 * `<input>` rather than a design-system primitive — the design-system
 * integration (and the "no direct react-hook-form import" proof) lives in
 * `app-form.spec.tsx`. This file exists so the wrapper's own plumbing is
 * covered independently of that heavier demo.
 */
import * as z from 'zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, FormProvider, useAppForm } from '@garage/form';

const emailSchema = z.object({
  email: z.email('Enter a valid email'),
});

type EmailValues = z.infer<typeof emailSchema>;

function EmailForm({ onValid }: { readonly onValid: (values: EmailValues) => void }) {
  const form = useAppForm({ schema: emailSchema, defaultValues: { email: '' } });

  return (
    <FormProvider {...form}>
      {/* `handleSubmit` returns a promise; React ignores a handler's return
          value, so `void` says the detachment is deliberate. */}
      <form onSubmit={(event) => void form.handleSubmit(onValid)(event)}>
        <FormField
          name="email"
          render={({ field, error }) => (
            <div>
              <label htmlFor="email-field">Email</label>
              <input id="email-field" aria-invalid={error ? true : undefined} {...field} />
              {error ? <p role="alert">{error}</p> : null}
            </div>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

describe('useAppForm + FormField', () => {
  it('reflects the Zod validation message into the field, observably', async () => {
    const user = userEvent.setup();
    render(<EmailForm onValid={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('calls the submit handler with the schema-parsed values once valid', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    render(<EmailForm onValid={onValid} />);

    await user.type(screen.getByLabelText('Email'), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid).toHaveBeenCalledWith({ email: 'person@example.com' }, expect.anything());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * The `TIn`/`TOut` split — the central design claim of `use-app-form.ts` and
 * the subject of `doc/decision/0031-*`.
 *
 * Every other form in this workspace uses a schema whose input and output types
 * are **the same** (`.refine()` does not change a type, and both call sites in
 * `apps/garage/web` write `useAppForm<TValues>` with `TOut` defaulting to `TIn`), so
 * until this suite existed the whole two-parameter apparatus was unexercised: a
 * refactor back to the `schema: TSchema` shape the file's comment says was tried
 * and abandoned would have compiled and passed every form test, silently
 * re-widening `Output`/`Input` to the constraint's `FieldValues`.
 *
 * A transforming schema is what makes the split observable. `age` is a string in
 * the field and a number in the submitted values — the same relationship
 * `z.coerce.number()` produces, written as an explicit `.transform` so **both**
 * halves are concrete types rather than `unknown`, which is what lets the
 * compile-time assertions below say something in both directions.
 *
 * Three of the assertions here are carried by `typecheck`, not by Jest:
 * `draftAge`, `parsedAge`, and the `@ts-expect-error`. The last is the one that
 * fails loudly on a collapse — if `TOut` ever widens back to `TIn`, assigning
 * `values.age` to a `string` stops being an error and `tsc` rejects the unused
 * directive.
 */
const profileSchema = z.object({
  name: z.string().min(1, 'Enter a name'),
  age: z
    .string()
    .regex(/^\d+$/, 'Enter a whole number')
    .transform((raw) => Number(raw)),
});

type ProfileIn = z.input<typeof profileSchema>;
type ProfileOut = z.output<typeof profileSchema>;

function ProfileForm({ onValid }: { readonly onValid: (values: ProfileOut) => void }) {
  const form = useAppForm<ProfileIn, ProfileOut>({
    schema: profileSchema,
    defaultValues: { name: '', age: '' },
  });

  return (
    <FormProvider {...form}>
      {/* `handleSubmit` returns a promise; React ignores a handler's return
          value, so `void` says the detachment is deliberate. */}
      <form
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            // `TIn`: what the field holds, before the transform. A `string` —
            // this line is a compile error the moment `TIn` widens to
            // `FieldValues`, which is exactly what the abandoned
            // `schema: TSchema` signature did (`doc/decision/0031-*`).
            const draftAge: string = form.getValues('age');
            void draftAge;

            // `TOut`: after the transform. A `number`, so arithmetic compiles.
            const parsedAge: number = values.age;

            // @ts-expect-error `values` is TOut, where `age` is a number. This
            // directive is the guard: if TOut ever collapses back to TIn, `age`
            // becomes a string, the assignment becomes legal, and `tsc` fails on
            // the now-unused `@ts-expect-error`.
            const collapsed: string = values.age;
            void collapsed;

            onValid({ ...values, age: parsedAge });
          })(event)
        }
      >
        <label htmlFor="name-field">Name</label>
        <input id="name-field" {...form.register('name')} />
        <label htmlFor="age-field">Age</label>
        <input id="age-field" {...form.register('age')} />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

describe('useAppForm — the TIn/TOut split', () => {
  it('reads the raw field value as TIn and submits the transformed value as TOut', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    render(<ProfileForm onValid={onValid} />);

    await user.type(screen.getByLabelText('Name'), 'Jana');
    await user.type(screen.getByLabelText('Age'), '42');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // The runtime half: `42`, not `'42'`. A resolver wired so that the callback
    // receives the *field* values rather than the schema's parsed output would
    // hand back the string and pass a `toEqual` written loosely enough — so the
    // type is asserted separately from the value.
    expect(onValid).toHaveBeenCalledTimes(1);
    const submitted = onValid.mock.calls[0]?.[0] as ProfileOut;
    expect(submitted).toEqual({ name: 'Jana', age: 42 });
    expect(typeof submitted.age).toBe('number');
  });

  it('rejects before the transform runs, so nothing reaches the handler', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    render(<ProfileForm onValid={onValid} />);

    await user.type(screen.getByLabelText('Name'), 'Jana');
    await user.type(screen.getByLabelText('Age'), 'forty-two');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // The schema rejects before the transform runs, so nothing is submitted —
    // which is what makes `TOut` a promise rather than a hope.
    expect(onValid).not.toHaveBeenCalled();
  });
});
