import { render, screen } from '@testing-library/react';

import { VisuallyHidden } from './visually-hidden';

describe('VisuallyHidden', () => {
  it('renders a <span> by default with the literal class sr-only', () => {
    render(<VisuallyHidden>Popisek</VisuallyHidden>);

    const node = screen.getByText('Popisek');
    expect(node.tagName).toBe('SPAN');
    expect(node).toHaveClass('sr-only');
  });

  it('emits no class beyond sr-only by default', () => {
    render(<VisuallyHidden data-testid="hidden">Popisek</VisuallyHidden>);

    expect(screen.getByTestId('hidden').className.trim()).toBe('sr-only');
  });

  it.each(['span', 'div', 'caption', 'h1', 'h2', 'legend'] as const)(
    'renders as=%s using that tag, still with sr-only',
    (as) => {
      render(<VisuallyHidden as={as}>Popisek</VisuallyHidden>);

      const node = screen.getByText('Popisek');
      expect(node.tagName).toBe(as.toUpperCase());
      expect(node).toHaveClass('sr-only');
    }
  );

  it('passes attributes and caller classes through, merged last', () => {
    render(
      <VisuallyHidden className="custom-class" data-testid="hidden" title="Popisek">
        Obsah
      </VisuallyHidden>
    );

    const node = screen.getByTestId('hidden');
    expect(node).toHaveClass('sr-only', 'custom-class');
    expect(node).toHaveAttribute('title', 'Popisek');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLElement | null };
    render(<VisuallyHidden ref={ref}>Obsah</VisuallyHidden>);

    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});
