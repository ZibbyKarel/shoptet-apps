import type { Meta, StoryObj } from '@storybook/react-vite';

import { List, ListItem } from './list';

const meta: Meta<typeof List> = {
  title: 'Primitives/List',
  component: List,
  args: { spacing: 2 },
};

export default meta;
type Story = StoryObj<typeof List>;

/** Default: a plain `<ul>`, no marker, replacing `<ul className="flex flex-col gap-2">`. */
export const Column: Story = {
  render: (args) => (
    <List {...args}>
      <ListItem>Jeden</ListItem>
      <ListItem>Dva</ListItem>
      <ListItem>Tři</ListItem>
    </List>
  ),
};

/** Numbered list via `as="ol"`. */
export const Ordered: Story = {
  args: { as: 'ol' },
  render: (args) => (
    <List {...args}>
      <ListItem>Jeden</ListItem>
      <ListItem>Dva</ListItem>
      <ListItem>Tři</ListItem>
    </List>
  ),
};

/** Each item lays out its own contents in a row via the layout props on `ListItem`. */
export const RowItems: Story = {
  render: (args) => (
    <List {...args}>
      <ListItem direction="row" justify="between" padding={2}>
        <span>Vlevo</span>
        <span>Vpravo</span>
      </ListItem>
      <ListItem direction="row" justify="between" padding={2}>
        <span>Vlevo</span>
        <span>Vpravo</span>
      </ListItem>
    </List>
  ),
};

/**
 * `divider="line"` puts a bottom border under every item, removed on the
 * last one — replacing `border-b border-divider ... last:border-b-0`
 * hand-rolled today in `admin-window-screen.tsx`.
 */
export const WithLineDivider: Story = {
  args: { divider: 'line' },
  render: (args) => (
    <List {...args}>
      <ListItem padding={[3, 0]}>Jeden</ListItem>
      <ListItem padding={[3, 0]}>Dva</ListItem>
      <ListItem padding={[3, 0]}>Tři</ListItem>
    </List>
  ),
};
