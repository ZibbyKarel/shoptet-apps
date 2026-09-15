import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ControlSize } from '../control-size';
import { Input } from './input';

const SIZES: ControlSize[] = ['sm', 'md', 'lg', 'xl'];

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  args: { label: 'Jméno', placeholder: 'Zadej jméno', size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: SIZES } },
  decorators: [
    (Story) => (
      <div className="max-w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-5">
      {SIZES.map((size) => (
        <Input key={size} {...args} size={size} label={size} />
      ))}
    </div>
  ),
};

export const WithHint: Story = {
  args: { hint: 'Zobrazí se ostatním v přehledu.' },
};

/** The message is the error state — it also sets `aria-invalid`. */
export const Error: Story = {
  args: { error: 'Vyplň prosím jméno.', defaultValue: '' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Nelze upravit' },
};

/** Tab into the field: the border turns blue and the focus ring appears. */
export const Focus: Story = {
  args: { label: 'Klikni nebo zmáčkni Tab' },
};

/** `width="grow"` (`flex-1`) — a field filling the space between fixed-width siblings, as in `date-picker-dialog.tsx`'s calendar nav row. */
export const GrowingInARow: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <button type="button" className="shrink-0">
        ‹
      </button>
      <Input label="Měsíc" width="grow" />
      <button type="button" className="shrink-0">
        ›
      </button>
    </div>
  ),
};
