import { Badge, Button, Input, Switch } from '@garage/design-system/primitives';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { DataTable, type DataTableColumn, type DataTableSort } from './data-table';

/**
 * Sample rows. Deliberately generic — the design system is domain-free, so no
 * story here may lean on a parking spot, a reservation or a user, even though
 * the screens this component was drawn for are exactly those tables.
 */
interface Item {
  id: string;
  label: string;
  category: string;
  count: number;
  active: boolean;
}

const ITEMS: Item[] = [
  { id: '1', label: 'A1.10', category: 'První', count: 12, active: true },
  { id: '2', label: 'A1.11', category: 'Druhá', count: 4, active: true },
  { id: '3', label: 'B2.01', category: 'První', count: 30, active: false },
  { id: '4', label: 'B2.02', category: 'Třetí', count: 7, active: true },
  { id: '5', label: 'C3.14', category: 'Druhá', count: 21, active: false },
];

const COLUMNS: DataTableColumn<Item>[] = [
  {
    id: 'label',
    header: 'Štítek',
    cell: (row) => <span className="font-bold tracking-wide">{row.label}</span>,
    sortValue: (row) => row.label,
  },
  {
    id: 'category',
    header: 'Kategorie',
    cell: (row) => <Badge>{row.category}</Badge>,
    sortValue: (row) => row.category,
  },
  {
    id: 'count',
    header: 'Počet',
    cell: (row) => row.count,
    sortValue: (row) => row.count,
    align: 'end',
    width: '120px',
  },
];

const meta: Meta<typeof DataTable<Item>> = {
  title: 'Compounds/DataTable',
  component: DataTable,
  args: {
    title: 'Položky',
    description: 'Štítek, kategorie a počet',
    columns: COLUMNS,
    data: ITEMS,
    getRowId: (row: Item) => row.id,
    minWidth: '560px',
    // The empty state's copy is the caller's — the compound has no catalogue
    // to fall back on. Every story inherits this one unless it says otherwise.
    emptyTitle: 'Žádná data',
  },
  parameters: {
    backgrounds: { value: 'page' },
  },
};

export default meta;
type Story = StoryObj<typeof DataTable<Item>>;

/**
 * The table owns its own sort state. Press a header: the first press orders
 * ascending, the second flips it, and there is no third "unsorted" press — the
 * design draws an arrow on exactly one column at all times.
 */
export const Default: Story = {};

/** Sorted from the start, the way an admin screen would open. */
export const PreSorted: Story = {
  args: {
    defaultSort: { columnId: 'label', direction: 'asc' },
  },
};

/**
 * A column with no `sortValue` cannot be sorted: its header is plain text
 * rather than a button, and it carries no `aria-sort`. Here only `Štítek` is
 * sortable, matching `doc/design/screens/04-admin-spots.png`.
 */
export const PartiallySortable: Story = {
  args: {
    columns: [
      COLUMNS[0] as DataTableColumn<Item>,
      { id: 'category', header: 'Kategorie', cell: (row: Item) => row.category },
      { id: 'count', header: 'Počet', cell: (row: Item) => row.count, align: 'end' },
    ],
  },
};

/** The header band's right-hand slot: a search field, per `03-admin-users.png`. */
export const WithSearchAction: Story = {
  args: {
    actions: <Input placeholder="Hledat štítek" fullWidth={false} className="w-70" />,
  },
};

/**
 * The header band's other shape — a primary button — plus the filter band
 * underneath, per `04-admin-spots.png`.
 */
export const WithToolbar: Story = {
  args: {
    actions: <Button>Přidat položku</Button>,
    toolbar: (
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-bold uppercase tracking-caps text-neutral-600">
          Kategorie
        </span>
        <Badge>První</Badge>
        <Badge>Druhá</Badge>
        <Badge>Třetí</Badge>
      </div>
    ),
  },
};

/** Interactive cells are just cell content — the table has no opinion on them. */
export const WithControlsInCells: Story = {
  args: {
    columns: [
      COLUMNS[0] as DataTableColumn<Item>,
      COLUMNS[1] as DataTableColumn<Item>,
      {
        id: 'active',
        header: 'Aktivní',
        align: 'end',
        width: '120px',
        cell: (row: Item) => (
          <Switch defaultChecked={row.active} tone="success" aria-label={`Aktivní ${row.label}`} />
        ),
      },
    ],
  },
};

/** No rows: the column headers stay, so the shape of the table is still readable. */
export const Empty: Story = {
  args: {
    data: [],
  },
};

/** The empty state carries the caller's own copy and an optional way forward. */
export const EmptyWithAction: Story = {
  args: {
    data: [],
    emptyTitle: 'Zatím žádné položky',
    emptyDescription: 'Přidejte první položku a objeví se v tomto seznamu.',
    emptyAction: <Button>Přidat položku</Button>,
  },
};

/**
 * Sorting owned by the caller. The table reports what a press asks for and
 * renders nothing until `sort` actually moves — here the parent applies it, but
 * a screen fetching a sorted page from the server would not.
 */
export const ControlledSort: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a story render function is a component.
    const [sort, setSort] = useState<DataTableSort | null>({
      columnId: 'count',
      direction: 'desc',
    });

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-3">
          Řazení drží rodič:{' '}
          <code>{sort === null ? 'žádné' : `${sort.columnId} / ${sort.direction}`}</code>
        </p>
        <DataTable {...args} sort={sort} onSortChange={setSort} />
      </div>
    );
  },
};
