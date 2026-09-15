import type { Meta, StoryObj } from '@storybook/react-vite';

import { Spinner } from './spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Primitives/Spinner',
  component: Spinner,
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 'sm' },
};

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex items-center gap-3" role="status">
      <Spinner {...args} />
      <span className="text-sm">Načítá se…</span>
    </div>
  ),
};
