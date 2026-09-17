'use client';

/**
 * What `/settings` renders, given a profile, the active spots, and the
 * mutation state around them — and nothing about how any of that is fetched.
 *
 * Split from `../settings-page.tsx` for the same reason `TopBar`/`AdminScreen`
 * are split from their connected wrappers: the *rules* here (which of the
 * loading/error/form states is shown, what a submit sends, when the confirm
 * dialog opens) are testable with plain props, no session, no query client and
 * no live API.
 *
 * Per `doc/design/screens/11-settings.png`, drawn with `Modal` rather than a
 * bespoke card — `doc/decision/0150-*` records why the whole screen renders as
 * that shared primitive instead of a second, hand-built dialog shell. The ICS
 * section below the form has no design to copy from; `doc/decision/0151-*`
 * records why it lives here, in the same modal, rather than on its own screen.
 */

import { useEffect, useRef, useState } from 'react';
import * as z from 'zod';
import type { MyProfile, ParkingSpot, UpdateMySettingsInput } from '@garage/contract';
import { toContractError } from '@garage/api-client';
import { FormField, FormProvider, useAppForm } from '@garage/form';
import { Button, Input, Modal, Select, Stack, Text } from '@garage/design-system/primitives';
import { ConfirmDialog } from '@garage/design-system/compounds';
import { useTranslations } from '@garage/i18n';
import { useNotify } from '../notifications/toast-provider';
import { ScreenError, ScreenLoading } from '../screen-state/screen-state';
import { NO_PREFERRED_SPOT, shouldClearPreferredSpot, toIcsFeedView } from './settings-view';
import { IcsSection } from './ics-section';

/**
 * Links the Save button in `Modal`'s `footer` (outside the `<form>`, by
 * construction — see `ModalProps.footer`) to the `<form>` it submits, via the
 * standard `form="…"` button attribute. This is also what makes pressing
 * Enter in a field submit natively, rather than doing nothing (Task 26
 * review, M4).
 */
const SETTINGS_FORM_ID = 'settings-form';

/** `'idle'` before any copy attempt, then the outcome of the last one. */
export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Field-level validation only. The three-valued clear/set/leave-alone
 * semantics of `UpdateMySettingsInput` are applied at submit time in
 * {@link toUpdateInput} — a bare `''` here means "no licence plate" /
 * "no preferred spot", never "the value is invalid".
 */
const settingsFormSchema = z.object({
  licensePlate: z.string().max(16),
  preferredParkingSpotId: z.string(),
});
type SettingsFormValues = z.infer<typeof settingsFormSchema>;

function toUpdateInput(values: SettingsFormValues): UpdateMySettingsInput {
  const trimmedPlate = values.licensePlate.trim();
  return {
    licensePlate: trimmedPlate === '' ? null : trimmedPlate,
    preferredParkingSpotId:
      values.preferredParkingSpotId === NO_PREFERRED_SPOT ? null : values.preferredParkingSpotId,
  };
}

/** The ICS half of the screen: the feed's inputs and its one write. */
export interface SettingsIcs {
  /**
   * Origin of the API (`apiOriginOf(NEXT_PUBLIC_API_URL)`, no path). Empty
   * means it could not be derived — see `app/(app)/settings/page.tsx` — in
   * which case the ICS section shows its unavailable state rather than a
   * broken link, since `buildIcsFeedUrl` has nothing to build from — see
   * {@link toIcsFeedView}.
   */
  readonly apiOrigin: string;
  /** The caller's current ICS token, or `undefined` before the profile loads. */
  readonly token: string | undefined;
  /**
   * Requests a new token. Resolves once the new one has replaced the old —
   * that is the signal this component uses to close the confirmation dialog;
   * a rejection leaves it open so the user can retry.
   */
  readonly onRegenerate: () => Promise<void>;
  readonly isRegenerating: boolean;
  /** Whatever the failing `me.regenerateIcsToken` call threw. */
  readonly regenerateError: unknown;
}

export interface SettingsScreenProps {
  /** The profile has not arrived yet. */
  readonly isPending: boolean;
  /** The profile could not be loaded. */
  readonly isError: boolean;
  /** Whatever the failing call threw. See `ScreenErrorProps.error`. */
  readonly error: unknown;
  readonly onRetry: () => void;
  /** `undefined` exactly when `isPending || isError`. */
  readonly profile: MyProfile | undefined;
  /** Active spots for the preferred-spot picker (`spot.list`). */
  readonly spots: readonly ParkingSpot[];
  /**
   * `spot.list` has not resolved yet. While this is `true`, `spots` may still
   * be `[]` for "not loaded" rather than "no active spots exist" — the
   * reconciliation effect below must not treat the two the same (see I1 in
   * the Task 26 review), and the picker shows a loading hint instead of
   * silently offering only "Bez preference".
   */
  readonly spotsPending: boolean;
  /** `spot.list` failed. The picker shows an inline notice instead of nothing. */
  readonly spotsError: boolean;
  readonly onSave: (input: UpdateMySettingsInput) => void;
  readonly isSaving: boolean;
  /** Whatever the failing `me.updateSettings` call threw. */
  readonly saveError: unknown;
  /**
   * Everything {@link IcsSection} runs on, as one value.
   *
   * Grouped rather than spread across the screen's own interface because none
   * of it is the screen's business: the five members are read by that one
   * subtree and by the confirmation dialog it opens, and listing them here
   * side by side made every caller and every spec of this screen state ICS
   * internals it has no other reason to know about.
   */
  readonly ics: SettingsIcs;
  /**
   * Called for every way out: Cancel, Escape, and a saved form. There is
   * deliberately no × (the design draws none — `doc/decision/0150-*`) and the
   * scrim does not close the dialog either (`closeOnScrimClick={false}` below)
   * — this modal holds unsaved input, and a stray click must not discard it.
   */
  readonly onClose: () => void;
}

