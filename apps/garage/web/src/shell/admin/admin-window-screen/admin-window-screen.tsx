'use client';

/**
 * The "Rezervační okno" tab (`doc/design/screens/05-admin-window.png`): the
 * settings card on the left, the per-month state list on the right.
 *
 * ## There is no Save button, because the design has none
 *
 * Both controls write on change, the same way the switches in the other two
 * tabs do. That is what the design draws, and it is what makes the right-hand
 * card meaningful: it says "podle nastavení vlevo", i.e. it is a live read of
 * the setting next to it, and a form with an unsaved pending state would make
 * that sentence false half the time. The cost — one request per stepper press —
 * is bounded by the range (1–31) and by this being an admin screen a handful of
 * people touch a handful of times.
 *
 * ## The month list never prints a date it cannot stand behind
 *
 * `windowFrom`/`windowTo` are the range the AUTO rule *would* produce. Under a
 * forced lock mode they describe a hypothetical
 * (`libs/garage/contract/src/schemas/reservation-window.ts`), so the row says so in
 * words — "automaticky by bylo otevřeno …" — instead of stating it as fact.
 *
 * Presentational: `../admin-window-panel.tsx` is the connected half.
 */

import type {
  ListMonthWindowsOutput,
  MonthWindowOverview,
  ReservationLockMode,
} from '@garage/contract';
import {
  Badge,
  Box,
  Card,
  Divider,
  Grid,
  List,
  ListItem,
  Stack,
  Stepper,
  Text,
} from '@garage/design-system/primitives';
import type { BadgeTone } from '@garage/design-system/primitives';
import {
  MAX_OPEN_DAYS_BEFORE,
  MIN_OPEN_DAYS_BEFORE,
  RESERVATION_LOCK_MODES,
  startOfYearMonth,
  useDateFormatters,
  useTranslations,
} from '@garage/i18n';
import type { DateOnly, MonthLockState } from '@garage/i18n';
import { useNotify } from '../../notifications/toast-provider';
import { ScreenDataGuard } from '../../screen-state/screen-state';
import type { ScreenData } from '../../screen-state/screen-state';
import { useAdminWriteError } from '../admin-errors';
import { LockModeChoice } from '../lock-mode-choice/lock-mode-choice';

/**
 * Badge colour per state, straight off `05-admin-window.png`: `Otevřeno` is a
 * green pill, `Uzamčeno` a yellow one, `Zatím neotevřeno` a grey one.
 *
 * Exported so a spec can pin it. The colour is not decoration on this screen —
 * it is the at-a-glance signal an admin reads before the words, so a locked
 * month rendered green is a lie that no amount of correct text undoes.
 *
 * `BANNER_STATE_TONE` in `../window-banner/window-view.ts` is its counterpart for the
 * overview banner: same three values, a different `Tone` type, a different
 * design artifact, and a pin of its own. See that docblock for why they stay
 * two maps.
 */
export const BADGE_STATE_TONE: Record<MonthLockState, BadgeTone> = {
  OPEN: 'success',
  LOCKED: 'warning',
  NOT_YET_OPEN: 'neutral',
};

export interface AdminWindowScreenProps {
  /**
   * The settings and the months they were derived under, exactly as
   * `admin.window.months` returned them — one value, because they came from one
   * response and a form that disagreed with the list beside it would be lying
   * about the same moment.
   */
  readonly reservationWindow: ScreenData<ListMonthWindowsOutput>;
  readonly onRetry: () => void;
  /** Today in Europe/Prague — the date the states were derived against. */
  readonly today: DateOnly;
  /** A full replacement of both fields; the contract has no patch. */
  readonly onChange: (next: { openDaysBefore: number; lockMode: ReservationLockMode }) => void;
  readonly isSaving: boolean;
  /** Whatever the failing `admin.window.update` call threw. */
  readonly saveError: unknown;
  /** The last save succeeded and nothing has changed since. */
  readonly isSaved: boolean;
}

