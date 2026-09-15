import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { Divider } from '../divider/divider';
import { Stack } from './stack';

function Box({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-bg-muted px-4 py-2 text-sm">{children}</div>
  );
}

const meta: Meta<typeof Stack> = {
  title: 'Primitives/Stack',
  component: Stack,
  args: { spacing: 4 },
};

export default meta;
type Story = StoryObj<typeof Stack>;

/** Default: vertical flow with a gap, replacing `flex flex-col gap-*`. */
export const Column: Story = {
  render: (args) => (
    <Stack {...args}>
      <Box>Jeden</Box>
      <Box>Dva</Box>
      <Box>Tři</Box>
    </Stack>
  ),
};

/** Horizontal toolbar row, replacing `flex items-center gap-*`. */
export const Row: Story = {
  args: { direction: 'row', align: 'center' },
  render: (args) => (
    <Stack {...args}>
      <Box>Jeden</Box>
      <Box>Dva</Box>
      <Box>Tři</Box>
    </Stack>
  ),
};

export const WithWrap: Story = {
  args: { direction: 'row', wrap: true, spacing: 2 },
  render: (args) => (
    <div className="max-w-64">
      <Stack {...args}>
        {Array.from({ length: 8 }, (_, i) => (
          <Box key={i}>Položka {i + 1}</Box>
        ))}
      </Stack>
    </div>
  ),
};

export const JustifyBetween: Story = {
  args: { direction: 'row', justify: 'between' },
  render: (args) => (
    <Stack {...args}>
      <Box>Vlevo</Box>
      <Box>Vpravo</Box>
    </Stack>
  ),
};

/** `divider` is placed between every pair of children — not before the first or after the last. */
export const WithDivider: Story = {
  args: { divider: <Divider /> },
  render: (args) => (
    <Stack {...args}>
      <Box>Jeden</Box>
      <Box>Dva</Box>
      <Box>Tři</Box>
    </Stack>
  ),
};

/** `as="nav"` — a semantic landmark instead of a plain `<div>`. */
export const AsNav: Story = {
  args: { as: 'nav', direction: 'row', spacing: 4 },
  render: (args) => (
    <Stack {...args}>
      <Box>Domů</Box>
      <Box>Parkoviště</Box>
      <Box>Nastavení</Box>
    </Stack>
  ),
};

/**
 * `spacingX`/`spacingY` override `spacing` per axis — a wrapping row whose
 * vertical gap should stay tight even though its horizontal gap is wide,
 * e.g. `bulk-modal.tsx`'s footnote row.
 */
export const AsymmetricGap: Story = {
  args: { direction: 'row', wrap: true, spacingX: 4, spacingY: 1 },
  render: (args) => (
    <div className="max-w-64">
      <Stack {...args}>
        {Array.from({ length: 8 }, (_, i) => (
          <Box key={i}>Položka {i + 1}</Box>
        ))}
      </Stack>
    </div>
  ),
};

/** `minHeight="viewport"` — a full-viewport centring wrapper, e.g. the login screen. */
export const ViewportMinHeight: Story = {
  args: { align: 'center', justify: 'center', minHeight: 'viewport' },
  render: (args) => (
    <Stack {...args} className="bg-bg-muted">
      <Box>Vystředěný obsah</Box>
    </Stack>
  ),
};

/**
 * `height="full"` — fills a fixed-height parent instead of sizing to its own
 * content, so `align="center"` centres against the real height. The app
 * shell's header (`top-bar.tsx`) wraps this in a `Box` with `height="bar"`
 * (`h-16`).
 */
export const FillHeight: Story = {
  args: { direction: 'row', align: 'center', justify: 'between', height: 'full' },
  render: (args) => (
    <div className="h-16 bg-bg-muted">
      <Stack {...args}>
        <Box>Vlevo</Box>
        <Box>Vpravo</Box>
      </Stack>
    </div>
  ),
};
