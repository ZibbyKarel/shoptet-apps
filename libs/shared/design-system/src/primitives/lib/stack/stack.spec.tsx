import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Stack } from './stack';

describe('Stack', () => {
  it('defaults to a column flex box with no gap/alignment classes', () => {
    render(
      <Stack data-testid="stack">
        <span>a</span>
      </Stack>
    );

    const stack = screen.getByTestId('stack');
    expect(stack).toHaveClass('flex', 'flex-col');
    expect(stack.className).not.toContain('gap-');
    expect(stack.className).not.toContain('items-');
    expect(stack.className).not.toContain('justify-');
  });

  it('switches to a row', () => {
    render(<Stack data-testid="stack" direction="row" />);

    expect(screen.getByTestId('stack')).toHaveClass('flex-row');
  });

  it('applies the gap for the given spacing step', () => {
    render(<Stack data-testid="stack" spacing={6} />);

    expect(screen.getByTestId('stack')).toHaveClass('gap-6');
  });

  it('maps align to items-*', () => {
    render(<Stack data-testid="stack" align="center" />);

    expect(screen.getByTestId('stack')).toHaveClass('items-center');
  });

  it('maps justify to justify-*', () => {
    render(<Stack data-testid="stack" justify="between" />);

    expect(screen.getByTestId('stack')).toHaveClass('justify-between');
  });

  it('applies flex-wrap only when wrap is set', () => {
    const { rerender } = render(<Stack data-testid="stack" />);
    expect(screen.getByTestId('stack').className).not.toContain('flex-wrap');

    rerender(<Stack data-testid="stack" wrap />);
    expect(screen.getByTestId('stack')).toHaveClass('flex-wrap');
  });

  it('keeps caller classes alongside its own', () => {
    render(<Stack data-testid="stack" className="custom-class" />);

    expect(screen.getByTestId('stack')).toHaveClass('custom-class');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<Stack ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('renders children with no divider when none is given', () => {
    render(
      <Stack>
        <span>one</span>
        <span>two</span>
      </Stack>
    );

    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByTestId('divider')).not.toBeInTheDocument();
  });

  it('inserts the divider between every pair of children, not before the first or after the last', () => {
    render(
      <Stack divider={<span data-testid="divider" />}>
        <span>one</span>
        <span>two</span>
        <span>three</span>
      </Stack>
    );

    expect(screen.getAllByTestId('divider')).toHaveLength(2);
  });

  it('skips nullish children before placing dividers, so no divider sits next to an empty slot', () => {
    render(
      <Stack divider={<span data-testid="divider" />}>
        <span>one</span>
        {null}
        <span>two</span>
        {undefined}
        <span>three</span>
      </Stack>
    );

    expect(screen.getAllByTestId('divider')).toHaveLength(2);
  });

  it("keys the divider wrapper by each child's own key, not by array position, so reordering keeps an uncontrolled child's state with the child it belongs to", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Stack divider={<span data-testid="divider" />}>
        <input key="a" data-testid="input-a" defaultValue="" />
        <input key="b" data-testid="input-b" defaultValue="" />
      </Stack>
    );

    await user.type(screen.getByTestId('input-a'), 'hello');
    expect(screen.getByTestId('input-a')).toHaveValue('hello');
    expect(screen.getByTestId('input-b')).toHaveValue('');

    // Reorder the same two children (same keys, swapped position).
    rerender(
      <Stack divider={<span data-testid="divider" />}>
        <input key="b" data-testid="input-b" defaultValue="" />
        <input key="a" data-testid="input-a" defaultValue="" />
      </Stack>
    );

    // If the wrapper were keyed by array index, React would match the old
    // position-0 element (holding "hello") to whatever now renders at
    // position 0 — reusing that DOM node's uncontrolled value under the
    // *other* input's identity. Keyed by the child's own key, "hello" stays
    // attached to `input-a` wherever it now renders.
    expect(screen.getByTestId('input-a')).toHaveValue('hello');
    expect(screen.getByTestId('input-b')).toHaveValue('');
  });

  it('renders a div by default', () => {
    render(<Stack data-testid="stack" />);

    expect(screen.getByTestId('stack').tagName).toBe('DIV');
  });

  it.each(['section', 'header', 'footer', 'main', 'nav', 'aside', 'article', 'span'] as const)(
    'renders as=%s as the matching element',
    (as) => {
      render(<Stack data-testid="stack" as={as} />);

      expect(screen.getByTestId('stack').tagName).toBe(as.toUpperCase());
    }
  );

  it('forwards a ref to the element chosen by as', () => {
    const ref = { current: null as HTMLElement | null };
    render(<Stack ref={ref} as="nav" />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe('NAV');
  });

  it('applies spacingX/spacingY independently of spacing', () => {
    render(<Stack data-testid="stack" spacingX={4} spacingY={1} />);

    const stack = screen.getByTestId('stack');
    expect(stack).toHaveClass('gap-x-4', 'gap-y-1');
    expect(stack.className).not.toMatch(/(?<!-x-|-y-)gap-\d/);
  });

  it('spacingX/spacingY override spacing on their own axis', () => {
    render(<Stack data-testid="stack" spacing={6} spacingY={1} />);

    const stack = screen.getByTestId('stack');
    expect(stack).toHaveClass('gap-6', 'gap-y-1');
  });

  it('maps minHeight="viewport" to min-h-dvh', () => {
    render(<Stack data-testid="stack" minHeight="viewport" />);

    expect(screen.getByTestId('stack')).toHaveClass('min-h-dvh');
  });

  it('maps height="full" to h-full', () => {
    render(<Stack data-testid="stack" height="full" />);

    expect(screen.getByTestId('stack')).toHaveClass('h-full');
  });

  it('emits no height class by default', () => {
    render(<Stack data-testid="stack" />);

    expect(screen.getByTestId('stack').className).not.toContain('h-full');
  });
});
