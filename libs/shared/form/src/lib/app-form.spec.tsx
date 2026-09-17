/**
 * The whole point of `libs/shared/form` is that a real, validated, submittable form
 * can be built from `@garage/form` plus design-system primitives without
 * ever importing `react-hook-form` directly (`doc/wrappers.md`). This file's
 * own import list — `@garage/form`, `@garage/design-system/primitives`
 * and `zod`, nothing else — *is* that proof, and the last test below reads
 * this file's own source back off disk to make the claim self-checking
 * rather than something a reviewer has to take on faith.
 */
import { readFileSync } from 'node:fs';
import * as z from 'zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, Input, Select } from '@garage/design-system/primitives';
import { FormField, FormProvider, useAppForm } from '@garage/form';

const demoSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.email('Enter a valid email'),
  role: z.enum(['driver', 'admin']),
  acceptsTerms: z.boolean().refine((value) => value === true, {
    message: 'You must accept the terms',
  }),
});

type DemoValues = z.infer<typeof demoSchema>;

/**
 * A complete form: text input, select, checkbox, all validated by one Zod
 * schema and rendered through design-system primitives. No primitive here
 * knows anything about react-hook-form — each `FormField` hands it plain
 * `value`/`onChange`/`onBlur`/`name`/`ref` props and a resolved `error`
 * string, per `FieldOwnProps`.
 */
function DemoForm({ onValid }: { readonly onValid: (values: DemoValues) => void }) {
  const form = useAppForm({
    schema: demoSchema,
    defaultValues: { name: '', email: '', role: 'driver', acceptsTerms: false },
  });

  return (
    <FormProvider {...form}>
      {/* `handleSubmit` returns a promise; React ignores a handler's return
          value, so `void` says the detachment is deliberate. */}
      <form onSubmit={(event) => void form.handleSubmit(onValid)(event)}>
        <FormField
          name="name"
          render={({ field, error }) => <Input label="Name" error={error} {...field} />}
        />
        <FormField
          name="email"
          render={({ field, error }) => <Input label="Email" error={error} {...field} />}
        />
        <FormField
          name="role"
          render={({ field, error }) => (
            <Select label="Role" error={error} {...field}>
              <option value="driver">Driver</option>
              <option value="admin">Admin</option>
            </Select>
          )}
        />
        <FormField
          name="acceptsTerms"
          render={({ field, error }) => (
            <Checkbox
              label="I accept the terms"
              error={error}
              name={field.name}
              checked={field.value}
              onChange={(event) => field.onChange(event.target.checked)}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

describe('a form built only from @garage/form + design-system primitives', () => {
  it('reflects Zod validation errors into each primitive error state, observably', async () => {
    const user = userEvent.setup();
    render(<DemoForm onValid={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const nameField = screen.getByLabelText('Name');
    const emailField = screen.getByLabelText('Email');
    const termsField = screen.getByLabelText('I accept the terms');

    // What a screen reader/user actually observes: an announced message
    // (`role="alert"`) plus `aria-invalid`, not merely an errors object.
    // `role="alert"` takes its *accessible name* from an explicit label, not
    // its text content, so the messages are asserted via content, not `name`.
    const alerts = await screen.findAllByRole('alert');
    const alertText = alerts.map((alert) => alert.textContent);
    expect(alertText).toEqual(
      expect.arrayContaining([
        'Name is required',
        'Enter a valid email',
        'You must accept the terms',
      ])
    );
    expect(nameField).toHaveAttribute('aria-invalid', 'true');
    expect(emailField).toHaveAttribute('aria-invalid', 'true');
    expect(termsField).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits the Zod-parsed values once every field is valid', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    render(<DemoForm onValid={onValid} />);

    await user.type(screen.getByLabelText('Name'), 'Jana Nováková');
    await user.type(screen.getByLabelText('Email'), 'jana@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'admin');
    await user.click(screen.getByLabelText('I accept the terms'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid).toHaveBeenCalledWith(
      {
        name: 'Jana Nováková',
        email: 'jana@example.com',
        role: 'admin',
        acceptsTerms: true,
      },
      expect.anything()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never imports react-hook-form directly in this file', () => {
    // A demonstration that the wrapper's API is *sufficient* for the whole form
    // above — **not** the defence against the ban being broken. This file is
    // inside the lib that owns `react-hook-form`, where the import is legal and
    // ESLint would not object to it. The ban is `no-restricted-imports` in
    // `eslint.config.mjs` (`WRAPPED_LIBRARIES`), verified separately by linting
    // `apps/**`; delete that rule and this test still passes.
    const source = readFileSync(__filename, 'utf-8');
    expect(source).not.toMatch(/from ['"]react-hook-form['"]/);
    expect(source).not.toMatch(/require\(['"]react-hook-form['"]\)/);
  });
});