export function SettingsScreen({
  isPending,
  isError,
  error,
  onRetry,
  profile,
  spots,
  spotsPending,
  spotsError,
  onSave,
  isSaving,
  saveError,
  ics,
  onClose,
}: SettingsScreenProps) {
  const t = useTranslations('settings');
  const shellT = useTranslations('shell');
  const errorsT = useTranslations('errors');

  const [confirmOpen, setConfirmOpen] = useState(false);
  // Kept here rather than inside `IcsSection`, which is otherwise its only
  // reader, because a successful regeneration clears it: "Odkaz zkopírován"
  // must not stay on screen next to a link that has just been replaced, and
  // the regeneration is confirmed one level up (`doc/decision/0151-*` keeps
  // that `ConfirmDialog` above the whole modal). Pushing the state down would
  // either lose that reset or replace it with a guess derived from the URL.
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const form = useAppForm<SettingsFormValues>({
    schema: settingsFormSchema,
    defaultValues: { licensePlate: '', preferredParkingSpotId: NO_PREFERRED_SPOT },
  });

  // The form is created once, unconditionally, so the footer's Save button
  // (which lives in `Modal`'s `footer` prop, outside `children`) can always
  // call `form.handleSubmit`. It is seeded from the profile exactly once, the
  // moment it first arrives — never again, so a background refetch (e.g. after
  // the ICS token regenerates and invalidates `me.get`) cannot silently
  // overwrite an edit in progress. Done in an effect, not during render: a
  // sibling hook's own state (react-hook-form's) must never be written while
  // this component is rendering.
  const seeded = useRef(false);
  useEffect(() => {
    if (profile && !seeded.current) {
      seeded.current = true;
      form.reset({
        licensePlate: profile.licensePlate ?? '',
        preferredParkingSpotId: profile.preferredParkingSpotId ?? NO_PREFERRED_SPOT,
      });
    }
  }, [profile, form]);

  // Reconciles the seeded preferred-spot id against the actual set of
  // selectable options, whenever that set changes. The rule — including why a
  // pending or failed `spot.list` must not clear anything — is
  // {@link shouldClearPreferredSpot}; the effect is only what has to happen in
  // an effect, because writing a sibling hook's state during render is not
  // allowed. Not marked dirty: this is a correction of what the DOM already
  // shows, not an edit the user made.
  useEffect(() => {
    const current = form.getValues('preferredParkingSpotId');
    if (shouldClearPreferredSpot(current, spots, spotsPending, spotsError)) {
      form.setValue('preferredParkingSpotId', NO_PREFERRED_SPOT, { shouldDirty: false });
    }
  }, [spots, spotsPending, spotsError, form]);

  const ready = !isPending && !isError && profile !== undefined;

  const icsFeed = toIcsFeedView(ics.apiOrigin, ics.token);

  function describeError(failure: unknown): string | null {
    if (failure == null) {
      return null;
    }
    const contractError = toContractError(failure);
    if (contractError === null) {
      return shellT('errorUnknown');
    }
    // `me.updateSettings` declares exactly `NOT_FOUND` and `VALIDATION_FAILED`
    // (`libs/garage/contract/src/api/me.ts`), and on *this* screen `VALIDATION_FAILED`
    // means one thing only: the stored preferred spot has been retired
    // (`MeService.requireSelectableSpot`). The shared error catalogue's
    // `VALIDATION_FAILED` sentence is about reservation-day rules (weekends,
    // public holidays) — a true code paired with a false story. This screen
    // renders its own copy for that one code instead (Task 26 review, I3).
    // `me.regenerateIcsToken` never throws `VALIDATION_FAILED` (it declares
    // nothing beyond the inherited `FORBIDDEN`), so this branch is reachable
    // only through `saveErrorMessage`, not `regenerateErrorMessage` — but it
    // is harmless, and correct, either way.
    if (contractError.code === 'VALIDATION_FAILED') {
      return t('preferredSpotUnavailable');
    }
    return errorsT(contractError.code);
  }

  const saveErrorMessage = describeError(saveError);
  const regenerateErrorMessage = describeError(ics.regenerateError);

  // Each toast used to be gated by the JSX branch it rendered in — the first
  // two by the `{ready ? … : null}` form section, the third by `ConfirmDialog`
  // itself, whose `Modal` renders no children at all while `open` is `false`
  // (`libs/shared/design-system/.../modal.tsx`). `useNotify` calls are
  // unconditional (rules of hooks), so the same gating has to move into the
  // `message` argument instead — otherwise e.g. a stale `regenerateError`
  // would keep showing a toast on the settings screen after the confirmation
  // dialog that used to contain it has been cancelled and closed.
  useNotify(ready && spotsError ? t('preferredSpotLoadError') : null, 'danger');
  useNotify(ready ? saveErrorMessage : null, 'danger');
  useNotify(confirmOpen ? regenerateErrorMessage : null, 'danger');

  async function handleCopy() {
    if (icsFeed.kind === 'unavailable') {
      return;
    }
    try {
      await navigator.clipboard.writeText(icsFeed.url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  async function handleConfirmRegenerate() {
    try {
      await ics.onRegenerate();
      setConfirmOpen(false);
      setCopyState('idle');
    } catch {
      // `regenerateErrorMessage` (derived from the caller's mutation state)
      // shows as a toast while `confirmOpen` stays `true` — that is the retry
      // affordance.
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t('title')}
        description={ready ? t('description') : undefined}
        size="md"
        // The design draws no × in the corner (`doc/decision/0150-*`), and a
        // click on the scrim must not throw unsaved edits away — `Modal`'s own
        // prop docs call out exactly this case for `closeOnScrimClick={false}`.
        hideCloseButton
        closeOnScrimClick={false}
        footer={
          ready ? (
            <>
              <Button variant="secondary" size="lg" onClick={onClose} disabled={isSaving}>
                {t('cancel')}
              </Button>
              {/* `type="submit" form={SETTINGS_FORM_ID}` rather than an
                  `onClick` handler: this button lives in `Modal`'s `footer`,
                  outside the `<form>` below, but the `form` attribute still
                  makes it that form's submit button — which is also what
                  makes pressing Enter in a field submit the form natively. */}
              <Button
                type="submit"
                form={SETTINGS_FORM_ID}
                variant="primary"
                size="lg"
                loading={isSaving}
              >
                {t('save')}
              </Button>
            </>
          ) : undefined
        }
      >
        {isPending ? <ScreenLoading /> : null}
        {isError ? <ScreenError error={error} onRetry={onRetry} headingLevel={3} /> : null}

        {ready ? (
          <FormProvider {...form}>
            <Stack spacing={5}>
              {/*
               * The `<form>` element itself stays plain — nothing here or in
               * `settings-screen.spec.tsx` depends on it being the flex
               * container. `Stack` supplies the `gap-5` layout as its one
               * (and only) child.
               */}
              <form
                id={SETTINGS_FORM_ID}
                onSubmit={form.handleSubmit((values) => onSave(toUpdateInput(values)))}
              >
                <Stack spacing={5}>
                  <FormField
                    name="licensePlate"
                    render={({ field, error: fieldError }) => (
                      <Input
                        label={t('licensePlateLabel')}
                        error={fieldError ? t('licensePlateTooLong') : undefined}
                        {...field}
                      />
                    )}
                  />
                  <FormField
                    name="preferredParkingSpotId"
                    render={({ field, error: fieldError }) => (
                      <Select label={t('preferredSpotLabel')} error={fieldError} {...field}>
                        <option value={NO_PREFERRED_SPOT}>{t('preferredSpotNone')}</option>
                        {spots.map((spot) => (
                          <option key={spot.id} value={spot.id}>
                            {spot.label} · {spot.group}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                  {spotsPending ? (
                    <Text size="sm" tone="subtle">
                      {t('preferredSpotLoading')}
                    </Text>
                  ) : null}
                </Stack>
              </form>

              {/* Deliberately outside the `<form>` above: the ICS section acts
                  immediately on its own two buttons (both `type="button"`), not
                  on a Save/Cancel submit, and keeping it out of the form means
                  pressing Enter while focused on the read-only feed-URL input
                  cannot trigger a licence-plate/preferred-spot save. */}
              <IcsSection
                headingId="ics-heading"
                feed={icsFeed}
                copyState={copyState}
                onCopy={() => void handleCopy()}
                onRequestRegenerate={() => setConfirmOpen(true)}
                isRegenerating={ics.isRegenerating}
              />
            </Stack>
          </FormProvider>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title={t('icsRegenerateConfirmTitle')}
        description={t('icsRegenerateConfirmDescription')}
        confirmLabel={t('icsRegenerateConfirmButton')}
        cancelLabel={t('cancel')}
        tone="danger"
        loading={ics.isRegenerating}
        onConfirm={() => void handleConfirmRegenerate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
