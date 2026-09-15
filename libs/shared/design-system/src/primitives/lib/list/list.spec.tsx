import { render, screen } from '@testing-library/react';

import { List, ListItem } from './list';

describe('List', () => {
  it('defaults to a <ul> with no marker and no gap/alignment classes', () => {
    render(
      <List data-testid="list">
        <ListItem>one</ListItem>
      </List>
    );

    const list = screen.getByTestId('list');
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('flex', 'flex-col', 'list-none', 'm-0', 'p-0');
    expect(list.className).not.toContain('gap-');
    expect(list.className).not.toContain('items-');
    expect(list.className).not.toContain('justify-');
  });

  it('exposes the list ARIA role', () => {
    render(<List>{null}</List>);

    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('renders <ol> when as="ol" is given', () => {
    render(<List as="ol" data-testid="list" />);

    const list = screen.getByTestId('list');
    expect(list.tagName).toBe('OL');
    expect(screen.getByRole('list')).toBe(list);
  });

  it('switches to a row', () => {
    render(<List data-testid="list" direction="row" />);

    expect(screen.getByTestId('list')).toHaveClass('flex-row');
  });

  it('applies the gap for the given spacing step', () => {
    render(<List data-testid="list" spacing={6} />);

    expect(screen.getByTestId('list')).toHaveClass('gap-6');
  });

  it('maps align to items-*', () => {
    render(<List data-testid="list" align="center" />);

    expect(screen.getByTestId('list')).toHaveClass('items-center');
  });

  it('maps justify to justify-*', () => {
    render(<List data-testid="list" justify="between" />);

    expect(screen.getByTestId('list')).toHaveClass('justify-between');
  });

  it('applies flex-wrap only when wrap is set', () => {
    const { rerender } = render(<List data-testid="list" />);
    expect(screen.getByTestId('list').className).not.toContain('flex-wrap');

    rerender(<List data-testid="list" wrap />);
    expect(screen.getByTestId('list')).toHaveClass('flex-wrap');
  });

  it.each([
    ['none' as const, 'list-none'],
    ['disc' as const, 'list-disc'],
  ])('maps marker=%s to %s', (marker, expected) => {
    render(<List data-testid="list" marker={marker} />);

    expect(screen.getByTestId('list')).toHaveClass(expected);
  });

  it('keeps caller classes alongside its own', () => {
    render(<List data-testid="list" className="custom-class" />);

    expect(screen.getByTestId('list')).toHaveClass('custom-class');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLUListElement | HTMLOListElement | null };
    render(<List ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLUListElement);
  });
});

describe('ListItem', () => {
  it('renders a real <li> with the listitem ARIA role and no layout class by default', () => {
    render(
      <List>
        <ListItem data-testid="item">plain text item</ListItem>
      </List>
    );

    const item = screen.getByTestId('item');
    expect(item.tagName).toBe('LI');
    expect(screen.getByRole('listitem')).toBe(item);
    expect(item.className).not.toContain('flex');
  });

  it('works standalone, outside a List, with no divider applied', () => {
    render(<ListItem data-testid="item">standalone</ListItem>);

    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.getByTestId('item').className).not.toContain('border-b');
  });

  it('applies padding via resolvePadding', () => {
    render(
      <List>
        <ListItem data-testid="item" padding={4} />
      </List>
    );

    expect(screen.getByTestId('item')).toHaveClass('p-4');
  });

  it('lays out its own children when a layout prop is set', () => {
    render(
      <List>
        <ListItem
          data-testid="item"
          direction="row"
          align="center"
          justify="between"
          spacing={2}
          wrap
        >
          <span>a</span>
          <span>b</span>
        </ListItem>
      </List>
    );

    const item = screen.getByTestId('item');
    expect(item).toHaveClass(
      'flex',
      'flex-row',
      'items-center',
      'justify-between',
      'gap-2',
      'flex-wrap'
    );
  });

  it('carries no divider border when the enclosing List has divider="none" (the default)', () => {
    render(
      <List>
        <ListItem data-testid="item" />
      </List>
    );

    expect(screen.getByTestId('item').className).not.toContain('border-b');
  });

  it('carries a bottom border on every item, and last:border-b-0, when the List has divider="line"', () => {
    render(
      <List divider="line">
        <ListItem data-testid="one">one</ListItem>
        <ListItem data-testid="two">two</ListItem>
      </List>
    );

    expect(screen.getByTestId('one')).toHaveClass('border-b', 'border-divider', 'last:border-b-0');
    expect(screen.getByTestId('two')).toHaveClass('border-b', 'border-divider', 'last:border-b-0');
  });

  it('keeps caller classes alongside its own', () => {
    render(
      <List>
        <ListItem data-testid="item" className="custom-class" />
      </List>
    );

    expect(screen.getByTestId('item')).toHaveClass('custom-class');
  });

  it('forwards a ref to the underlying element', () => {
    const ref = { current: null as HTMLLIElement | null };
    render(
      <List>
        <ListItem ref={ref} />
      </List>
    );

    expect(ref.current).toBeInstanceOf(HTMLLIElement);
  });
});
