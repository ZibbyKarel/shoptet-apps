import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Select } from './select';

function renderSelect(props: Partial<Parameters<typeof Select>[0]> = {}) {
  return render(
    <Select label="Možnost" {...props}>
      <option value="a">První</option>
      <option value="b">Druhá</option>
      <option value="c">Třetí</option>
    </Select>
  );
}

describe('Select', () => {
  it('exposes a combobox with its label as the accessible name', () => {
    renderSelect();

    expect(screen.getByRole('combobox', { name: 'Možnost' })).toBeInTheDocument();
  });

  it('changes value with the pointer', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderSelect({ onChange });

    const select = screen.getByRole('combobox', { name: 'Možnost' });
    await user.selectOptions(select, 'b');

    expect(select).toHaveValue('b');
    expect(onChange).toHaveBeenCalled();
  });

  it('is reachable with Tab', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.tab();

    expect(screen.getByRole('combobox', { name: 'Možnost' })).toHaveFocus();
  });

  it('stays a native <select>, which is where its keyboard behaviour comes from', () => {
    renderSelect();

    // Arrow keys, type-ahead, Home/End and the mobile picker are the browser's
    // to implement, and jsdom does not — so the meaningful assertion is that
    // the element handing them out is still the platform one, not a div with
    // `role="combobox"` that would have to reimplement all of it.
    const select = screen.getByRole('combobox', { name: 'Možnost' });
    expect(select.tagName).toBe('SELECT');
    expect(select).not.toHaveAttribute('role');
  });

  it('keeps the chevron out of the accessibility tree', () => {
    const { container } = renderSelect();

    const chevron = container.querySelector('svg');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks the control invalid and announces the error message', () => {
    renderSelect({ error: 'Vyber prosím možnost.' });

    const select = screen.getByRole('combobox', { name: 'Možnost' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Vyber prosím možnost.');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('describes the control with its hint', () => {
    renderSelect({ hint: 'Změnit můžeš kdykoli.' });

    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('Změnit můžeš kdykoli.');
  });

  it('cannot be focused or changed when disabled', async () => {
    const user = userEvent.setup();
    renderSelect({ disabled: true });

    const select = screen.getByRole('combobox', { name: 'Možnost' });
    expect(select).toBeDisabled();

    await user.tab();
    expect(select).not.toHaveFocus();
  });

  it('focuses the control when its label is clicked', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByText('Možnost'));

    expect(screen.getByRole('combobox', { name: 'Možnost' })).toHaveFocus();
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLSelectElement | null };
    renderSelect({ ref });

    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it('emits no width class on the wrapper by default', () => {
    renderSelect();

    const wrapper = screen.getByRole('combobox').closest('div');
    expect(wrapper?.className).not.toMatch(/w-full|flex-1/);
  });

  it.each([
    ['full', 'w-full'],
    ['grow', 'flex-1'],
  ] as const)('applies width=%s to the wrapper, not the select', (width, expected) => {
    renderSelect({ width });

    const select = screen.getByRole('combobox');
    expect(select.closest('div')).toHaveClass(expected);
  });
});
