import { render, screen } from '@testing-library/react';

import { Card } from './card';

describe('Card', () => {
  it('renders the panel chrome and default padding', () => {
    render(<Card data-testid="card">content</Card>);

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('rounded-lg', 'border', 'border-border', 'bg-bg', 'p-6');
  });

  it('supports padding={0}, matching a bare panel with no inner padding', () => {
    render(<Card data-testid="card" padding={0} />);

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('p-0');
    expect(card.className).not.toContain('p-6');
  });

  it('resolves a [vertical, horizontal] padding pair', () => {
    render(<Card data-testid="card" padding={[8, 4]} />);

    expect(screen.getByTestId('card')).toHaveClass('py-8', 'px-4');
  });

  it('emits no h-full class by default', () => {
    render(<Card data-testid="card" />);

    expect(screen.getByTestId('card').className).not.toContain('h-full');
  });

  it('emits h-full when fillHeight is set', () => {
    render(<Card data-testid="card" fillHeight />);

    expect(screen.getByTestId('card')).toHaveClass('h-full');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Card ref={ref}>content</Card>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('keeps caller classes alongside its own', () => {
    render(<Card className="custom-class" data-testid="card" />);

    expect(screen.getByTestId('card')).toHaveClass('custom-class');
  });
});
