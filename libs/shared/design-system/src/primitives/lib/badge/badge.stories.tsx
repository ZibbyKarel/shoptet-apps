import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, type BadgeTone } from './badge';

const TONES: BadgeTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { children: 'Otevřeno', tone: 'success' },
  argTypes: { tone: { control: 'inline-radio', options: TONES } },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {TONES.map((tone) => (
        <Badge key={tone} {...args} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};

/** Long labels never wrap — the pill grows instead. */
export const LongLabel: Story = {
  args: { children: 'Čeká na potvrzení správcem', tone: 'warning' },
};

/** The smaller "tag" shape — the GUEST label next to a holder's name. */
export const Tag: Story = {
  args: { children: 'Host', tone: 'tag', size: 'sm' },
};

/** `transform="uppercase"` on an ordinary `md` badge, as `top-bar.tsx` needs it. */
export const UppercaseTransform: Story = {
  args: { children: 'Admin', tone: 'info', transform: 'uppercase' },
};
