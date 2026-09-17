'use client';

import * as z from 'zod';
import type { ParkingSpot } from '@garage/contract';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { Button, Input, Modal, Select, Stack, Toast } from '@garage/design-system/primitives';
import { PARKING_GROUPS, useTranslations } from '@garage/i18n';

/** Field-level validation. The contract re-checks the same shape on arrival. */
const spotFormSchema = z.object({
  label: z.string().trim().min(1),
  group: z.enum(PARKING_GROUPS),
});
type SpotFormValues = z.infer<typeof spotFormSchema>;

export interface SpotFormDialogProps {
  /**
   * The spot being edited, or `null` when adding a new one — narrowed to the
   * two fields the form actually edits, so the dialog cannot start reading
   * `active` or an id it has no business acting on.
   */
  readonly spot: Pick<ParkingSpot, 'label' | 'group'> | null;
  readonly errorMessage: string | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: SpotFormValues) => Promise<void>;
}

/** Add / edit, in the same `Modal` the settings screen uses. */
export function SpotFormDialog({
  spot,
  errorMessage,
  saving,
  onCancel,
  onSubmit,
}: SpotFormDialogProps) {
  const t = useTranslations('admin');

  const form = useAppForm<SpotFormValues>({
    schema: spotFormSchema,
    defaultValues: {
      label: spot?.label ?? '',
      group: spot?.group ?? PARKING_GROUPS[0],
    },
  });

  const submit = form.handleSubmit((values) => {
    void onSubmit(values).catch(() => {
      // `errorMessage` renders inside the still-open modal; see `ConfirmDialog`
      // for the same shape.
    });
  });

  return (
    <Modal
      open
      onClose={onCancel}
      title={spot === null ? t('spotsCreateTitle') : t('spotsEditTitle', { label: spot.label })}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={saving}>
            {t('spotsCancel')}
          </Button>
          <Button variant="primary" size="lg" onClick={submit} loading={saving}>
            {t('spotsSave')}
          </Button>
        </>
      }
    >
      <FormProvider {...form}>
        <Stack spacing={5}>
          <FormField
            name="label"
            render={({ field, error: fieldError }) => (
              <Input
                label={t('spotsLabelField')}
                error={fieldError ? t('spotsLabelRequired') : undefined}
                {...field}
              />
            )}
          />
          <FormField
            name="group"
            render={({ field, error: fieldError }) => (
              <Select label={t('spotsGroupField')} error={fieldError} {...field}>
                {PARKING_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </Select>
            )}
          />
          {errorMessage ? <Toast tone="danger">{errorMessage}</Toast> : null}
        </Stack>
      </FormProvider>
    </Modal>
  );
}
