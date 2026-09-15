import type { Meta, StoryObj } from '@storybook/react-vite';

import { Link, type LinkSize, type LinkWeight } from './link';

const SIZES: LinkSize[] = ['sm', 'base'];
const WEIGHTS: LinkWeight[] = ['normal', 'bold'];

const meta: Meta<typeof Link> = {
  title: 'Primitives/Link',
  component: Link,
  args: { children: 'Zpět na parkoviště', href: '#' },
};

export default meta;
type Story = StoryObj<typeof Link>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      {SIZES.map((size) => (
        <Link key={size} {...args} size={size}>
          {size}
        </Link>
      ))}
    </div>
  ),
};

export const Weights: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      {WEIGHTS.map((weight) => (
        <Link key={weight} {...args} weight={weight}>
          {weight}
        </Link>
      ))}
    </div>
  ),
};

/** Hover and focus are pseudo-states — point at the link and press Tab. */
export const HoverAndFocus: Story = {};

/**
 * `tone="plain"` — for a caller wrapping non-text content (the top bar's
 * logo lockup) that still needs the focus ring but not the underline/brand-
 * blue/bold treatment. Point at the box and press Tab to see the ring.
 */
export const PlainTone: Story = {
  args: { tone: 'plain' },
  render: (args) => (
    <Link {...args} href="#" aria-label="Domů">
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-xs bg-brand-blue text-fg-on-blue"
      >
        P
      </span>
    </Link>
  ),
};
