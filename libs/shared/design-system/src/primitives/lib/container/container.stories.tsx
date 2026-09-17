import type { Meta, StoryObj } from '@storybook/react-vite';

import { Container } from './container';

const meta: Meta<typeof Container> = {
  title: 'Primitives/Container',
  component: Container,
};

export default meta;
type Story = StoryObj<typeof Container>;

/** Default: `base` max-width, `py-8 px-4` — matches `app/(app)/layout.tsx`, 1 of the 4 `apps/garage/web` call sites this replaces. */
export const Default: Story = {
  render: (args) => (
    <div className="w-full bg-bg-muted">
      <Container {...args}>
        <div className="rounded-md border border-border bg-bg p-4 text-sm">Obsah</div>
      </Container>
    </div>
  ),
};

export const Wide: Story = {
  args: { maxWidth: 'wide' },
  render: (args) => (
    <div className="w-full bg-bg-muted">
      <Container {...args}>
        <div className="rounded-md border border-border bg-bg p-4 text-sm">Obsah</div>
      </Container>
    </div>
  ),
};

/** `padding={[16, 4]}` — the other 3 call sites (`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`), which use `py-16` instead of the default `py-8`. */
export const CustomPadding: Story = {
  args: { padding: [16, 4] },
  render: (args) => (
    <div className="w-full bg-bg-muted">
      <Container {...args}>
        <div className="rounded-md border border-border bg-bg p-4 text-sm">Obsah</div>
      </Container>
    </div>
  ),
};
