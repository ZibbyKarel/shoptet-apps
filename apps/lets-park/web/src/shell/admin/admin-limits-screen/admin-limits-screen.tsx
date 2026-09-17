'use client';

/**
 * The "Limity rezervací" tab: how many reservations one user may hold in a
 * calendar month.
 *
 * One stepper, no Save button — the same choice `admin-window-screen.tsx`
 * makes and for the same reason: the control writes on change, so there is
 * never an unsaved value on screen that disagrees with what the server has.
 *
 * Presentational: `../admin-limits-panel.tsx` is the connected half.
 */

import {
  MAX_MONTHLY_RESERVATION_CAP,
  MIN_MONTHLY_RESERVATION_CAP,
  useTranslations,
} from '@lets-park/i18n';
import type { ReservationLimitSettings } from '@lets-park/contract';
import { Card, Stack, Stepper, Text } from '@lets-park/design-system/primitives';
import { useNotify } from '../../notifications/toast-provider';
import { ScreenDataGuard } from '../../screen-state/screen-state';
import type { ScreenData } from '../../screen-state/screen-state';
import { useAdminWriteError } from '../admin-errors';

export interface AdminLimitsScreenProps {
  /** `admin.reservationLimits.get`'s answer, exactly as it came back. */
  readonly limits: ScreenData<ReservationLimitSettings>;
  readonly onRetry: () => void;
  /** A full replacement of the settings; the contract has no patch. */
  readonly onChange: (next: ReservationLimitSettings) => void;
  readonly isSaving: boolean;
  /** Whatever the failing `admin.reservationLimits.update` call threw. */
  readonly saveError: unknown;
  /** The last save succeeded and nothing has changed since. */
  readonly isSaved: boolean;
}

export function AdminLimitsScreen({
  limits,
  onRetry,
  onChange,
  isSaving,
  saveError,
  isSaved,
}: AdminLimitsScreenProps) {
  const t = useTranslations('admin');
  const describeWriteError = useAdminWriteError();

  const saveErrorMessage = describeWriteError('limitsUpdate', saveError);

  useNotify(saveErrorMessage, 'danger');
  useNotify(saveErrorMessage === null && isSaved ? t('limitsSaved') : null, 'success');

  return (
    <ScreenDataGuard state={limits} onRetry={onRetry} headingLevel={3}>
      {({ monthlyReservationCap }) => (
        <section aria-label={t('limitsTitle')}>
          <Card>
            <Stack spacing={5}>
              <Stack spacing={2}>
                <Text as="h3" size="lg" weight="bold">
                  {t('limitsTitle')}
                </Text>
                <Text size="sm" tone="subtle" leading="loose">
                  {t('limitsDescription')}
                </Text>
              </Stack>

              <Stack spacing={3}>
                <Text size="xs" weight="bold" tone="subtle" tracking="caps" transform="uppercase">
                  {t('limitsCapLabel')}
                </Text>
                <Stepper
                  label={t('limitsCapLabel')}
                  value={monthlyReservationCap}
                  min={MIN_MONTHLY_RESERVATION_CAP}
                  max={MAX_MONTHLY_RESERVATION_CAP}
                  disabled={isSaving}
                  decrementLabel={t('limitsCapDecrement')}
                  incrementLabel={t('limitsCapIncrement')}
                  formatValue={(count) => t('limitsCapValue', { count })}
                  onValueChange={(next) => onChange({ monthlyReservationCap: next })}
                />
              </Stack>

              <Text size="sm" tone="subtle">
                {t('limitsHint')}
              </Text>
            </Stack>
          </Card>
        </section>
      )}
    </ScreenDataGuard>
  );
}
