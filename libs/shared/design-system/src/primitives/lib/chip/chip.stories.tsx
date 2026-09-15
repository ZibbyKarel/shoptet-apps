import type { Meta, StoryObj } from '@storybook/react-vite';

import { Chip, type ChipDot, type ChipSize, type ChipTone } from './chip';

const SIZES: ChipSize[] = ['sm', 'md', 'lg'];
const TONES: ChipTone[] = ['outline', 'muted'];
const DOTS: ChipDot[] = ['none', 'green', 'blue'];

const meta: Meta<typeof Chip> = {
  title: 'Primitives/Chip',
  component: Chip,
  args: { children: 'Volno', size: 'md', tone: 'outline', weight: 'normal', dot: 'none' },
  argTypes: {
    size: { control: 'inline-radio', options: SIZES },
    tone: { control: 'inline-radio', options: TONES },
    weight: { control: 'inline-radio', options: ['normal', 'medium'] },
    dot: { control: 'inline-radio', options: DOTS },
    as: { control: 'inline-radio', options: ['span', 'div', 'p'] },
  },
};

export default meta;
type Story = StoryObj<typeof Chip>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {SIZES.map((size) => (
        <Chip key={size} {...args} size={size}>
          {size}
        </Chip>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {TONES.map((tone) => (
        <Chip key={tone} {...args} tone={tone}>
          {tone}
        </Chip>
      ))}
    </div>
  ),
};

/** The admin day-view legend — an outline chip with a leading status dot. */
export const WithDot: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Chip size="lg" dot="green">
        Volná místa
      </Chip>
      <Chip size="lg" dot="blue">
        Rezervováno
      </Chip>
    </div>
  ),
};

/** The admin spots screen's category band — a muted chip with a trailing count as a plain child. */
export const MutedWithCount: Story = {
  args: { tone: 'muted', weight: 'medium', size: 'sm' },
  render: (args) => (
    <Chip {...args}>
      Přízemí <span className="text-fg-2">(12)</span>
    </Chip>
  ),
};
