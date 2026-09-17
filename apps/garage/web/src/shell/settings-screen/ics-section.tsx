'use client';

import {
  Box,
  Button,
  Divider,
  Input,
  Stack,
  Text,
  Toast,
  type ToastTone,
} from '@garage/design-system/primitives';
import { useTranslations } from '@garage/i18n';
import type { IcsFeedView } from './settings-view';
import type { CopyState } from './settings-screen';

export interface IcsSectionProps {
  readonly headingId: string;
  readonly feed: IcsFeedView;
  readonly copyState: CopyState;
  readonly onCopy: () => void;
  readonly onRequestRegenerate: () => void;
  readonly isRegenerating: boolean;
}

const COPY_FEEDBACK_TONE: Record<'copied' | 'failed', ToastTone> = {
  copied: 'success',
  failed: 'danger',
};

/**
 * The section `doc/decision/0151-*` adds to this modal: the ICS subscription
 * URL, a copy button, and token regeneration behind `ConfirmDialog` (rendered
 * one level up, so it sits above the whole modal rather than inside it).
 */
export function IcsSection({
  headingId,
  feed,
  copyState,
  onCopy,
  onRequestRegenerate,
  isRegenerating,
}: IcsSectionProps) {
  const t = useTranslations('settings');

  return (
    <Box as="section" aria-labelledby={headingId}>
      {/*
       * `Divider` draws the top rule the plain `<section>` used to carry as
       * `border-t`. `pt-5` (space between the rule and the heading below)
       * becomes a top-only `Box` padding rather than `Divider`'s own
       * `spacing`, because `Divider`'s `spacing` is symmetric (`my-*`) and
       * would also add space *above* the rule — space this section already
       * gets from the outer `Stack`'s own `spacing={5}` in `settings-screen.tsx`.
       */}
      <Divider />
      <Box padding={[5, 0, 0, 0]}>
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Text as="h3" id={headingId} size="sm" weight="bold">
              {t('icsHeading')}
            </Text>
            <Text size="sm" tone="subtle">
              {t('icsDescription')}
            </Text>
          </Stack>

          {feed.kind === 'unavailable' ? (
            <Text size="sm" tone="subtle">
              {t('icsUnavailable')}
            </Text>
          ) : (
            <>
              <Input
                label={t('icsUrlLabel')}
                value={feed.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <Stack direction="row" align="center" wrap spacing={3}>
                {/* `size="lg"`, matching the footer's Cancel/Save buttons — the
                    design shows one control height throughout the modal. */}
                <Button type="button" variant="secondary" size="lg" onClick={onCopy}>
                  {t('icsCopy')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={onRequestRegenerate}
                  disabled={isRegenerating}
                >
                  {t('icsRegenerate')}
                </Button>
              </Stack>
              {copyState === 'idle' ? null : (
                <Toast tone={COPY_FEEDBACK_TONE[copyState]}>
                  {copyState === 'copied' ? t('icsCopied') : t('icsCopyFailed')}
                </Toast>
              )}
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
