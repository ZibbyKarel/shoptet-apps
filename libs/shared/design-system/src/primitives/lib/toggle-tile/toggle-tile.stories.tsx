import type { Meta, StoryObj } from '@storybook/react-vite';

import { ToggleTile, type ToggleTileShape } from './toggle-tile';

const SHAPES: ToggleTileShape[] = ['cell', 'pill'];

const meta: Meta<typeof ToggleTile> = {
  title: 'Primitives/ToggleTile',
  component: ToggleTile,
  args: { children: '12', shape: 'cell', selected: false, selectable: true },
  argTypes: {
    shape: { control: 'inline-radio', options: SHAPES },
  },
};

export default meta;
type Story = StoryObj<typeof ToggleTile>;

export const Default: Story = {};

/** A single calendar day cell in each of its three states. */
export const CellStates: Story = {
  render: () => (
    <div className="flex gap-2" style={{ width: 240 }}>
      <ToggleTile shape="cell">12</ToggleTile>
      <ToggleTile shape="cell" selected>
        13
      </ToggleTile>
      <ToggleTile shape="cell" selectable={false}>
        14
      </ToggleTile>
    </div>
  ),
};

/** A segmented-control option, as `LockModeChoice` renders each pill. */
export const PillStates: Story = {
  render: () => (
    <div className="flex gap-3">
      <ToggleTile shape="pill">Automaticky</ToggleTile>
      <ToggleTile shape="pill" selected>
        Ruční
      </ToggleTile>
      <ToggleTile shape="pill" disabled>
        Zamčeno
      </ToggleTile>
    </div>
  ),
};

/** A full week row, the way `BulkModal`'s calendar renders one. */
export const CalendarWeek: Story = {
  render: () => (
    <table>
      <tbody>
        <tr>
          {[9, 10, 11, 12, 13, 14, 15].map((day) => (
            <td key={day}>
              <ToggleTile shape="cell" selected={day === 12} selectable={day !== 10}>
                {day}
              </ToggleTile>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  ),
};
