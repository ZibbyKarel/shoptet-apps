'use client';

/**
 * Hromadná rezervace — the two-step bulk-booking modal
 * (`doc/design/screens/10-modal-bulk.png`, `doc/bulk-reservation-modal.md`).
 *
 * Step 1 picks days out of a month grid; step 2 shows the schedule
 * `reservation.previewBulk` proposes; confirming runs
 * `reservation.confirmBulk` and lands on a third, non-skippable step that
 * compares what happened against what was proposed.
 *
 * **The third step is the point.** `confirmBulk` deliberately leaves a race
 * open between its read and its write (`doc/decision/0092-*`), so a day the
 * preview promised a spot for can come back as a queue position. A modal that
 * proposed one thing and quietly confirmed another would be worse than one
 * with no proposal at all, because the user would believe they got what they
 * saw. See `doc/decision/0170-*`.
 *
 * Everything this file decides lives in `./bulk-view.ts`; everything it fetches
 * goes through `@tanstack/react-query` and `@lets-park/api-client`. Nothing
 * here names a wrapped package (`doc/wrappers.md`).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  parseDateOnly,
  todayInPrague,
  useDateFormatters,
  useTranslations,
  type DateOnly,
} from '@lets-park/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Callout,
  List,
  ListItem,
  Modal,
  Stack,
  Text,
  Toast,
  ToastRegion,
  ToggleTile,
  VisuallyHidden,
} from '@lets-park/design-system/primitives';
import type { ConfirmBulkOutput, PreviewBulkOutput } from '@lets-park/contract';
import { FormProvider, useAppForm } from '@lets-park/form';
import { useApi } from '../../shell/api-provider/api-provider';
import { useCurrentUser } from '../../shell/use-current-user';
import type { HolderOption } from '../spot-dialog/holder-input';
import {
  buildMonthGrid,
  diffBulkSchedule,
  toBadge,
  toBulkErrorMessageKey,
  toPreferredSpotMessage,
  toPreferredSpotView,
  weekendColumns,
  type BulkDayCell,
  type BulkDayOutcomeView,
} from './bulk-view';
import { CalendarTable, badgeLabel } from './calendar-table';
import { BulkHolderFields } from './holder-fields';
import { bulkHolderFormSchema, defaultBulkHolderId } from './holder-input';
import type { BulkHolderFormValues } from './holder-input';
import { SchedulePreviewModal } from './schedule-preview-modal';

export interface BulkReservationModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Any day of the month the grid shows — the lot screen's own day. */
  readonly anchorDate: DateOnly;
  /**
   * `overview.day.canReserveMonth` for {@link anchorDate}'s month: the
   * backend's answer to "may this caller create reservations anywhere in this
   * month", never a re-derivation of it (`doc/decision/0120-*`).
   *
   * **`canReserve` is the wrong field here and was the wrong field once.** That
   * one is per-**day** — a past day, a weekend and a Czech public holiday all
   * make it `false` while leaving the month wide open — so reading it switched
   * bulk booking off on roughly a third of the calendar, including the very
   * holiday the design's own screenshot shows the modal open on
   * (`doc/decision/0175-*`).
   *
   * **This is the block, not a hint.** The header hides its button when it is
   * `false`, but hiding a control is not enforcement — the window can also
   * close while the modal is already open, and then this prop is the only
   * thing standing between the user and a request the API will refuse. What it
   * must never block is the *result* step: see `doc/decision/0176-*`.
   */
  readonly canReserveMonth: boolean;
  /** Whether the caller is an admin — gates the holder selector, same as `SpotDialog`'s. */
  readonly isAdmin: boolean;
  /** `null` while the profile is still loading. */
  readonly viewerUserId: string | null;
  /** `LotScreen`'s own `admin.user.list` fetch — not refetched here. */
  readonly holderOptions: readonly HolderOption[];
  readonly holderPending: boolean;
  /** Set when `LotScreen`'s `admin.user.list` fetch failed. */
  readonly holderError?: unknown;
}

/** Monday-first column heads, in the message catalog's key order. */
const WEEKDAY_KEYS = [
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
  'weekdaySun',
] as const;

/**
 * The modal, with its state tied to one opening.
 *
 * The reset used to be a `useEffect` on `[open, month]` inside the component
 * below. Passive effects run **after paint**, so the render in which `open`
 * flips back to `true` still saw the previous run's `result` and took the
 * result branch — the user reopening the modal got a frame of the last batch's
 * outcome before the day grid appeared. See `doc/decision/0258-*`.
 *
 * A `key` fixes it by construction rather than by ordering: React discards the
 * whole subtree and mounts a fresh one, so there is no state left to flash and
 * no effect whose timing has to be right. The month is in the key as well as
 * `open` because the contract refuses a batch spanning two months — a stale
 * day from the previous month would turn the next confirmation into
 * `VALIDATION_FAILED`. (`LotScreen` also closes the modal when the day moves,
 * so that half is belt and braces; it is cheap and it is the rule this file
 * actually depends on.)
 */
