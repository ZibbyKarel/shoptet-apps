import { Button } from '@garage/design-system/primitives';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Compounds/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    title: 'Opravdu smazat položku?',
    description: 'Tuto akci nelze vrátit zpět.',
    tone: 'default',
    // Both labels are the caller's copy — the compound has no catalogue to
    // fall back on. Stories that mean something else override `confirmLabel`.
    confirmLabel: 'Potvrdit',
    cancelLabel: 'Zrušit',
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['default', 'danger'] },
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

/**
 * Every story opens the dialog from a real trigger rather than rendering it
 * already open: focus returning to the button that opened it is behaviour worth
 * seeing, and it needs something to return *to*.
 */
function Demo({ ...args }: Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel'>) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-4">
      <Button
        variant={args.tone === 'danger' ? 'danger' : 'primary'}
        onClick={() => {
          setOutcome(null);
          setOpen(true);
        }}
      >
        Smazat položku
      </Button>
      <p className="max-w-96 text-sm text-fg-3">
        Escape, klik na pozadí i křížek znamenají totéž co „Zrušit“. Focus začíná na křížku, ne na
        potvrzovacím tlačítku.
      </p>
      {outcome !== null && <p className="text-sm font-bold text-fg">{outcome}</p>}
      <ConfirmDialog
        {...args}
        open={open}
        onConfirm={() => {
          setOutcome('Potvrzeno');
          setOpen(false);
        }}
        onCancel={() => {
          setOutcome('Zrušeno');
          setOpen(false);
        }}
      />
    </div>
  );
}

export const Default: Story = {
  render: (args) => <Demo {...args} />,
};

/** The design's "Smazat" weight, for a step that cannot be undone. */
export const Danger: Story = {
  args: {
    tone: 'danger',
    confirmLabel: 'Smazat',
  },
  render: (args) => <Demo {...args} />,
};

/** Title only — a question that needs no elaboration. */
export const WithoutDescription: Story = {
  args: {
    title: 'Zahodit rozpracované změny?',
    description: undefined,
    confirmLabel: 'Zahodit',
  },
  render: (args) => <Demo {...args} />,
};

/**
 * The confirmed action is in flight. Every way out is blocked, Escape and the
 * scrim included — cancelling a request that has already left is a promise this
 * component cannot keep. Rendered open, because the state only exists mid-flight.
 */
export const Loading: Story = {
  args: {
    tone: 'danger',
    confirmLabel: 'Smazat',
    loading: true,
  },
  render: (args) => (
    <ConfirmDialog {...args} open onConfirm={() => undefined} onCancel={() => undefined} />
  ),
};
