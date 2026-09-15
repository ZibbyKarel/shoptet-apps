import { render, screen } from '@testing-library/react';

import { Text, type TextAlign, type TextDisplay, type TextLeading, type TextSize } from './text';
import type { TextTone, TextTracking, TextWeight } from './text';

describe('Text', () => {
  it('renders a <p> by default — not <span>', () => {
    // Two Playwright locators in admin-window.spec.ts depend on real <p>
    // elements in DOM order; this default is load-bearing, see text.tsx.
    render(<Text>Obsah</Text>);

    const node = screen.getByText('Obsah');
    expect(node.tagName).toBe('P');
  });

  it('always resets the user-agent margin', () => {
    render(<Text>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass('m-0');
  });

  it('emits no size/weight/tone class when the props are omitted', () => {
    render(<Text data-testid="text">Obsah</Text>);

    const node = screen.getByTestId('text');
    expect(node.className.trim()).toBe('m-0');
  });

  it.each([
    'p',
    'span',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'label',
    'caption',
  ] as const)('renders as=%s using that tag', (as) => {
    render(<Text as={as}>Obsah</Text>);

    expect(screen.getByText('Obsah').tagName).toBe(as.toUpperCase());
  });

  // `th`/`td` need a `<table>`/`<tr>` ancestor to land in their expected DOM
  // role — asserted separately from the flat tag list above.
  it('renders as=th inside a table row, with scope forwarded', () => {
    render(
      <table>
        <tbody>
          <tr>
            <Text as="th" scope="col">
              Po
            </Text>
          </tr>
        </tbody>
      </table>
    );

    const head = screen.getByRole('columnheader', { name: 'Po' });
    expect(head.tagName).toBe('TH');
    expect(head).toHaveAttribute('scope', 'col');
  });

  it('renders as=td inside a table row', () => {
    render(
      <table>
        <tbody>
          <tr>
            <Text as="td">Obsah</Text>
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText('Obsah').tagName).toBe('TD');
  });

  it.each([
    ['xs', 'text-xs'],
    ['sm', 'text-sm'],
    ['base', 'text-base'],
    ['md', 'text-md'],
    ['lg', 'text-lg'],
    ['xl', 'text-xl'],
    ['2xl', 'text-2xl'],
    ['3xl', 'text-3xl'],
  ] as [TextSize, string][])('maps size=%s to %s', (size, expected) => {
    render(<Text size={size}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it.each([
    ['normal', 'font-normal'],
    ['medium', 'font-medium'],
    ['bold', 'font-bold'],
  ] as [TextWeight, string][])('maps weight=%s to %s', (weight, expected) => {
    render(<Text weight={weight}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it.each([
    ['default', 'text-fg'],
    ['muted', 'text-fg-2'],
    ['subtle', 'text-fg-3'],
    ['faint', 'text-neutral-400'],
    ['on-yellow', 'text-fg-on-yellow'],
    ['on-green', 'text-fg-on-green'],
    ['on-blue', 'text-fg-on-blue'],
    ['inverse', 'text-neutral-0'],
    ['inverse-90', 'text-neutral-0/90'],
    ['inverse-80', 'text-neutral-0/80'],
    ['inverse-70', 'text-neutral-0/70'],
    ['inverse-60', 'text-neutral-0/60'],
    ['inverse-50', 'text-neutral-0/50'],
  ] as [TextTone, string][])('maps tone=%s to %s', (tone, expected) => {
    render(<Text tone={tone}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it.each([
    ['tight', 'tracking-tight'],
    ['snug', 'tracking-snug'],
    ['normal', 'tracking-normal'],
    ['wide', 'tracking-wide'],
    ['caps', 'tracking-caps'],
  ] as [TextTracking, string][])('maps tracking=%s to %s', (tracking, expected) => {
    render(<Text tracking={tracking}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it.each([
    ['tight', 'leading-tight'],
    ['snug', 'leading-snug'],
    ['normal', 'leading-normal'],
    ['loose', 'leading-loose'],
  ] as [TextLeading, string][])('maps leading=%s to %s', (leading, expected) => {
    render(<Text leading={leading}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it('maps transform=uppercase to uppercase', () => {
    render(<Text transform="uppercase">Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass('uppercase');
  });

  it('emits no transform class for transform=none', () => {
    render(
      <Text transform="none" data-testid="text">
        Obsah
      </Text>
    );

    expect(screen.getByTestId('text')).not.toHaveClass('uppercase');
  });

  it.each([
    ['start', 'text-left'],
    ['center', 'text-center'],
    ['end', 'text-right'],
  ] as [TextAlign, string][])('maps align=%s to %s', (align, expected) => {
    render(<Text align={align}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it.each([
    ['inline', 'inline'],
    ['block', 'block'],
    ['inline-flex', 'inline-flex'],
  ] as [TextDisplay, string][])('maps display=%s to %s', (display, expected) => {
    render(<Text display={display}>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass(expected);
  });

  it('adds truncate when truncate is set', () => {
    render(<Text truncate>Obsah</Text>);

    expect(screen.getByText('Obsah')).toHaveClass('truncate');
  });

  it('passes attributes and caller classes through, merged last', () => {
    render(
      <Text className="custom-class" data-testid="text" title="Popisek">
        Obsah
      </Text>
    );

    const node = screen.getByTestId('text');
    expect(node).toHaveClass('custom-class');
    expect(node).toHaveAttribute('title', 'Popisek');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLElement | null };
    render(<Text ref={ref}>Obsah</Text>);

    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
  });
});
