import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockModeChoice } from './lock-mode-choice';

const OPTIONS = [
  { value: 'AUTO' as const, label: 'Automaticky' },
  { value: 'FORCE_OPEN' as const, label: 'Vynutit otevřeno' },
  { value: 'FORCE_LOCKED' as const, label: 'Vynutit uzamčeno' },
];

function renderChoice(
  overrides: { value?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED'; disabled?: boolean } = {}
) {
  const onValueChange = jest.fn();

  render(
    <LockModeChoice
      label="Režim zámku"
      options={OPTIONS}
      value={overrides.value ?? 'AUTO'}
      disabled={overrides.disabled ?? false}
      onValueChange={onValueChange}
    />
  );

  return { onValueChange, user: userEvent.setup() };
}

describe('LockModeChoice', () => {
  it('is one radio group, not three independent toggles', () => {
    renderChoice();

    const group = screen.getByRole('radiogroup', { name: 'Režim zámku' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    // `aria-pressed` would announce each pill as its own on/off control, with
    // nothing saying the other two just became impossible.
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('marks exactly one option as chosen', () => {
    renderChoice({ value: 'FORCE_OPEN' });

    expect(screen.getByRole('radio', { name: 'Vynutit otevřeno' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Automaticky' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Vynutit uzamčeno' })).not.toBeChecked();
  });

  it('reports the option that was clicked', async () => {
    const { onValueChange, user } = renderChoice({ value: 'AUTO' });

    await user.click(screen.getByRole('radio', { name: 'Vynutit uzamčeno' }));

    expect(onValueChange).toHaveBeenCalledWith('FORCE_LOCKED');
  });

  describe('keyboard', () => {
    it('is a single stop in the page’s tab order, on the chosen pill', async () => {
      const { user } = renderChoice({ value: 'FORCE_OPEN' });

      await user.tab();

      expect(screen.getByRole('radio', { name: 'Vynutit otevřeno' })).toHaveFocus();
      // Roving tabindex: one more Tab leaves the group entirely.
      await user.tab();
      expect(screen.getByRole('radio', { name: 'Vynutit uzamčeno' })).not.toHaveFocus();
    });

    it('moves and selects with the arrow keys', async () => {
      const { onValueChange, user } = renderChoice({ value: 'AUTO' });

      await user.tab();
      await user.keyboard('{ArrowRight}');

      expect(onValueChange).toHaveBeenCalledWith('FORCE_OPEN');
    });

    // The control is fully controlled: `value` only moves when the caller
    // re-renders it, so each direction is asserted from its own starting point
    // rather than by pressing twice against a value that never changed.
    it('moves forward with ArrowDown as well as ArrowRight', async () => {
      const { onValueChange, user } = renderChoice({ value: 'AUTO' });

      await user.tab();
      await user.keyboard('{ArrowDown}');

      expect(onValueChange).toHaveBeenLastCalledWith('FORCE_OPEN');
    });

    it('moves back with ArrowUp as well as ArrowLeft', async () => {
      const { onValueChange, user } = renderChoice({ value: 'FORCE_OPEN' });

      await user.tab();
      await user.keyboard('{ArrowUp}');

      expect(onValueChange).toHaveBeenLastCalledWith('AUTO');
    });

    it('wraps at both ends', async () => {
      const { onValueChange, user } = renderChoice({ value: 'AUTO' });

      await user.tab();
      await user.keyboard('{ArrowLeft}');

      expect(onValueChange).toHaveBeenCalledWith('FORCE_LOCKED');
    });

    it('jumps to the first and last option with Home and End', async () => {
      const { onValueChange, user } = renderChoice({ value: 'FORCE_OPEN' });

      await user.tab();
      await user.keyboard('{End}');
      expect(onValueChange).toHaveBeenLastCalledWith('FORCE_LOCKED');

      await user.keyboard('{Home}');
      expect(onValueChange).toHaveBeenLastCalledWith('AUTO');
    });
  });

  describe('while a save is in flight', () => {
    it('marks every pill disabled — the platform’s own refusal', () => {
      renderChoice({ disabled: true });

      for (const pill of screen.getAllByRole('radio')) {
        expect(pill).toBeDisabled();
      }
    });

    it('refuses a click', async () => {
      const { onValueChange, user } = renderChoice({ disabled: true });

      await user.click(screen.getByRole('radio', { name: 'Vynutit otevřeno' }));

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('ignores an arrow key that reaches the group anyway', () => {
      // Driven with `fireEvent` on the group, not with `user.keyboard`, and
      // that is the point. Every pill is `disabled`, so nothing inside is
      // focusable and a realistic key press can never bubble to the handler —
      // which means a keyboard test written the realistic way would pass on
      // the `disabled` attribute and say nothing about the handler's own
      // guard. This dispatches the event the handler would receive if the
      // pills ever stopped carrying that attribute.
      const { onValueChange } = renderChoice({ disabled: true });

      fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Režim zámku' }), {
        key: 'ArrowRight',
      });

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });
});
