'use client';

import type { useTranslations } from '@garage/i18n';
import { Box, Button, Modal, Text } from '@garage/design-system/primitives';
import type { PreviewBulkOutput } from '@garage/contract';
import { CalendarTable } from './calendar-table';

/**
 * Step 2 of {@link BulkReservationModalContent} in `./bulk-modal.tsx` — the schedule
 * `reservation.previewBulk` proposed, with the confirm/back footer.
 *
 * Every identifier this reads was in `BulkReservationModalContent`'s
 * closure, arriving here as a prop in the order the parent already computed
 * them. `confirmPending` and `onConfirm` stand in for the `confirmBulk`
 * mutation object itself, deliberately — this component is presentation-only
 * and stays testable without a `QueryClient` in scope.
 */
export interface SchedulePreviewModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly t: ReturnType<typeof useTranslations>;
  readonly proposal: PreviewBulkOutput;
  readonly pending: boolean;
  readonly onBack: () => void;
  readonly confirmPending: boolean;
  readonly onConfirm: () => void;
}

export function SchedulePreviewModal({
  open,
  onClose,
  t,
  proposal,
  pending,
  onBack,
  confirmPending,
  onConfirm,
}: SchedulePreviewModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('scheduleTitle')}
      description={t('scheduleDescription')}
      closeLabel={t('close')}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onBack}>
            {t('ctaBack')}
          </Button>
          <Button loading={confirmPending} disabled={pending} onClick={onConfirm}>
            {t('ctaConfirm')}
          </Button>
        </>
      }
    >
      <CalendarTable days={proposal.days} t={t} />
      {/* `mt-4` is this line's placement under the table, not its own chrome — see `Box.margin`. */}
      <Box margin={[4, 0, 0, 0]}>
        <Text as="p" size="base" tone="muted">
          {/*
            The server's own count, exactly as the result step uses
            `result.summary`. Re-deriving it here by filtering `days` would put
            two authorities behind one sentence, and the moment they disagreed
            the user would read a difference between the two steps that the
            comparison panel cannot explain, because no day moved.
          */}
          {t('scheduleSummary', {
            assigned: proposal.summary.assigned,
            queued: proposal.summary.queued,
          })}
        </Text>
      </Box>
    </Modal>
  );
}
