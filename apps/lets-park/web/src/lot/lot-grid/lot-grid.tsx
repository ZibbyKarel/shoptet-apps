'use client';

/**
 * The map: asphalt, painted lines, and one bay per parking spot.
 *
 * **Presentational.** Props in, callbacks out, no fetching and no query cache
 * — every decision arrived already made, as a `SpotGroupView` from
 * `./lot-view`. That split is what lets the interesting logic be tested
 * without a DOM, and lets this file be checked for what it draws.
 *
 * It lives in `apps/lets-park/web` rather than in `libs/shared/design-system/src/compounds`
 * because it is domain UI: a "parking bay" is not a design-system concept,
 * and a compound that knew about reservations and waitlists would stop being
 * presentation-only. Composing tokens, primitives and compounds into domain
 * UI is app work (`plan.md`, §"Design-system-first").
 *
 * Colours, radii and spacing are design-system props throughout. The four
 * geometry values a parking bay needs and the spacing scale cannot express
 * are `--lot-*` custom properties in `app/global.css`, spent through the
 * handful of named `.lot-*` classes there rather than as Tailwind arbitrary
 * values in this file.
 */

import { Box, List, ListItem, Stack, Text } from '@lets-park/design-system/primitives';
import { useTranslations } from '@lets-park/i18n';
import type { SpotGroupView } from '../lot-view';
import { SpotTile } from './spot-tile';

export interface LotGridProps {
  readonly groups: readonly SpotGroupView[];
  readonly onOpenSpot: (spotId: string) => void;
  readonly onAdminOpenSpot: (spotId: string) => void;
}

/** The whole map: one labelled band per group, then the legend. */
export function LotGrid({ groups, onOpenSpot, onAdminOpenSpot }: LotGridProps) {
  const t = useTranslations('lot');

  return (
    <Box
      padding={4}
      radius="lg"
      shadow="lg"
      // eslint-disable-next-line no-restricted-syntax -- `.lot-asphalt`: the map's painted surface (two offset dot-grid backgrounds, plus the dark `neutral-600` fill `Box`'s background prop cannot reach — its `background` only names design-system surface tokens, not an arbitrary neutral step).
      className="lot-asphalt"
    >
      {groups.map((group) => (
        // `Box` now takes `as="section"`, so the landmark region — named by
        // `aria-label`, which a plain `<div>` would drop from the
        // accessibility tree — keeps its layout in `Box` props (padding,
        // margin, radius) instead of a class. `.lot-group-panel` shrinks to
        // just the tinted border/background over the asphalt, at an alpha
        // step no `Box` prop reaches.
        <Box
          key={group.group}
          as="section"
          aria-label={t('groupLabel', { group: group.group })}
          padding={[4, 3, 5, 3]}
          margin={[0, 0, 5, 0]}
          radius="md"
          // eslint-disable-next-line no-restricted-syntax -- `.lot-group-panel`: a tinted border/background over the asphalt at an alpha step `Box`'s `border`/`background` props cannot reach (fixed tones, no alpha channel).
          className="lot-group-panel"
        >
          {/*
           * `Stack` has no `margin` prop, so the gap between the heading row
           * and the tile row is one more level of `Stack` (`spacing`) rather
           * than a margin that doesn't exist to set.
           */}
          <Stack direction="column" spacing={4}>
            <Stack direction="row" align="center" spacing={3}>
              <Text
                as="h2"
                size="xs"
                weight="bold"
                transform="uppercase"
                tracking="caps"
                tone="inverse-90"
              >
                {group.group}
              </Text>
              <span
                aria-hidden="true"
                // eslint-disable-next-line no-restricted-syntax -- `.lot-group-rule`: the hairline under the band's name, an unbordered filled rule at an alpha step `Divider`'s two fixed tones don't cover.
                className="lot-group-rule"
              />
              <Text as="span" size="xs" tone="inverse-50">
                {t('groupFree', { free: group.freeCount, total: group.totalCount })}
              </Text>
            </Stack>

            <Stack
              direction="row"
              wrap
              // eslint-disable-next-line no-restricted-syntax -- `.lot-bay-row`: the painted line at the row's left edge (`--lot-line-w`), matching each bay's own right/top lines — domain geometry, no `Stack` prop for a border.
              className="lot-bay-row"
            >
              {group.spots.map((spot) => (
                <SpotTile
                  key={spot.spotId}
                  spot={spot}
                  onOpen={onOpenSpot}
                  onAdminOpen={onAdminOpenSpot}
                />
              ))}
            </Stack>
          </Stack>
        </Box>
      ))}

      {/* `List` has no `padding` prop, so the `px-1` the legend used to carry moves onto a wrapping `Box`. */}
      <Box padding={[0, 1]}>
        <List as="ul" direction="row" wrap spacing={5}>
          <ListItem direction="row" align="center" spacing={2}>
            <span
              aria-hidden="true"
              // eslint-disable-next-line no-restricted-syntax -- `.lot-swatch`/`.lot-swatch--taken`: a paint sample of the map's own "taken" colour, below `IconCircle`'s smallest step.
              className="lot-swatch lot-swatch--taken"
            />
            <Text as="span" size="xs" tone="inverse-70">
              {t('legendTaken')}
            </Text>
          </ListItem>
          <ListItem direction="row" align="center" spacing={2}>
            <span
              aria-hidden="true"
              // eslint-disable-next-line no-restricted-syntax -- `.lot-swatch`/`.lot-swatch--free`: a paint sample of the map's own dashed "free" outline, below `IconCircle`'s smallest step and needing a dashed border no primitive exposes.
              className="lot-swatch lot-swatch--free"
            />
            <Text as="span" size="xs" tone="inverse-70">
              {t('legendFree')}
            </Text>
          </ListItem>
          <ListItem direction="row" align="center" spacing={2}>
            <span
              aria-hidden="true"
              // eslint-disable-next-line no-restricted-syntax -- `.lot-swatch`/`.lot-swatch--waitlist`: a paint sample of the map's own "waitlist" colour, below `IconCircle`'s smallest step.
              className="lot-swatch lot-swatch--waitlist"
            />
            <Text as="span" size="xs" tone="inverse-70">
              {t('legendWaitlist')}
            </Text>
          </ListItem>
        </List>
      </Box>
    </Box>
  );
}
