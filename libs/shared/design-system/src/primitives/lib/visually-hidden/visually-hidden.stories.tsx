import type { Meta, StoryObj } from '@storybook/react-vite';

import { VisuallyHidden } from './visually-hidden';

const meta: Meta<typeof VisuallyHidden> = {
  title: 'Primitives/VisuallyHidden',
  component: VisuallyHidden,
  args: { children: 'Akce' },
};

export default meta;
type Story = StoryObj<typeof VisuallyHidden>;

export const Default: Story = {};

/**
 * The canvas cannot show "nothing" meaningfully, so this story renders the
 * hidden text on a visible tinted panel next to a note — in a real screen it
 * would be present in the DOM and absent from the rendered page, exactly
 * like the "Akce" column header in `admin-spots-screen.tsx`.
 */
export const InContext: Story = {
  render: (args) => (
    <div className="flex items-center gap-2 rounded-md border border-border p-3">
      <span aria-hidden="true" className="text-fg-3">
        (prázdný sloupec na obrazovce)
      </span>
      <VisuallyHidden {...args} />
    </div>
  ),
};

export const AsHeading: Story = {
  args: { as: 'h1', children: 'Přehled parkoviště' },
};
