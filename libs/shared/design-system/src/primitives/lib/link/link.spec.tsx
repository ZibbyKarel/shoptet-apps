import { render, screen } from '@testing-library/react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

import { Link } from './link';

/** Stands in for `next/link`'s `Link` without pulling in a Next.js runtime. */
const FakeNextLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(
  function FakeNextLink({ children, ...props }, ref) {
    return (
      <a {...props} ref={ref} data-testid="fake-next-link">
        {children}
      </a>
    );
  }
);

describe('Link', () => {
  it('renders a real anchor by default', () => {
    render(<Link href="/lot">Zpět na parkoviště</Link>);

    const link = screen.getByRole('link', { name: 'Zpět na parkoviště' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/lot');
  });

  it('renders the underline/brand-blue treatment', () => {
    render(<Link href="/lot">Zpět</Link>);

    expect(screen.getByRole('link')).toHaveClass('underline', 'text-brand-blue', 'font-bold');
  });

  it('renders as a caller-supplied component while keeping its own classes', () => {
    render(
      <Link as={FakeNextLink} href="/lot">
        Zpět
      </Link>
    );

    const link = screen.getByTestId('fake-next-link');
    expect(link).toHaveAttribute('href', '/lot');
    expect(link).toHaveClass('underline', 'text-brand-blue');
  });

  it.each(['sm', 'base'] as const)('applies the %s size', (size) => {
    render(
      <Link href="/lot" size={size}>
        Zpět
      </Link>
    );

    expect(screen.getByRole('link')).toHaveClass(size === 'sm' ? 'text-sm' : 'text-base');
  });

  it.each(['normal', 'bold'] as const)('applies the %s weight', (weight) => {
    render(
      <Link href="/lot" weight={weight}>
        Zpět
      </Link>
    );

    expect(screen.getByRole('link')).toHaveClass(weight === 'normal' ? 'font-normal' : 'font-bold');
  });

  it("defaults tone=link to today's exact treatment", () => {
    render(<Link href="/lot">Zpět</Link>);

    const link = screen.getByRole('link');
    expect(link).toHaveClass(
      'rounded-sm',
      'text-brand-blue',
      'underline',
      'hover:text-brand-blue-700',
      'text-sm',
      'font-bold',
      'outline-none',
      'focus-visible:outline-2'
    );
  });

  it('renders tone=plain with no colour, underline, size or weight class', () => {
    render(
      <Link href="/lot" tone="plain">
        Logo
      </Link>
    );

    const link = screen.getByRole('link');
    expect(link).toHaveClass('rounded-sm', 'inline-flex', 'items-center', 'outline-none');
    expect(link.className).not.toMatch(
      /text-brand-blue|underline|text-sm|text-base|font-normal|font-bold/
    );
  });

  it('lets tone=plain still opt into an explicit size/weight', () => {
    render(
      <Link href="/lot" tone="plain" size="base" weight="normal">
        Logo
      </Link>
    );

    expect(screen.getByRole('link')).toHaveClass('text-base', 'font-normal');
  });

  it('is reachable with Tab and carries the focus ring', () => {
    render(<Link href="/lot">Zpět</Link>);

    expect(screen.getByRole('link')).toHaveClass('outline-none', 'focus-visible:outline-2');
  });

  it('forwards a ref to the underlying anchor', () => {
    const ref = { current: null as HTMLAnchorElement | null };
    render(
      <Link href="/lot" ref={ref}>
        Zpět
      </Link>
    );

    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });

  it('keeps caller classes and attributes alongside its own', () => {
    render(
      <Link href="/lot" className="custom-class" target="_blank">
        Zpět
      </Link>
    );

    const link = screen.getByRole('link');
    expect(link).toHaveClass('custom-class');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