export function AdminWindowScreen({
  reservationWindow,
  onRetry,
  today,
  onChange,
  isSaving,
  saveError,
  isSaved,
}: AdminWindowScreenProps) {
  const t = useTranslations('admin');
  const f = useDateFormatters();
  const describeWriteError = useAdminWriteError();

  const saveErrorMessage = describeWriteError('windowUpdate', saveError);

  useNotify(saveErrorMessage, 'danger');
  useNotify(saveErrorMessage === null && isSaved ? t('windowSaved') : null, 'success');

  return (
    <ScreenDataGuard state={reservationWindow} onRetry={onRetry} headingLevel={3}>
      {({ settings: { openDaysBefore, lockMode }, months }) => (
        <Grid columns={{ base: 1, md: 2 }} spacing={6}>
          <section aria-label={t('windowOpenTitle')}>
            {/*
              `Card`'s `fillHeight` prop (`h-full`) is `Grid`'s two direct
              children stretching to end level — `Grid` gets no `align` prop
              of its own because CSS grid's default `align-items: stretch`
              already does this for both cards without one.
            */}
            <Card fillHeight>
              <Stack spacing={5}>
                <Stack spacing={2}>
                  <Text as="h3" size="lg" weight="bold">
                    {t('windowOpenTitle')}
                  </Text>
                  {/*
                    Original was `leading-relaxed` (1.625). `Text`'s `leading`
                    scale has no `relaxed` step, but `loose` in this
                    workspace resolves to `1.6` (`theme.css` maps
                    `--lh-loose: 1.6`), not stock Tailwind's `2` — within 1.5%
                    of the original, so it is used rather than left unset.
                  */}
                  <Text size="sm" tone="subtle" leading="loose">
                    {t('windowOpenDescription')}
                  </Text>
                </Stack>

                <Stack spacing={3}>
                  <Text size="xs" weight="bold" tone="subtle" tracking="caps" transform="uppercase">
                    {t('windowDaysLabel')}
                  </Text>
                  <Stepper
                    label={t('windowDaysLabel')}
                    value={openDaysBefore}
                    min={MIN_OPEN_DAYS_BEFORE}
                    max={MAX_OPEN_DAYS_BEFORE}
                    disabled={isSaving}
                    decrementLabel={t('windowDaysDecrement')}
                    incrementLabel={t('windowDaysIncrement')}
                    formatValue={(count) => t('windowDaysValue', { count })}
                    onValueChange={(next) => onChange({ openDaysBefore: next, lockMode })}
                  />
                </Stack>

                <LockModeChoice
                  label={t('windowLockLabel')}
                  value={lockMode}
                  disabled={isSaving}
                  options={RESERVATION_LOCK_MODES.map((mode) => ({
                    value: mode,
                    label: t(`windowLock${mode}`),
                  }))}
                  onValueChange={(next) => onChange({ openDaysBefore, lockMode: next })}
                />
              </Stack>
            </Card>
          </section>

          <section aria-label={t('windowMonthsTitle')}>
            <Card padding={0} fillHeight>
              <Stack>
                {/*
                  `Box` composes the header's own padding, `Divider` the rule
                  under it — the same two classes the hand-rolled
                  `border-b border-divider px-6 py-5` div carried at once.
                */}
                <Box padding={[5, 6]}>
                  <Stack spacing={1}>
                    <Text as="h3" size="lg" weight="bold">
                      {t('windowMonthsTitle')}
                    </Text>
                    <Text size="sm" tone="subtle">
                      {t('windowMonthsDescription', { today: f.dayMonthAndYear(today) })}
                    </Text>
                  </Stack>
                </Box>
                <Divider tone="divider" />
                <List divider="line">
                  {months.map((month) => (
                    <MonthRow key={month.month} month={month} />
                  ))}
                </List>
              </Stack>
            </Card>
          </section>
        </Grid>
      )}
    </ScreenDataGuard>
  );
}

function MonthRow({ month }: { readonly month: MonthWindowOverview }) {
  const t = useTranslations('admin');
  const f = useDateFormatters();

  const range = {
    from: f.dayAndMonth(month.windowFrom),
    to: f.dayAndMonth(month.windowTo),
  };

  return (
    // `divider="line"` on the enclosing `List` supplies the
    // `border-b border-divider last:border-b-0` this `<li>` used to carry
    // itself. The e2e suite locates this row by role and reads its two `<p>`
    // elements by position (`admin-window.spec.ts:93,99`) — `Text`'s default
    // `as="p"` keeps both real paragraphs, in the same order.
    <ListItem padding={[4, 6]} direction="row" wrap align="center" justify="between" spacing={3}>
      <Stack spacing={1}>
        <Text weight="bold">{f.monthAndYear(startOfYearMonth(month.month))}</Text>
        {/*
          Original was `mt-0.5` (2px). `Stack`'s gap scale starts at `1`
          (4px) — the nearest step, used here as an approximation, not an
          exact match.
        */}
        <Text size="sm" tone="subtle">
          {month.lockMode === 'AUTO'
            ? t('windowMonthRangeAuto', range)
            : t('windowMonthRangeForced', range)}
        </Text>
      </Stack>
      <Badge tone={BADGE_STATE_TONE[month.state]}>{t(`windowState${month.state}`)}</Badge>
    </ListItem>
  );
}
