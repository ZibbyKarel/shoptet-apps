import type { Meta, StoryObj } from '@storybook/react-vite';

import { IconCircle } from '../icon-circle/icon-circle';
import { Callout, type CalloutTone } from './callout';

const TONES: CalloutTone[] = ['warning', 'success'];

const meta: Meta<typeof Callout> = {
  title: 'Primitives/Callout',
  component: Callout,
  args: { tone: 'warning', children: 'Rezervace je pro tento měsíc uzamčená.' },
  argTypes: {
    tone: { control: 'inline-radio', options: TONES },
    align: { control: 'inline-radio', options: ['start', 'center'] },
  },
};

export default meta;
type Story = StoryObj<typeof Callout>;

export const Default: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {TONES.map((tone) => (
        <Callout key={tone} {...args} tone={tone}>
          {tone === 'success' ? 'Rezervace byla úspěšně vytvořena.' : args.children}
        </Callout>
      ))}
    </div>
  ),
};

/** `spot-dialog.tsx`'s lock note — icon aligned to the top of a two-line message. */
export const WithIconAlignStart: Story = {
  args: {
    icon: (
      <IconCircle tone="yellow" size="sm">
        ⊘
      </IconCircle>
    ),
    children: 'Rezervace na tento den je zamčená. Kontaktujte prosím správce parkoviště.',
  },
};

/** `lot-header.tsx`'s `WindowBanner` — icon centred against a single line. */
export const WithIconAlignCenter: Story = {
  args: {
    tone: 'success',
    align: 'center',
    icon: (
      <IconCircle tone="green" size="sm">
        ✓
      </IconCircle>
    ),
    children: 'Okno pro rezervace je otevřené.',
  },
};

/** No icon — children fill the panel, including a multi-part block of content. */
export const WithoutIcon: Story = {
  render: (args) => (
    <Callout {...args}>
      <p className="text-base font-bold text-fg">Termíny se změnily</p>
      <p className="mt-1 text-base leading-loose text-fg-2">
        Zkontrolujte prosím upravený rozvrh níže.
      </p>
    </Callout>
  ),
};
