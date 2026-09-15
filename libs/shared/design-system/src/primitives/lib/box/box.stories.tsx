import type { Meta, StoryObj } from '@storybook/react-vite';

import { Box, type BoxBackground, type BoxPlacement } from './box';

const BACKGROUNDS: BoxBackground[] = ['bg', 'bg-soft', 'bg-muted'];
const PLACEMENTS: BoxPlacement[] = [
  'top-left',
  'top-right',
  'top-center',
  'bottom-left',
  'bottom-right',
  'bottom-center',
];

const meta: Meta<typeof Box> = {
  title: 'Primitives/Box',
  component: Box,
  args: { padding: 4, border: true, radius: 'md' },
};

export default meta;
type Story = StoryObj<typeof Box>;

export const Default: Story = {
  render: (args) => <Box {...args}>Obsah</Box>,
};

/** The three `bg-*` backgrounds side by side. */
export const Backgrounds: Story = {
  render: (args) => (
    <div className="flex gap-4">
      {BACKGROUNDS.map((background) => (
        <Box key={background} {...args} background={background}>
          {background}
        </Box>
      ))}
    </div>
  ),
};

export const WithMargin: Story = {
  args: { margin: 6, background: 'bg-soft' },
  render: (args) => (
    <div className="bg-bg-muted">
      <Box {...args}>Obsah s marginem</Box>
    </div>
  ),
};

/**
 * `position="relative"` on the parent, `placement` on each overlay — the
 * shape `spot-tile.tsx` needs for its waitlist badge and admin menu button.
 */
export const Placements: Story = {
  render: () => (
    <Box position="relative" background="bg-soft" radius="md" className="h-40 w-64">
      {PLACEMENTS.map((placement) => (
        <Box key={placement} placement={placement} background="bg" border radius="sm" padding={2}>
          {placement}
        </Box>
      ))}
    </Box>
  ),
};

/** `interactive="none"` — an overlay that must not block clicks to what is beneath it. */
export const NonInteractiveOverlay: Story = {
  render: () => (
    <Box position="relative" background="bg-soft" radius="md" className="h-24 w-64">
      <Box
        placement="bottom-center"
        interactive="none"
        background="bg"
        border
        radius="sm"
        padding={2}
      >
        pointer-events-none
      </Box>
    </Box>
  ),
};

/**
 * `as` renders a semantic landmark instead of a plain `<div>` — `top-bar.tsx`
 * needs a `<header>`, `lot-grid.tsx`'s group band a `<section>`.
 */
export const AsHeader: Story = {
  args: { as: 'header', background: 'bg-soft', border: true },
  render: (args) => <Box {...args}>Obsah v &lt;header&gt;</Box>,
};

/** `radius="cta"` — the fully-rounded pill radius, e.g. the date-navigation pill wrapper. */
export const PillRadius: Story = {
  args: { radius: 'cta', border: true, background: 'bg' },
  render: (args) => <Box {...args}>Pilulka</Box>,
};

/**
 * `position="sticky"` + `inset="top"` + `layer="sticky"` + `height="bar"` —
 * the app shell's header, sticking to the viewport top above scrolling
 * content on the shared stacking order's `sticky` layer.
 */
export const StickyBar: Story = {
  render: () => (
    <div className="h-40 overflow-y-auto">
      <Box
        as="header"
        position="sticky"
        inset="top"
        layer="sticky"
        height="bar"
        background="bg"
        border
        padding={4}
      >
        Sticky header
      </Box>
      <Box padding={4}>Rolovatelný obsah pod headerem…</Box>
    </div>
  ),
};

/** `minHeight="viewport"` — a full-viewport centring wrapper, e.g. the login screen. */
export const ViewportMinHeight: Story = {
  render: () => (
    <Box minHeight="viewport" background="bg-muted" className="flex items-center justify-center">
      <Box background="bg" border radius="md" padding={6}>
        Vystředěný obsah
      </Box>
    </Box>
  ),
};

/**
 * `border="bottom"`/`"top"` — a single-sided rule, e.g. the app shell's
 * header (`top-bar.tsx`), which wants a bottom rule only, not the full box.
 */
export const BorderSide: Story = {
  render: () => (
    <div className="flex gap-4">
      <Box background="bg" border="bottom" padding={4}>
        border-b
      </Box>
      <Box background="bg" border="top" padding={4}>
        border-t
      </Box>
    </div>
  ),
};

/** The elevation ramp — `shadow="sm"`/`"md"`/`"lg"`. */
export const Shadows: Story = {
  render: () => (
    <div className="flex gap-6">
      <Box shadow="sm" background="bg" radius="md" padding={4}>
        sm
      </Box>
      <Box shadow="md" background="bg" radius="md" padding={4}>
        md
      </Box>
      <Box shadow="lg" background="bg" radius="md" padding={4}>
        lg
      </Box>
    </div>
  ),
};
