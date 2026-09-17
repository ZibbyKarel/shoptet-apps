import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDateFormatters, IntlProvider } from '@garage/i18n';
import csMessages from '../../../messages/cs.json';
import { LotHeader } from './lot-header';
import type { DayNoteView } from '../lot-view';

const cs = createDateFormatters('cs');

/**
 * `LotHeader` is pure presentation, same as every other piece `./lot-header.tsx`
 * draws: every decision the brief cares about is made elsewhere and handed in
 * as a prop. This suite checks it renders what it is given and reports every
 * control back through its callback, never a raw DOM event — the same
 * contract the sticky bar's own suite once checked, before `LotHeader`
 * absorbed it (`doc/decision/0140-*` revisited).
 */

const DATE = '2026-09-28';

function workdayNote(): DayNoteView {
  return { key: 'workday', name: '', highlighted: false };
}

function holidayNote(name = 'Den české státnosti'): DayNoteView {
  return { key: 'holiday', name, highlighted: true };
}

function weekendNote(): DayNoteView {
  return { key: 'weekend', name: '', highlighted: true };
}

function renderHeader(
  overrides: {
    date?: string;
    note?: DayNoteView;
    counts?: { free: number; taken: number };
    showBulk?: boolean;
  } = {}
) {
  const onBulk = jest.fn();
  const onPreviousDay = jest.fn();
  const onNextDay = jest.fn();
  const onToday = jest.fn();
  const onOpenDatePicker = jest.fn();

  const utils = render(
    <IntlProvider locale="cs" messages={csMessages}>
      <LotHeader
        date={overrides.date ?? DATE}
        note={overrides.note ?? workdayNote()}
        counts={overrides.counts ?? { free: 4, taken: 5 }}
        sectionTitle="Přehled parkoviště"
        showBulk={overrides.showBulk ?? true}
        onBulk={onBulk}
        onPreviousDay={onPreviousDay}
        onNextDay={onNextDay}
        onToday={onToday}
        onOpenDatePicker={onOpenDatePicker}
      />
    </IntlProvider>
  );

  return {
    ...utils,
    onBulk,
    onPreviousDay,
    onNextDay,
    onToday,
    onOpenDatePicker,
    user: userEvent.setup(),
  };
}

describe('LotHeader — the accessible title and the date pill', () => {
  it('carries the section title on a hidden heading, not the visible date', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Přehled parkoviště');
  });

  it('shows the date, through the same formatter the old heading used', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: cs.fullDate(DATE) })).toBeInTheDocument();
  });
});

describe('LotHeader — controls report parsed values, not raw events', () => {
  it('calls onPreviousDay from the left arrow', async () => {
    const { onPreviousDay, user } = renderHeader();
    await user.click(screen.getByRole('button', { name: 'previousDay' }));
    expect(onPreviousDay).toHaveBeenCalledTimes(1);
  });

  it('calls onNextDay from the right arrow', async () => {
    const { onNextDay, user } = renderHeader();
    await user.click(screen.getByRole('button', { name: 'nextDay' }));
    expect(onNextDay).toHaveBeenCalledTimes(1);
  });

  it('calls onToday from the "Dnes" button', async () => {
    const { onToday, user } = renderHeader();
    await user.click(screen.getByRole('button', { name: 'today' }));
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('opens the date picker from the date pill', async () => {
    const { onOpenDatePicker, user } = renderHeader();
    await user.click(screen.getByRole('button', { name: cs.fullDate(DATE) }));
    expect(onOpenDatePicker).toHaveBeenCalledTimes(1);
  });
});

describe('LotHeader — the holiday/weekend note', () => {
  it('names it a working day, on an ordinary weekday', () => {
    renderHeader({ note: workdayNote() });
    expect(screen.getByText('workday: name=')).toBeInTheDocument();
  });

  it('names the holiday on a public holiday', () => {
    renderHeader({ note: holidayNote('Den české státnosti') });
    expect(screen.getByText('holiday: name=Den české státnosti')).toBeInTheDocument();
  });

  it('names it a weekend, with no holiday name to show', () => {
    renderHeader({ note: weekendNote() });
    expect(screen.getByText('weekend: name=')).toBeInTheDocument();
  });
});

describe('LotHeader — the occupancy pill and the bulk button', () => {
  it('reads the taken and total counts off one combined pill', () => {
    renderHeader({ counts: { free: 4, taken: 5 } });
    expect(screen.getByText('occupiedCount: taken=5,total=9')).toBeInTheDocument();
  });

  it('shows the bulk-reservation button when the month allows it', () => {
    renderHeader({ showBulk: true });
    expect(screen.getByRole('button', { name: 'bulkReservation' })).toBeInTheDocument();
  });

  it('hides the bulk-reservation button — absent, not disabled — otherwise', () => {
    renderHeader({ showBulk: false });
    expect(screen.queryByRole('button', { name: 'bulkReservation' })).not.toBeInTheDocument();
  });

  it('calls onBulk when the button is clicked', async () => {
    const { onBulk, user } = renderHeader({ showBulk: true });
    await user.click(screen.getByRole('button', { name: 'bulkReservation' }));
    expect(onBulk).toHaveBeenCalledTimes(1);
  });
});
