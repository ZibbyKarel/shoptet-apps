import type { Meta, StoryObj } from '@storybook/react-vite';

import { Text, type TextTone } from './text';

const INVERSE_TONES: TextTone[] = [
  'inverse',
  'inverse-90',
  'inverse-80',
  'inverse-70',
  'inverse-60',
  'inverse-50',
];

const meta: Meta<typeof Text> = {
  title: 'Primitives/Text',
  component: Text,
  args: { children: 'Rezervace na tento měsíc jsou otevřené.' },
};

export default meta;
type Story = StoryObj<typeof Text>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Text size="3xl">3xl — Nadpis stránky</Text>
      <Text size="2xl">2xl — Nadpis sekce</Text>
      <Text size="xl">xl — Podnadpis</Text>
      <Text size="lg">lg — Zvýrazněný text</Text>
      <Text size="md">md — Popisek pole</Text>
      <Text size="base">base — Běžný text</Text>
      <Text size="sm">sm — Vedlejší text</Text>
      <Text size="xs">xs — Drobný text</Text>
    </div>
  ),
};

export const Weights: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Text weight="normal">Normal — běžné parkovací místo</Text>
      <Text weight="medium">Medium — vyhrazené místo</Text>
      <Text weight="bold">Bold — obsazené místo</Text>
    </div>
  ),
};

/** Tones drawn on the default light surface — everything except the `inverse-*` family. */
export const TonesOnLight: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Text tone="default">default — Karel Zíbar</Text>
      <Text tone="muted">muted — poslední rezervace před 3 dny</Text>
      <Text tone="subtle">subtle — nepovinné pole</Text>
      <Text tone="faint">faint — SO/NE sloupce v hromadné úpravě</Text>
    </div>
  ),
};

/** `on-*` tones are meant for their matching tinted surface, shown here for reference. */
export const TonesOnTintedSurfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="rounded-md bg-brand-yellow-100 p-3">
        <Text tone="on-yellow">on-yellow — Čeká na potvrzení</Text>
      </div>
      <div className="rounded-md bg-brand-green-100 p-3">
        <Text tone="on-green">on-green — Otevřeno</Text>
      </div>
      <div className="rounded-md bg-brand-blue-100 p-3">
        <Text tone="on-blue">on-blue — Vaše rezervace</Text>
      </div>
    </div>
  ),
};

/** The `inverse-*` family sits on the dark asphalt surface of the parking map, never on `--bg`. */
export const TonesOnDarkSurface: Story = {
  render: () => (
    <div className="flex flex-col gap-2 rounded-md bg-neutral-950 p-4">
      {INVERSE_TONES.map((tone) => (
        <Text key={tone} tone={tone}>
          {tone} — místo A12
        </Text>
      ))}
    </div>
  ),
};

export const AsHeadingStack: Story = {
  render: () => (
    <div>
      <Text as="h1" size="3xl" weight="bold">
        Přehled parkoviště
      </Text>
      <Text as="h2" size="xl" weight="bold">
        Dnešní obsazenost
      </Text>
      <Text as="p" size="base">
        Text drawn as headings still resets its own margin — vertical rhythm here comes from the
        parent Stack, not from the browser default.
      </Text>
    </div>
  ),
};

/** `as="th"`/`as="td"` — the calendar column heads in `bulk-modal.tsx`/`date-picker-dialog.tsx`. */
export const AsTableCells: Story = {
  render: () => (
    <table>
      <thead>
        <tr>
          <Text as="th" scope="col" size="xs" weight="bold" tracking="caps" transform="uppercase">
            Po
          </Text>
          <Text as="th" scope="col" size="xs" weight="bold" tracking="caps" transform="uppercase">
            Út
          </Text>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Text as="td">1</Text>
          <Text as="td">2</Text>
        </tr>
      </tbody>
    </table>
  ),
};

export const TruncatedInAConstrainedBox: Story = {
  render: () => (
    <div className="w-40 rounded-md border border-border p-2">
      <Text truncate>Velmi dlouhý název parkovacího místa, který se nevejde na jeden řádek</Text>
    </div>
  ),
};
