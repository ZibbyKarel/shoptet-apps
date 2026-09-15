import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDateFormatters, IntlProvider } from '@lets-park/i18n';
import csMessages from '../../../messages/cs.json';
import { DatePickerDialog } from './date-picker-dialog';

const cs = createDateFormatters('cs');

/**
 * The dialog's own job, on top of what `./date-picker-view.spec.ts` already
 * covers for the grid arithmetic: it opens on the month of `selectedDate`,
 * lets month/year navigation browse without moving that selection, and calls
 * `onSelect` with the parsed date a cell button carries — never a raw click
 * event, same convention as every other dialog in `lot/`.
 */

const SELECTED = '2026-09-15';
const YEARS = [2025, 2026, 2027] as const;

function renderDialog(overrides: { open?: boolean; selectedDate?: string } = {}) {
  const onClose = jest.fn();
  const onSelect = jest.fn();

  const utils = render(
    <IntlProvider locale="cs" messages={csMessages}>
      <DatePickerDialog
        open={overrides.open ?? true}
        onClose={onClose}
        selectedDate={overrides.selectedDate ?? SELECTED}
        years={YEARS}
        onSelect={onSelect}
      />
    </IntlProvider>
  );

  return { ...utils, onClose, onSelect, user: userEvent.setup() };
}

describe('DatePickerDialog — opening', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the month of selectedDate, with that day marked', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'datePickerTitle' });
    expect(
      within(dialog).getByRole('button', { name: `dayCell: date=${cs.fullDate(SELECTED)}` })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('DatePickerDialog — browsing does not select', () => {
  it('moves the grid a month forward without calling onSelect', async () => {
    const { onSelect, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'datePickerTitle' });

    await user.click(within(dialog).getByRole('button', { name: 'nextDay' }));

    expect(
      within(dialog).getByRole('button', { name: `dayCell: date=${cs.fullDate('2026-10-01')}` })
    ).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('jumps the grid to a chosen month and year', async () => {
    const { user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'datePickerTitle' });

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'monthLabel' }), '1');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'yearLabel' }), '2027');

    expect(
      within(dialog).getByRole('button', { name: `dayCell: date=${cs.fullDate('2027-01-01')}` })
    ).toBeInTheDocument();
  });
});

describe('DatePickerDialog — picking a day', () => {
  it('calls onSelect with the parsed date of the clicked cell', async () => {
    const { onSelect, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'datePickerTitle' });

    await user.click(
      within(dialog).getByRole('button', { name: `dayCell: date=${cs.fullDate('2026-09-21')}` })
    );

    expect(onSelect).toHaveBeenCalledWith('2026-09-21');
  });

  it('disables a weekend day and does not call onSelect when clicked', async () => {
    const { onSelect, user } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'datePickerTitle' });

    // 2026-09-20 is a Sunday. The accessible name for a blocked cell is
    // `t('dayCellBlocked', { date: f.fullDate(day.date) })` — the same
    // formatted date `cs.fullDate` produces, not the raw ISO string.
    const weekendButton = within(dialog).getByRole('button', {
      name: `dayCellBlocked: date=${cs.fullDate('2026-09-20')}`,
    });
    expect(weekendButton).toBeDisabled();

    await user.click(weekendButton);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
