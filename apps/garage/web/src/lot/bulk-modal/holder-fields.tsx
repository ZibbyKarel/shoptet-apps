'use client';

/**
 * The admin's one-field selector for who a bulk booking is for.
 *
 * Presentational, and deliberately **not** its own form: it renders inside
 * `BulkReservationModal`'s `FormProvider`, because the submit action lives in
 * the `Modal`'s footer, outside this subtree — the same shape as
 * `SpotDialog`'s `QueueTargetFields`.
 *
 * Domain composition, so it lives in app feature code and never in
 * `libs/shared/design-system` (`plan.md`, design-system-first).
 */

import { Box, Select, Stack } from '@garage/design-system/primitives';
import { FormField } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import type { HolderOption } from '../spot-dialog/holder-input';
import type { BulkHolderFormValues } from './holder-input';

export interface BulkHolderFieldsProps {
  readonly options: readonly HolderOption[];
}

export function BulkHolderFields({ options }: BulkHolderFieldsProps) {
  const t = useTranslations('bulk');

  return (
    // `mb-4` was the caller's placement (space before the grid below it in
    // `bulk-modal.tsx`), not this field's own chrome — a `Box margin=` wrapper
    // expresses it since `Stack` has no margin prop of its own.
    <Box margin={[0, 0, 4, 0]}>
      <Stack spacing={4}>
        <FormField<BulkHolderFormValues, 'userId'>
          name="userId"
          render={({ field, error: fieldError }) => (
            <Select label={t('holderField')} error={fieldError} {...field}>
              {options.map((option) => (
                <option key={option.userId} value={option.userId}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
        />
      </Stack>
    </Box>
  );
}
