import { render, screen } from '@testing-library/react';

import { Spinner } from './spinner';

describe('Spinner', () => {
  it('renders a span with the spin animation and default size/tone', () => {
    render(<Spinner data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner.tagName).toBe('SPAN');
    expect(spinner).toHaveClass(
      'animate-spin',
      'rounded-cta',
      'border-2',
      'size-6',
      'border-border',
      'border-t-brand-blue'
    );
  });

  it.each<[import('./spinner').SpinnerSize, string]>([
    ['sm', 'size-4'],
    ['md', 'size-6'],
  ])('applies the %s size class', (size, expectedClass) => {
    render(<Spinner data-testid="spinner" size={size} />);

    expect(screen.getByTestId('spinner')).toHaveClass(expectedClass);
  });

  it.each<[import('./spinner').SpinnerTone, string[]]>([
    ['brand', ['border-border', 'border-t-brand-blue']],
  ])('applies the %s tone classes', (tone, expectedClasses) => {
    render(<Spinner data-testid="spinner" tone={tone} />);

    expectedClasses.forEach((expectedClass) => {
      expect(screen.getByTestId('spinner')).toHaveClass(expectedClass);
    });
  });

  it('keeps caller classes alongside its own', () => {
    render(<Spinner data-testid="spinner" className="custom-class" />);

    expect(screen.getByTestId('spinner')).toHaveClass('custom-class', 'animate-spin');
  });

  it('forwards a ref to the underlying span', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<Spinner ref={ref} />);

    expect(ref.current?.tagName).toBe('SPAN');
  });

  it('is aria-hidden by default, so a sibling label carries the announcement', () => {
    render(<Spinner data-testid="spinner" />);

    expect(screen.getByTestId('spinner')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lets a caller override aria-hidden when the spinner is the only content', () => {
    render(<Spinner data-testid="spinner" aria-hidden={false} aria-label="Načítá se" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner).toHaveAttribute('aria-hidden', 'false');
    expect(spinner).toHaveAttribute('aria-label', 'Načítá se');
  });

  it('passes other attributes through', () => {
    render(<Spinner data-testid="spinner" title="Popisek" />);

    expect(screen.getByTestId('spinner')).toHaveAttribute('title', 'Popisek');
  });
});
