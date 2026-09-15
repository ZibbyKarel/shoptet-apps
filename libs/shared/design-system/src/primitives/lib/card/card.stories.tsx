import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';

const meta: Meta<typeof Card> = {
  title: 'Primitives/Card',
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

/** Default: `p-6`, replacing `rounded-lg border border-border bg-bg p-6` (`admin-window-screen.tsx:109`). */
export const Default: Story = {
  render: (args) => (
    <Card {...args}>
      <p className="text-sm">Obsah panelu</p>
    </Card>
  ),
};

/** `padding={0}`: a panel whose content manages its own inner spacing, matching the `flex flex-col rounded-lg border border-border bg-bg` panel (no `p-*`) at `admin-window-screen.tsx:152`. */
export const NoPadding: Story = {
  args: { padding: 0 },
  render: (args) => (
    <Card {...args}>
      <div className="border-b border-divider px-6 py-5">
        <p className="text-sm font-bold">Hlavička</p>
      </div>
      <div className="px-6 py-5">
        <p className="text-sm">Řádek obsahu</p>
      </div>
    </Card>
  ),
};

/** `fillHeight`: two cards side by side in a `Grid`, ending level despite unequal content — `admin-window-screen.tsx`. */
export const FillHeight: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6">
      <Card fillHeight>
        <p className="text-sm">Krátký obsah.</p>
      </Card>
      <Card fillHeight>
        <p className="text-sm">
          Delší obsah, který zabírá víc řádků — obě karty by měly končit ve stejné výšce.
        </p>
      </Card>
    </div>
  ),
};