export function BulkReservationModal(props: BulkReservationModalProps) {
  return (
    <BulkReservationModalContent
      key={`${String(props.open)}-${props.anchorDate.slice(0, 7)}`}
      {...props}
    />
  );
}

function BulkReservationModalContent({
  open,
  onClose,
  anchorDate,
  canReserveMonth,
  isAdmin,
  viewerUserId,
  holderOptions,
  holderPending,
  holderError,
}: BulkReservationModalProps) {
  const t = useTranslations('bulk');
  const tShell = useTranslations('shell');
  const f = useDateFormatters();
  const api = useApi();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<readonly DateOnly[]>([]);
  // The **whole** preview output, not just its days: its `summary` is the
  // server's own count and is what step 2 prints, so the two steps quote the
  // same authority instead of one of them re-deriving it from `days`.
  const [proposal, setProposal] = useState<PreviewBulkOutput | null>(null);
  const [result, setResult] = useState<ConfirmBulkOutput | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  // No reset effect here on purpose — the wrapper above keys this component on
  // `open` and the month, so every opening is a fresh mount and the four
  // `useState`s start at their initial values. An effect could only ever undo
  // the previous run's state *after* the reopening render had already used it.

  const showHolderForm = isAdmin && holderOptions.length > 0;
  const holderForm = useAppForm<BulkHolderFormValues>({
    schema: bulkHolderFormSchema,
    defaultValues: { userId: defaultBulkHolderId(viewerUserId, holderOptions) },
  });

  // `holderForm`'s `defaultValues` are captured once, at mount, by
  // react-hook-form — unlike the `useState`s above, a `key`-based remount
  // cannot re-seed them a second time, because a remount only re-evaluates
  // the *original* `defaultValues` expression at the render where it happens.
  // If the modal is opened while `LotScreen`'s `admin.user.list` fetch is
  // still in flight, that expression sees an empty `holderOptions` and mounts
  // with `userId: ''`; the fetch then resolves in a **later** render, with no
  // remount in between, and nothing would otherwise tell the form about it.
  // Left alone, the `<select>` shows its first real option (native fallback
  // for a value with no match) while the form still holds `''`, so
  // `bulkHolderFormSchema` rejects the submit and "Generate" does nothing.
  // Same problem, same fix as `spot-dialog.tsx`'s `queueForm.reset` effect.
  useEffect(() => {
    holderForm.reset({ userId: defaultBulkHolderId(viewerUserId, holderOptions) });
  }, [holderOptions, viewerUserId, holderForm]);

  const profile = useCurrentUser();
  const spotList = useQuery({ ...api.spot.list.queryOptions(), enabled: open });
  const preferredSpot = toPreferredSpotView(
    profile.data === undefined ? undefined : profile.data.preferredParkingSpotId,
    spotList.data?.spots,
    // `data` is `undefined` both in flight and after a failure, so the error
    // flags are the only thing that tells the two apart.
    profile.isError || spotList.isError
  );

  const previewBulk = useMutation({
    ...api.reservation.previewBulk.mutationOptions(),
    onSuccess: (output) => {
      setFailure(null);
      setProposal(output);
    },
    onError: setFailure,
  });

  /**
   * Every day in the batch gets its `overview.day` entry invalidated, not just
   * the days that were written.
   *
   * Over-invalidating is nearly free — an unmounted query is only marked
   * stale — and the alternative needs the client to decide which days the
   * server changed, which is exactly the kind of re-derivation
   * `doc/decision/0120-*` rules out. A day reported `UNAVAILABLE` may still
   * have moved for another reason since the overview was read.
   *
   * The refetch is not redundant with the realtime broadcast: `canReserve` and
   * `viewerReservationId` are viewer-relative, and no broadcast can carry them
   * (the same reasoning as `LotScreen`'s `onMutationSuccess`).
   */
  const invalidateDays = useCallback(
    (dates: readonly DateOnly[]) => {
      for (const date of dates) {
        void queryClient.invalidateQueries({
          queryKey: api.overview.day.queryOptions({ input: { date } }).queryKey,
        });
      }
    },
    [api, queryClient]
  );

  const confirmBulk = useMutation({
    ...api.reservation.confirmBulk.mutationOptions(),
    onSuccess: (output) => {
      setFailure(null);
      setResult(output);
      invalidateDays(output.days.map((day) => day.date));
    },
    onError: setFailure,
  });

  const grid = buildMonthGrid(anchorDate, todayInPrague());
  const weekendHeads = weekendColumns(grid);
  const selectedSet = new Set(selected);

  const toggleDay = (cell: BulkDayCell) => {
    setSelected((current) =>
      current.includes(cell.date)
        ? current.filter((date) => date !== cell.date)
        : [...current, cell.date].sort()
    );
  };

  /** One side of a difference, as one readable phrase. */
  function describeOutcome(day: BulkDayOutcomeView | null): string {
    if (day === null) {
      return t('resultChangedMissing');
    }
    const label = badgeLabel(toBadge(day), t);
    return day.outcome === 'UNAVAILABLE' ? label : `${label} · ${day.parkingSpotLabel}`;
  }

  function preferredSpotNote(): string {
    const message = toPreferredSpotMessage(preferredSpot);
    return t(message.messageKey, message.values);
  }

  // `holderError` is optional (existing test call sites never pass it), so
  // fold its `undefined` into `null` explicitly rather than leaning on `==`.
  const displayedError = failure ?? (isAdmin ? (holderError ?? null) : null);
  const failureNote =
    displayedError === null ? null : (
      <ToastRegion placement="top-right" label={tShell('notificationsRegion')}>
        <Toast tone="danger">{t(toBulkErrorMessageKey(displayedError))}</Toast>
      </ToastRegion>
    );

  const pending = previewBulk.isPending || confirmBulk.isPending;

  // ----------------------------------------------------------------- result
  //
  // **First, ahead of the locked-month refusal below.** A result is a record of
  // writes that already happened; there is nothing left here for a closed
  // window to block, and refusing at this point would replace the comparison
  // with "hromadnou rezervaci teď založit nelze" over reservations that exist —
  // the exact silent difference the whole two-step flow is built to prevent.
  // The confirm button does not exist on this step, so nothing is weakened by
  // letting it through. See `doc/decision/0176-*`.
  if (result !== null) {
    const differences = diffBulkSchedule(proposal?.days ?? [], result.days);
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title={t('resultTitle')}
        description={t('resultDescription')}
        closeLabel={t('close')}
        closeOnScrimClick={false}
        footer={<Button onClick={onClose}>{t('ctaDone')}</Button>}
      >
        <Stack spacing={4}>
          {/*
            The two visible children below (the status/alert panel and the
            calendar table) sit a `gap-5` apart, one step wider than the
            `gap-4` between the table and the summary line — the same two
            steps `mb-5`/`mt-4` expressed by hand before. `Stack.spacing` is
            uniform, so the only way to keep both steps is to nest one.
          */}
          <Stack spacing={5}>
            {differences.length === 0 ? (
              <Text as="p" role="status" tone="subtle" size="base">
                {t('resultUnchanged')}
              </Text>
            ) : (
              <Callout tone="warning" role="alert">
                <Stack spacing={3}>
                  <Stack spacing={1}>
                    <Text as="p" size="base" weight="bold" tone="default">
                      {t('resultChangedTitle')}
                    </Text>
                    <Text as="p" size="base" tone="muted" leading="loose">
                      {t('resultChangedDescription')}
                    </Text>
                  </Stack>
                  <List spacing={2}>
                    {differences.map((difference) => (
                      <ListItem key={difference.date}>
                        <Text as="span" size="base" weight="bold" tone="default">
                          {f.dayAndMonth(difference.date)} · {f.weekdayName(difference.date)}
                        </Text>
                        <Text as="span" size="base" display="block" tone="muted">
                          {t('resultChangedProposed')}: {describeOutcome(difference.proposed)}
                        </Text>
                        <Text as="span" size="base" display="block" tone="muted">
                          {t('resultChangedActual')}: {describeOutcome(difference.confirmed)}
                        </Text>
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              </Callout>
            )}

            <CalendarTable days={result.days} t={t} />
          </Stack>

          <Text as="p" size="base" tone="muted">
            {t('scheduleSummary', {
              assigned: result.summary.assigned,
              queued: result.summary.queued,
            })}
          </Text>
        </Stack>

        <ToastRegion placement="top-right" label={tShell('notificationsRegion')}>
          <Toast tone="success">{t('resultSuccessToast')}</Toast>
        </ToastRegion>
      </Modal>
    );
  }

  // ---------------------------------------------------------------- blocked
  //
  // Ahead of the two steps that can still *write* — picking days and
  // confirming — so it catches both a modal opened in a locked month and a
  // window that closes while the modal is open, which is the case a hidden
  // header button cannot cover. Deliberately **after** the result step above.
  if (!canReserveMonth) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title={t('lockedTitle')}
        closeLabel={t('close')}
        // Consistent with the three flow steps: whichever of them this replaced
        // was holding a selection, and a stray click on the scrim should not be
        // how the user finds that out.
        closeOnScrimClick={false}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        }
      >
        <Text as="p" size="base" leading="loose" tone="subtle">
          {t('lockedDescription')}
        </Text>
      </Modal>
    );
  }

  // --------------------------------------------------------------- schedule
  if (proposal !== null) {
    return (
      <SchedulePreviewModal
        open={open}
        onClose={onClose}
        t={t}
        proposal={proposal}
        pending={pending}
        onBack={() => {
          setProposal(null);
          setFailure(null);
        }}
        confirmPending={confirmBulk.isPending}
        onConfirm={() => {
          // The days of the **proposal on screen**, not of `selected`. They
          // agree today, because both procedures answer one entry per
          // requested day — but "we confirm exactly what you were shown" is
          // the invariant, and reading it off the thing that was shown is
          // the only way to state it.
          confirmBulk.mutate({
            dates: proposal.days.map((day) => day.date),
            ...(showHolderForm ? { holderId: holderForm.getValues('userId') } : {}),
          });
        }}
        failureNote={failureNote}
      />
    );
  }

  // ----------------------------------------------------------------- select
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('title')}
      description={t('description', {
        month: f.monthLocative(parseDateOnly(anchorDate).month),
      })}
      closeLabel={t('close')}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            loading={previewBulk.isPending}
            disabled={selected.length === 0 || pending || (isAdmin && holderPending)}
            onClick={
              showHolderForm
                ? holderForm.handleSubmit((values) => {
                    previewBulk.mutate({ dates: [...selected], holderId: values.userId });
                  })
                : () => {
                    previewBulk.mutate({ dates: [...selected] });
                  }
            }
          >
            {selected.length === 0
              ? t('ctaSelectDays')
              : t('ctaGenerate', { count: selected.length })}
          </Button>
        </>
      }
    >
      {showHolderForm ? (
        <FormProvider {...holderForm}>
          <BulkHolderFields options={holderOptions} />
        </FormProvider>
      ) : null}

      {/*
        `border-spacing` has no Tailwind utility that takes a token, so the
        grid chrome lives in the named `.calendar-grid` class in
        `app/global.css` (owned by another agent in this rewrite) rather than
        as an inline utility string here.
      */}
      {/* eslint-disable-next-line no-restricted-syntax -- `.calendar-grid` is the one class the design system cannot express (border-spacing has no token utility); see global.css */}
      <table className="calendar-grid">
        <VisuallyHidden as="caption">{t('gridLabel')}</VisuallyHidden>
        <thead>
          <tr>
            {WEEKDAY_KEYS.map((key, column) => (
              // `Text` now renders `as="th"` with a `scope` prop, so the
              // `<th>`/inner-`<span>` pair collapses into one element. `Text`
              // deliberately has no padding prop (no spacing surface was in
              // scope for it), so the bottom padding is carried by
              // `.calendar-grid th` in `global.css` instead.
              <Text
                key={key}
                as="th"
                scope="col"
                size="xs"
                weight="bold"
                transform="uppercase"
                tracking="caps"
                tone={weekendHeads[column] === true ? 'faint' : 'subtle'}
              >
                {t(key)}
              </Text>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week.key}>
              {week.slots.map(({ key, day }) =>
                day === null ? (
                  <td key={key} />
                ) : (
                  <td key={key}>
                    <ToggleTile
                      shape="cell"
                      transition="base"
                      selected={day.selectable ? selectedSet.has(day.date) : false}
                      selectable={day.selectable}
                      aria-pressed={day.selectable ? selectedSet.has(day.date) : undefined}
                      aria-label={
                        day.selectable
                          ? t('dayCell', { date: f.fullDate(day.date) })
                          : t('dayCellBlocked', { date: f.fullDate(day.date) })
                      }
                      onClick={() => {
                        toggleDay(day);
                      }}
                    >
                      {day.dayOfMonth}
                    </ToggleTile>
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        `Stack` now exposes `spacingX`/`spacingY` (separate `gap-x-*`/`gap-y-*`)
        alongside `spacing`, so the original `gap-x-4 gap-y-1` is reproduced
        exactly rather than widened to `gap-4` on both axes.
      */}
      <Stack direction="row" wrap spacingX={4} spacingY={1}>
        <Text as="span" size="sm" tone="subtle">
          {t('nonSelectableNote')}
        </Text>
        <Text as="span" size="sm" weight="bold" tone="default">
          {preferredSpotNote()}
        </Text>
      </Stack>

      {failureNote}
    </Modal>
  );
}
