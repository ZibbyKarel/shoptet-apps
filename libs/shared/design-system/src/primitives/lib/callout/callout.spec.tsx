import { render, screen } from '@testing-library/react';

import { IconCircle } from '../icon-circle/icon-circle';
import { Callout, type CalloutTone } from './callout';

describe('Callout', () => {
  it('renders the base chrome and children, no role of its own', () => {
    render(<Callout tone="warning">Zamčeno pro tento měsíc.</Callout>);

    const panel = screen.getByText('Zamčeno pro tento měsíc.').closest('div');
    expect(panel).toHaveClass('rounded-md', 'border', 'px-4', 'py-3');
    // Never invents a role — the caller sets one, per `Badge`'s same policy.
    expect(panel).not.toHaveAttribute('role');
  });

  it.each<CalloutTone>(['warning', 'success'])('tone=%s applies its tint and border', (tone) => {
    render(<Callout tone={tone}>Zpráva</Callout>);

    const panel = screen.getByText('Zpráva').closest('div');
    if (tone === 'warning') {
      expect(panel).toHaveClass('border-brand-yellow', 'bg-brand-yellow-100');
    } else {
      expect(panel).toHaveClass('border-brand-green', 'bg-brand-green-100');
    }
  });

  it('lays out as a row with the icon not shrinking when icon is present', () => {
    render(
      <Callout tone="warning" icon={<IconCircle tone="yellow">!</IconCircle>}>
        Rezervace je uzamčená.
      </Callout>
    );

    const panel = screen.getByText('Rezervace je uzamčená.').closest('div');
    expect(panel).toHaveClass('flex', 'gap-3', 'items-start');
    const iconWrapper = screen.getByText('!').closest('span[class*="shrink-0"]');
    expect(iconWrapper).not.toBeNull();
  });

  it('imposes no layout on children when icon is absent', () => {
    render(<Callout tone="success">Beze změny.</Callout>);

    const panel = screen.getByText('Beze změny.').closest('div');
    expect(panel).not.toHaveClass('flex');
  });

  it('defaults align to start, aligning the icon to the top of a two-line message', () => {
    render(
      <Callout tone="warning" icon="⊘">
        Řádek jedna. Řádek dva.
      </Callout>
    );

    const panel = screen.getByText(/Řádek jedna/).closest('div');
    expect(panel).toHaveClass('items-start');
  });

  it('centres the icon against the text when align="center"', () => {
    render(
      <Callout tone="success" icon="✓" align="center">
        Rezervace potvrzena.
      </Callout>
    );

    const panel = screen.getByText('Rezervace potvrzena.').closest('div');
    expect(panel).toHaveClass('items-center');
    expect(panel).not.toHaveClass('items-start');
  });

  it('renders as a section when as="section" is given', () => {
    render(
      <Callout tone="warning" as="section" data-testid="panel">
        Zpráva
      </Callout>
    );

    expect(screen.getByTestId('panel').tagName).toBe('SECTION');
  });

  it('carries role and aria-* through, rather than inventing its own', () => {
    render(
      <Callout tone="warning" role="alert" aria-live="assertive">
        Pozor.
      </Callout>
    );

    const panel = screen.getByRole('alert');
    expect(panel).toHaveAttribute('aria-live', 'assertive');
  });

  it('forwards the ref to the root element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(
      <Callout tone="warning" ref={ref}>
        Zpráva
      </Callout>
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('merges a caller className after its own classes', () => {
    render(
      <Callout tone="warning" className="mb-5">
        Zpráva
      </Callout>
    );

    const panel = screen.getByText('Zpráva').closest('div');
    expect(panel).toHaveClass('mb-5', 'rounded-md');
  });
});
