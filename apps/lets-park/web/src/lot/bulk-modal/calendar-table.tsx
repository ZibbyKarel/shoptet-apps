'use client';

import { useDateFormatters } from '@lets-park/i18n';
import type { useTranslations } from '@lets-park/i18n';
import { Badge, Box, List, ListItem, Stack, Text } from '@lets-park/design-system/primitives';
import type { BadgeTone } from '@lets-park/design-system/primitives';
import {
  toBadgeMessage,
  toScheduleRows,
  type BulkBadgeView,
  type BulkDayOutcomeView,
} from './bulk-view';

const BADGE_TONES: Record<BulkBadgeView['kind'], BadgeTone> = {
  ASSIGNED_PREFERRED: 'success',
  ASSIGNED: 'info',
  QUEUED: 'warning',
  UNAVAILABLE: 'neutral',
};

export function badgeLabel(badge: BulkBadgeView, t: ReturnType<typeof useTranslations>): string {
  const message = toBadgeMessage(badge);
  return t(message.messageKey, message.values);
}

/**
 * The schedule a batch of days resolves to — `reservation.previewBulk`'s
 * proposal and `reservation.confirmBulk`'s result both print the same rows
 * through this component, so the two steps of the bulk-reservation modal
 * (`./bulk-modal.tsx`) quote the same rendering rather than each keeping
 * its own copy.
 */
export interface CalendarTableProps {
  readonly days: readonly BulkDayOutcomeView[];
  readonly t: ReturnType<typeof useTranslations>;
}

export function CalendarTable({ days, t }: CalendarTableProps) {
  const f = useDateFormatters();
  // No empty-list branch: both procedures answer one entry per requested day
  // and the call to action is disabled at zero selection, so `rows` cannot be
  // empty. A branch that cannot render is copy nobody will ever proof-read
  // (`doc/decision/0021-*`'s unreachable-member rule, applied to a catalog).
  // Only a preview that filtered days out of its response would change that.
  const rows = toScheduleRows(days);
  return (
    <List spacing={2}>
      {rows.map((row) => (
        // `ListItem` has no prop for a *full* border — only `divider="line"`
        // (a bottom border shared between items via `List`'s context), which
        // is a different shape from this row's own `rounded-sm border
        // border-border` box. Reported as a DS gap in this file's rewrite
        // report; `Box` supplies the border/radius/padding one level in.
        <ListItem key={row.date}>
          <Box border radius="sm" padding={[3, 4]}>
            <Stack direction="row" wrap align="center" justify="between" spacing={3}>
              <Text as="span" size="base" tone="default">
                {f.dayAndMonth(row.date)} · {f.weekdayName(row.date)}
              </Text>
              <Stack direction="row" align="center" spacing={3}>
                {row.spotLabel === null ? null : (
                  <Text as="span" size="sm" weight="bold" tone="muted">
                    {row.spotLabel}
                  </Text>
                )}
                <Badge tone={BADGE_TONES[row.badge.kind]}>{badgeLabel(row.badge, t)}</Badge>
              </Stack>
            </Stack>
          </Box>
        </ListItem>
      ))}
    </List>
  );
}
