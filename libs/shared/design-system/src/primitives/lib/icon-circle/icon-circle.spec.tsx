import { createRef } from 'react';
import { render, screen } from '@testing-library/react';

import {
  IconCircle,
  type IconCircleFontSize,
  type IconCircleShape,
  type IconCircleSize,
  type IconCircleTone,
} from './icon-circle';

describe('IconCircle', () => {
  it('renders a span, shrink-0, aria-hidden by default', () => {
    const { container } = render(<IconCircle>+</IconCircle>);

    const iconCircle = container.firstElementChild;
    expect(iconCircle?.tagName).toBe('SPAN');
    expect(iconCircle).toHaveClass('inline-flex', 'shrink-0', 'items-center', 'justify-center');
    expect(iconCircle).toHaveAttribute('aria-hidden', 'true');
  });

  it.each<[IconCircleSize, string]>([
    ['xs', 'size-5'],
    ['sm', 'size-6'],
    ['md', 'size-8'],
    ['lg', 'size-12'],
  ])('applies the %s size class', (size, expected) => {
    const { container } = render(<IconCircle size={size}>+</IconCircle>);

    expect(container.firstElementChild).toHaveClass(expected);
  });

  it.each<[IconCircleShape, string]>([
    ['square', 'rounded-xs'],
    ['circle', 'rounded-cta'],
  ])('applies the %s shape class', (shape, expected) => {
    const { container } = render(<IconCircle shape={shape}>+</IconCircle>);

    expect(container.firstElementChild).toHaveClass(expected);
  });

  it.each<[IconCircleTone, string[]]>([
    ['yellow', ['bg-brand-yellow', 'text-fg-on-yellow']],
    ['green', ['bg-brand-green', 'text-brand-dark']],
    ['blue', ['bg-brand-blue', 'text-fg-on-blue']],
    ['translucent', ['bg-neutral-0/15']],
    ['translucent-light', ['bg-bg/20']],
  ])('applies the %s tone classes', (tone, expected) => {
    const { container } = render(<IconCircle tone={tone}>+</IconCircle>);

    expect(container.firstElementChild).toHaveClass(...expected);
  });

  it.each<[IconCircleFontSize, string]>([
    ['xs', 'text-xs'],
    ['sm', 'text-sm'],
    ['base', 'text-base'],
    ['md', 'text-md'],
    ['xl', 'text-xl'],
    ['2xl', 'text-2xl'],
  ])('applies the %s fontSize class', (fontSize, expected) => {
    const { container } = render(<IconCircle fontSize={fontSize}>+</IconCircle>);

    expect(container.firstElementChild).toHaveClass(expected);
  });

  it('applies no tone class when tone is omitted', () => {
    const { container } = render(<IconCircle>+</IconCircle>);

    expect(container.firstElementChild?.className).not.toMatch(/bg-/);
  });

  it('defaults to size sm, shape circle, fontSize sm, weight normal', () => {
    const { container } = render(<IconCircle>+</IconCircle>);

    expect(container.firstElementChild).toHaveClass(
      'size-6',
      'rounded-cta',
      'text-sm',
      'font-normal'
    );
  });

  it('applies leading-none only when leading="none"', () => {
    const { container, rerender } = render(<IconCircle>+</IconCircle>);
    expect(container.firstElementChild).not.toHaveClass('leading-none');

    rerender(<IconCircle leading="none">+</IconCircle>);
    expect(container.firstElementChild).toHaveClass('leading-none');
  });

  it('lets a caller override aria-hidden', () => {
    render(<IconCircle aria-hidden={false}>+</IconCircle>);

    expect(screen.getByText('+')).toHaveAttribute('aria-hidden', 'false');
  });

  it('forwards a ref to the underlying span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<IconCircle ref={ref}>+</IconCircle>);

    expect(ref.current?.tagName).toBe('SPAN');
  });

  it('passes attributes and caller classes through', () => {
    render(
      <IconCircle className="custom-class" data-testid="icon-circle" title="Popisek">
        +
      </IconCircle>
    );

    const iconCircle = screen.getByTestId('icon-circle');
    expect(iconCircle).toHaveClass('custom-class');
    expect(iconCircle).toHaveAttribute('title', 'Popisek');
  });
});
