import { html, render } from 'lit';
import type { ColumnConfiguration } from '../../src/index.js';

type OrgRow = {
  name: string;
  role: string;
  department: string;
  path: string[];
};

const orgData: OrgRow[] = [
  { name: 'Adrian Conner', role: 'COO', department: 'Executive', path: ['Adrian Conner'] },
  {
    name: 'Cheryl Browning',
    role: 'CTO',
    department: 'Engineering',
    path: ['Cheryl Browning'],
  },
  {
    name: 'Bryan Hawkins',
    role: 'VP',
    department: 'Engineering',
    path: ['Cheryl Browning', 'Bryan Hawkins'],
  },
  {
    name: 'Chris Bruce',
    role: 'Engineer',
    department: 'Engineering',
    path: ['Cheryl Browning', 'Bryan Hawkins', 'Chris Bruce'],
  },
  {
    name: 'Gregory Walker',
    role: 'Engineer',
    department: 'Engineering',
    path: ['Cheryl Browning', 'Bryan Hawkins', 'Gregory Walker'],
  },
  {
    name: 'Deborah Morales',
    role: 'VP',
    department: 'Engineering',
    path: ['Cheryl Browning', 'Deborah Morales'],
  },
  {
    name: 'Amy Rojas',
    role: 'Engineer',
    department: 'Engineering',
    path: ['Cheryl Browning', 'Deborah Morales', 'Amy Rojas'],
  },
];

const orgColumns: ColumnConfiguration<OrgRow>[] = [
  { key: 'name', headerText: 'Name', width: '320px' },
  { key: 'role', headerText: 'Role', width: '160px' },
  { key: 'department', headerText: 'Department' },
];

export function mount(container: HTMLElement): void {
  render(
    html`<apex-grid
      .data=${orgData}
      .columns=${orgColumns}
      .tree=${{
        enabled: true,
        getDataPath: (row: OrgRow) => row.path,
        defaultExpanded: true,
      }}
    ></apex-grid>`,
    container
  );
}
