'use client';

/**
 * The admin's three holder fields, for a free bay.
 *
 * Presentational, and deliberately **not** its own form: it renders inside
 * `SpotDialog`'s `FormProvider`, because the submit button lives in the
 * `Modal`'s footer, outside this subtree. That is the same split
 * `apps/garage/web/src/shell/admin/admin-spots-screen/spot-form-dialog.tsx` uses —
 * `form.handleSubmit` is created in the component that owns the modal, and the
 * fields sit under the provider.
 *
 * Domain composition, so it lives in app feature code and never in
 * `libs/shared/design-system` (`plan.md`, design-system-first).
 */

import { Box, Input, Select, Stack } from '@garage/design-system/primitives';
import { FormField } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import { GUEST_HOLDER_VALUE, plateHintFor } from './holder-input';
import type { HolderFormValues, HolderOption } from './holder-input';

export interface HolderFieldsProps {
  readonly options: readonly HolderOption[];
  /** The `holderId` currently selected — the guest field is only shown for a guest. */
  readonly holderId: string;
}

export function HolderFields({ options, holderId }: HolderFieldsProps) {
  const t = useTranslations('lot');
  const hint = plateHintFor(options, holderId);

  // `mb-5` was baked into the field stack's own className; it is this
  // component's placement in `SpotDialog`, not part of `Stack`'s own chrome,
  // so it moves to a wrapping `Box margin=`.
  return (
    <Box margin={[0, 0, 5, 0]}>
      <Stack spacing={4}>
        <FormField<HolderFormValues, 'holderId'>
          name="holderId"
          render={({ field, error: fieldError }) => (
            <Select label={t('holderField')} error={fieldError} {...field}>
              {options.map((option) => (
                <option key={option.userId} value={option.userId}>
                  {option.name}
                  {option.licensePlate === null ? '' : ` — ${option.licensePlate}`}
                </option>
              ))}
              <option value={GUEST_HOLDER_VALUE}>{t('holderGuestOption')}</option>
            </Select>
          )}
        />

        {holderId === GUEST_HOLDER_VALUE ? (
          <FormField<HolderFormValues, 'guestName'>
            name="guestName"
            render={({ field, error: fieldError }) => (
              <Input
                label={t('guestNameField')}
                // The schema carries no messages — it is built at module level,
                // where there is no translator — so the copy is resolved here.
                error={fieldError === undefined ? undefined : t('guestNameRequired')}
                {...field}
              />
            )}
          />
        ) : null}

        <FormField<HolderFormValues, 'licensePlate'>
          name="licensePlate"
          render={({ field, error: fieldError }) => (
            <Input
              label={t('plateField')}
              // Blank means "use the holder's stored plate", so the placeholder is
              // what will actually be used — not a hint about formatting.
              placeholder={hint ?? t('noPlate')}
              error={fieldError}
              {...field}
            />
          )}
        />
      </Stack>
    </Box>
  );
}
