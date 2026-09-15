import { render, screen } from '@testing-library/react';

import { Box } from './box';

describe('Box', () => {
  it('applies no classes by default beyond a caller className', () => {
    render(
      <Box className="custom-class" data-testid="box">
        content
      </Box>
    );

    expect(screen.getByTestId('box')).toHaveClass('custom-class');
  });

  it('resolves padding and margin independently', () => {
    render(<Box data-testid="box" padding={6} margin={[2, 4]} />);

    const box = screen.getByTestId('box');
    expect(box).toHaveClass('p-6', 'my-2', 'mx-4');
  });

  it.each([
    ['bg', 'bg-bg'],
    ['bg-soft', 'bg-bg-soft'],
    ['bg-muted', 'bg-bg-muted'],
  ] as const)('maps background=%s to %s', (background, expected) => {
    render(<Box data-testid="box" background={background} />);

    expect(screen.getByTestId('box')).toHaveClass(expected);
  });

  it.each([
    ['sm', 'rounded-sm'],
    ['md', 'rounded-md'],
    ['lg', 'rounded-lg'],
  ] as const)('maps radius=%s to %s', (radius, expected) => {
    render(<Box data-testid="box" radius={radius} />);

    expect(screen.getByTestId('box')).toHaveClass(expected);
  });

  it('adds a border when border is set', () => {
    render(<Box data-testid="box" border />);

    expect(screen.getByTestId('box')).toHaveClass('border', 'border-border');
  });

  it.each([
    ['bottom', ['border-b', 'border-border']],
    ['top', ['border-t', 'border-border']],
  ] as const)('maps border=%s to a single-sided rule', (side, expected) => {
    render(<Box data-testid="box" border={side} />);

    const box = screen.getByTestId('box');
    expect(box).toHaveClass(...expected);
    expect(box).not.toHaveClass('border');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Box ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('emits no position class for the default position="static"', () => {
    render(<Box data-testid="box" />);

    const box = screen.getByTestId('box');
    expect(box).not.toHaveClass('relative');
    expect(box).not.toHaveClass('absolute');
  });

  it.each([
    ['relative', 'relative'],
    ['absolute', 'absolute'],
  ] as const)('maps position=%s to %s', (position, expected) => {
    render(<Box data-testid="box" position={position} />);

    expect(screen.getByTestId('box')).toHaveClass(expected);
  });

  it.each([
    ['top-left', ['left-2', 'top-2']],
    ['top-right', ['right-2', 'top-2']],
    ['top-center', ['top-2', 'left-1/2', '-translate-x-1/2']],
    ['bottom-left', ['left-2', 'bottom-2']],
    ['bottom-right', ['right-2', 'bottom-2']],
    ['bottom-center', ['bottom-2', 'left-1/2', '-translate-x-1/2']],
  ] as const)('maps placement=%s to %s', (placement, expected) => {
    render(<Box data-testid="box" placement={placement} />);

    expect(screen.getByTestId('box')).toHaveClass(...expected);
  });

  it('a placement implies position="absolute" even without position set', () => {
    render(<Box data-testid="box" placement="bottom-center" />);

    expect(screen.getByTestId('box')).toHaveClass('absolute');
  });

  it('a placement wins over an explicit non-absolute position', () => {
    render(<Box data-testid="box" position="relative" placement="top-right" />);

    expect(screen.getByTestId('box')).toHaveClass('absolute');
  });

  it('applies pointer-events-none when interactive="none"', () => {
    render(<Box data-testid="box" interactive="none" />);

    expect(screen.getByTestId('box')).toHaveClass('pointer-events-none');
  });

  it('applies no pointer-events class by default', () => {
    render(<Box data-testid="box" />);

    expect(screen.getByTestId('box')).not.toHaveClass('pointer-events-none');
  });

  it('renders a div by default', () => {
    render(<Box data-testid="box" />);

    expect(screen.getByTestId('box').tagName).toBe('DIV');
  });

  it.each(['section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'span'] as const)(
    'renders as=%s as the matching element',
    (as) => {
      render(<Box data-testid="box" as={as} />);

      expect(screen.getByTestId('box').tagName).toBe(as.toUpperCase());
    }
  );

  it('forwards a ref to the element chosen by as', () => {
    const ref = { current: null as HTMLElement | null };
    render(<Box ref={ref} as="header" />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe('HEADER');
  });

  it('maps radius="cta" to rounded-cta', () => {
    render(<Box data-testid="box" radius="cta" />);

    expect(screen.getByTestId('box')).toHaveClass('rounded-cta');
  });

  it('maps position="sticky" to sticky', () => {
    render(<Box data-testid="box" position="sticky" />);

    expect(screen.getByTestId('box')).toHaveClass('sticky');
  });

  it('maps inset="top" to top-0', () => {
    render(<Box data-testid="box" inset="top" />);

    expect(screen.getByTestId('box')).toHaveClass('top-0');
  });

  it.each([
    ['sticky', 'z-[var(--z-sticky)]'],
    ['dropdown', 'z-[var(--z-dropdown)]'],
    ['overlay', 'z-[var(--z-overlay)]'],
  ] as const)('maps layer=%s to %s', (layer, expected) => {
    render(<Box data-testid="box" layer={layer} />);

    expect(screen.getByTestId('box')).toHaveClass(expected);
  });

  it('maps height="bar" to h-16', () => {
    render(<Box data-testid="box" height="bar" />);

    expect(screen.getByTestId('box')).toHaveClass('h-16');
  });

  it('maps minHeight="viewport" to min-h-dvh', () => {
    render(<Box data-testid="box" minHeight="viewport" />);

    expect(screen.getByTestId('box')).toHaveClass('min-h-dvh');
  });

  it.each([
    ['sm', 'shadow-sm'],
    ['md', 'shadow-md'],
    ['lg', 'shadow-lg'],
  ] as const)('maps shadow=%s to %s', (shadow, expected) => {
    render(<Box data-testid="box" shadow={shadow} />);

    expect(screen.getByTestId('box')).toHaveClass(expected);
  });

  it('emits no extra layout classes when only as is given, beyond the chosen tag', () => {
    render(
      <Box as="section" data-testid="box">
        content
      </Box>
    );

    const box = screen.getByTestId('box');
    expect(box.tagName).toBe('SECTION');
    expect(box.className).toBe('');
  });
});
