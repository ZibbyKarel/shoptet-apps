'use client';

import { useId } from 'react';
import type { ParkingSpot } from '@garage/contract';
import { Chip, Stack, Text } from '@garage/design-system/primitives';
import { useTranslations } from '@garage/i18n';
import { toCategoryCounts } from './spots-view';

/**
 * The band under the table header: one chip per category with its count.
 *
 * What is counted, and why inactive spots are in it, is
 * {@link toCategoryCounts}.
 */
export function CategoryBand({ spots }: { readonly spots: readonly ParkingSpot[] }) {
  const t = useTranslations('admin');
  const labelId = useId();

  return (
    // A named group, so the band is distinguishable from the table's own
    // "Kategorie" column heading — to a screen reader as much as to a test.
    <Stack role="group" aria-labelledby={labelId} direction="row" align="center" wrap spacing={3}>
      <Text
        as="span"
        id={labelId}
        size="xs"
        weight="bold"
        tone="subtle"
        tracking="caps"
        transform="uppercase"
      >
        {t('spotsCategories')}
      </Text>
      {toCategoryCounts(spots).map(({ group, count }) => (
        <Chip key={group} size="sm" tone="muted" weight="medium">
          {group}
          <Text as="span" tone="subtle">
            {count}
          </Text>
        </Chip>
      ))}
      <Text as="span" size="xs" tone="subtle">
        {t('spotsCategoriesFixed')}
      </Text>
    </Stack>
  );
}
