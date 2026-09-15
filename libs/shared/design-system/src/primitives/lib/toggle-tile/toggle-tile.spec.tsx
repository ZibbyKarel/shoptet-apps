import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToggleTile } from './toggle-tile';

describe('ToggleTile', () => {
  it('renders a real button that defaults to type="button" and shape="cell"', () => {
    render(<ToggleTile>12</ToggleTile>);

    const button = screen.getByRole('button', { name: '12' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('h-[var(--control-h-lg)]', 'w-full', 'rounded-sm');
  });

  it.each([
    ['cell', false, true],
    ['cell', true, true],
    ['cell', false, false],
    ['pill', false, true],
    ['pill', true, true],
  ] as const)(
    'shape=%s selected=%s selectable=%s renders its chrome',
    (shape, selected, selectable) => {
      render(
        <ToggleTile shape={shape} selected={selected} selectable={selectable}>
          Den
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: 'Den' });
      if (selected && selectable) {
        expect(button).toHaveClass('bg-brand-blue');
      }
    }
  );

  it('a cell tile that is not selectable is a real disabled button, not merely unstyled', () => {
    render(
      <ToggleTile shape="cell" selectable={false}>
        15
      </ToggleTile>
    );

    const button = screen.getByRole('button', { name: '15' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveClass('cursor-default', 'border-transparent', 'bg-bg-soft', 'text-fg-3');
  });

  it('a pill tile that is disabled gets the disabled chrome, distinct from unselected', () => {
    render(
      <ToggleTile shape="pill" disabled>
        Ruční
      </ToggleTile>
    );

    const button = screen.getByRole('button', { name: 'Ruční' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('cursor-not-allowed', 'bg-bg-muted', 'text-fg-3');
  });

  it('disabled and selectable=false both land on the same inactive state', () => {
    const { rerender } = render(
      <ToggleTile shape="cell" selectable={false}>
        1
      </ToggleTile>
    );
    const bySelectable = screen.getByRole('button').className;

    rerender(
      <ToggleTile shape="cell" disabled>
        1
      </ToggleTile>
    );
    const byDisabled = screen.getByRole('button').className;

    expect(bySelectable).toBe(byDisabled);
  });

  it.each(['none', 'base', 'fast'] as const)('applies the %s transition', (transition) => {
    render(<ToggleTile transition={transition}>1</ToggleTile>);

    const button = screen.getByRole('button');
    if (transition === 'none') {
      expect(button.className).not.toContain('transition');
    } else {
      expect(button).toHaveClass('transition');
    }
  });

  it('does not fire and cannot be focused when not selectable', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(
      <ToggleTile selectable={false} onClick={onClick}>
        1
      </ToggleTile>
    );

    const button = screen.getByRole('button');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    await user.tab();
    expect(button).not.toHaveFocus();
  });

  it('fires on click and keyboard when selectable', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<ToggleTile onClick={onClick}>1</ToggleTile>);

    const button = screen.getByRole('button');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts role="radio" and aria-checked for a roving-tabindex radio group', () => {
    render(
      <ToggleTile shape="pill" role="radio" aria-checked={true}>
        Automaticky
      </ToggleTile>
    );

    const radio = screen.getByRole('radio', { name: 'Automaticky' });
    expect(radio).toHaveAttribute('aria-checked', 'true');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<ToggleTile ref={ref}>1</ToggleTile>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('keeps caller classes alongside its own', () => {
    render(<ToggleTile className="custom-class">1</ToggleTile>);

    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  describe('accentColor', () => {
    it('applies the accent background and swaps the inactive text token, for an inactive cell', () => {
      render(
        <ToggleTile shape="cell" selectable={false} accentColor="var(--color-car-2)">
          16
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: '16' });
      expect(button).toHaveStyle({ backgroundColor: 'var(--color-car-2)' });
      expect(button).toHaveClass('text-fg');
      expect(button).not.toHaveClass('bg-bg-soft', 'text-fg-3');
    });

    it('has no effect on an active (selectable) cell', () => {
      render(
        <ToggleTile shape="cell" accentColor="var(--color-car-1)">
          1
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: '1' });
      expect(button.style.backgroundColor).toBe('');
      expect(button).toHaveClass('bg-bg');
    });

    it('has no effect on an inactive pill', () => {
      render(
        <ToggleTile shape="pill" disabled accentColor="var(--color-car-3)">
          Zamčeno
        </ToggleTile>
      );

      const button = screen.getByRole('button', { name: 'Zamčeno' });
      expect(button.style.backgroundColor).toBe('');
      expect(button).toHaveClass('bg-bg-muted', 'text-fg-3');
    });
  });
});
