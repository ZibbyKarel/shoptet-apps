import { Button } from '@garage/design-system/primitives';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EmptyState } from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Compounds/EmptyState',
  component: EmptyState,
  args: {
    title: 'Zatím tu nic není',
    size: 'md',
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    headingLevel: { control: 'inline-radio', options: [undefined, 2, 3, 4] },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

/** Title only — the smallest honest empty state. */
export const Default: Story = {};

export const WithDescription: Story = {
  args: {
    description: 'Až sem něco přibude, uvidíte to na tomto místě.',
  },
};

export const WithAction: Story = {
  args: {
    description: 'Můžete rovnou přidat první položku.',
    action: <Button>Přidat položku</Button>,
  },
};

/**
 * The decorative mark is `aria-hidden` — the title already says everything the
 * icon does, so announcing both would just repeat it.
 */
export const WithIcon: Story = {
  args: {
    description: 'Zkuste změnit filtr, nebo hledaný výraz.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 5 5" strokeLinecap="round" />
      </svg>
    ),
  },
};

/**
 * The compact step, for an empty state inside a card that already has its own
 * padding. This is what `DataTable` renders in place of its rows.
 */
export const Compact: Story = {
  args: {
    size: 'sm',
    title: 'Žádná data',
  },
};

/**
 * Side by side, so the two vertical steps are comparable. Neither passes
 * `headingLevel`, so both titles are paragraphs — only a page that knows its
 * own outline should promote one to a heading.
 */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {(['sm', 'md'] as const).map((size) => (
        <div key={size} className="rounded-lg border border-border bg-bg">
          <EmptyState {...args} size={size} title={`Velikost ${size}`} />
        </div>
      ))}
    </div>
  ),
};
