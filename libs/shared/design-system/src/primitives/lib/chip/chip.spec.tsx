import { createRef } from 'react';
import { render, screen } from '@testing-library/react';

import { Chip, type ChipDot, type ChipSize, type ChipTone } from './chip';

describe('Chip', () => {
  it('renders as an inline-flex pill, by default a span with no role', () => {
    const { container } = render(<Chip>Volno</Chip>);

    const chip = container.firstElementChild;
    expect(chip?.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
    expect(chip).toHaveClass('inline-flex', 'items-center', 'gap-2', 'rounded-cta');
  });

  it.each<[ChipSize, string[]]>([
    ['sm', ['h-8', 'px-3', 'text-sm']],
    ['md', ['h-9', 'px-4', 'text-base']],
    ['lg', ['h-10', 'px-4', 'text-sm']],
  ])('applies the %s size classes', (size, expected) => {
    const { container } = render(<Chip size={size}>Volno</Chip>);

    expect(container.firstElementChild).toHaveClass(...expected);
  });

  it.each<[ChipTone, string[]]>([
    ['outline', ['border', 'border-border', 'bg-bg']],
    ['muted', ['bg-bg-muted']],
  ])('applies the %s tone classes', (tone, expected) => {
    const { container } = render(<Chip tone={tone}>Volno</Chip>);

    expect(container.firstElementChild).toHaveClass(...expected);
  });

  it('defaults to size md and tone outline', () => {
    const { container } = render(<Chip>Volno</Chip>);

    expect(container.firstElementChild).toHaveClass('h-9', 'px-4', 'text-base', 'border-border');
  });

  it('applies font-medium only for weight="medium"', () => {
    const { container, rerender } = render(<Chip weight="normal">Volno</Chip>);
    expect(container.firstElementChild).not.toHaveClass('font-medium');

    rerender(<Chip weight="medium">Volno</Chip>);
    expect(container.firstElementChild).toHaveClass('font-medium');
  });

  it('renders no leading dot by default', () => {
    render(<Chip>Volno</Chip>);

    expect(document.querySelector('.size-2')).not.toBeInTheDocument();
  });

  it.each<[Exclude<ChipDot, 'none'>, string]>([
    ['green', 'bg-brand-green'],
    ['blue', 'bg-brand-blue'],
  ])('renders an aria-hidden leading dot for dot="%s"', (dot, expectedClass) => {
    render(<Chip dot={dot}>Volno</Chip>);

    const dotEl = document.querySelector('.size-2');
    expect(dotEl).toHaveClass(expectedClass);
    expect(dotEl).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['span', 'div', 'p'] as const)('renders as a %s when as="%s" is given', (as) => {
    const { container } = render(<Chip as={as}>Volno</Chip>);

    expect(container.firstElementChild?.tagName).toBe(as.toUpperCase());
  });

  it('forwards a ref to the underlying element', () => {
    const ref = createRef<HTMLElement>();
    render(<Chip ref={ref}>Volno</Chip>);

    expect(ref.current?.tagName).toBe('SPAN');
  });

  it('passes attributes and caller classes through', () => {
    render(
      <Chip className="custom-class" data-testid="chip" title="Popisek">
        Volno
      </Chip>
    );

    const chip = screen.getByTestId('chip');
    expect(chip).toHaveClass('custom-class');
    expect(chip).toHaveAttribute('title', 'Popisek');
  });
});
