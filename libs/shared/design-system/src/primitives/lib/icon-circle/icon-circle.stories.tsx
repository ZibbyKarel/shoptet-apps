import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  IconCircle,
  type IconCircleShape,
  type IconCircleSize,
  type IconCircleTone,
} from './icon-circle';

const SIZES: IconCircleSize[] = ['xs', 'sm', 'md', 'lg'];
const SHAPES: IconCircleShape[] = ['square', 'circle'];
const TONES: IconCircleTone[] = ['yellow', 'green', 'blue', 'translucent', 'translucent-light'];

const meta: Meta<typeof IconCircle> = {
  title: 'Primitives/IconCircle',
  component: IconCircle,
  args: { children: '!', size: 'sm', shape: 'square', tone: 'yellow', fontSize: 'sm' },
  argTypes: {
    size: { control: 'inline-radio', options: SIZES },
    shape: { control: 'inline-radio', options: SHAPES },
    tone: { control: 'inline-radio', options: TONES },
    fontSize: { control: 'inline-radio', options: ['xs', 'sm', 'base', 'md', 'xl', '2xl'] },
    weight: { control: 'inline-radio', options: ['normal', 'bold'] },
  },
};

export default meta;
type Story = StoryObj<typeof IconCircle>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {SIZES.map((size) => (
        <IconCircle key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3 bg-neutral-900 p-4">
      {TONES.map((tone) => (
        <IconCircle key={tone} {...args} tone={tone} />
      ))}
    </div>
  ),
};

/** The lot header's status mark — a filled square glyph, bold. */
export const StatusBanner: Story = {
  args: { size: 'sm', shape: 'square', tone: 'green', fontSize: 'sm', weight: 'bold' },
  render: (args) => <IconCircle {...args}>✓</IconCircle>,
};

/** The product logo tile (`brand.tsx`'s `lg` lockup) — 48px, the size the design draws it at. */
export const ProductLogoTile: Story = {
  args: { size: 'lg', shape: 'square', tone: 'blue', fontSize: '2xl', weight: 'bold' },
  render: (args) => <IconCircle {...args}>P</IconCircle>,
};

/** The parking tile's overflow mark — a circle at the larger `md` size with `leading-none`, needed by the `+` glyph. */
export const TileOverflow: Story = {
  args: {
    size: 'md',
    shape: 'circle',
    tone: 'translucent',
    fontSize: 'xl',
    weight: 'bold',
    leading: 'none',
  },
  render: (args) => (
    <div className="bg-brand-blue p-4">
      <IconCircle {...args}>+</IconCircle>
    </div>
  ),
};
