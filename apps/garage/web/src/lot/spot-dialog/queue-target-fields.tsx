'use client';

/**
 * The admin's one-field selector for adding somebody else to a spot's queue.
 *
 * Presentational, and — like `HolderFields` — deliberately **not** its own
 * form: it renders inside `SpotDialog`'s `FormProvider`, because the submit
 * button lives in the `Modal`'s footer, outside this subtree.
 *
 * Narrower than `HolderFields` on purpose: a waitlist entry has no guest
 * branch and no plate override (`WaitlistEntry.userId` is non-nullable), so
 * this is the selector alone.
 *
 * Domain composition, so it lives in app feature code and never in
 * `libs/shared/design-system` (`plan.md`, design-system-first).
 */

import { Box, Select, Stack } from '@garage/design-system/primitives';
import { FormField } from '@garage/form';
import { useTranslations } from '@garage/i18n';
import type { HolderOption } from './holder-input';
import type { QueueTargetFormValues } from './queue-target-input';

export interface QueueTargetFieldsProps {
  readonly options: readonly HolderOption[];
}

export function QueueTargetFields({ options }: QueueTargetFieldsProps) {
  const t = useTranslations('lot');

  // `mt-3` was baked into the field stack's own className; caller placement,
  // not `Stack` chrome, so it moves to a wrapping `Box margin=`.
  return (
    <Box margin={[3, 0, 0, 0]}>
      <Stack spacing={4}>
        <FormField<QueueTargetFormValues, 'userId'>
          name="userId"
          render={({ field, error: fieldError }) => (
            <Select label={t('queueHolderField')} error={fieldError} {...field}>
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
