import { html, render } from 'lit';
import type { ColumnConfiguration } from '../../src/index.js';
import { generateUsers, PRIORITY_CHOICES, type User } from '../shared.js';

const columns: ColumnConfiguration<User>[] = [
  {
    key: 'id',
    headerText: 'User ID',
    resizable: true,
    type: 'number',
    filter: true,
    sort: true,
    width: '120px',
    pinned: 'start',
  },
  {
    key: 'name',
    editable: true,
    filter: true,
    sort: true,
    width: '200px',
    pinned: 'start',
  },
  {
    key: 'avatar',
    type: 'image',
    shape: 'circle',
    alt: 'User avatar',
  },
  {
    key: 'satisfaction',
    type: 'rating',
    max: 5,
    sort: true,
    filter: true,
    editable: true,
  },
  {
    key: 'priority',
    type: 'select',
    editable: true,
    options: PRIORITY_CHOICES.map((choice) => ({
      value: choice,
      label: choice.charAt(0).toUpperCase() + choice.slice(1),
    })),
    sort: {
      comparer: (a, b) => PRIORITY_CHOICES.indexOf(a) - PRIORITY_CHOICES.indexOf(b),
    },
  },
  {
    key: 'age',
    type: 'number',
    editable: true,
  },
  {
    key: 'email',
    editable: true,
  },
  {
    key: 'subscribed',
    type: 'boolean',
    editable: true,
    sort: true,
    filter: true,
    width: '140px',
  },
];

// Memoize so navigation back to this page reuses the same dataset (and any
// edits/selections persist across switches within a session).
let cachedData: User[] | null = null;
function getData(): User[] {
  if (!cachedData) cachedData = generateUsers(1e4);
  return cachedData;
}

export function mount(container: HTMLElement): void {
  render(
    html`<apex-grid
      show-quick-filter
      show-export
      column-reordering
      .data=${getData()}
      .columns=${columns}
      .pagination=${{ enabled: true, pageSize: 25, pageSizeOptions: [10, 25, 50, 100, 250] }}
      .editing=${{ enabled: true, mode: 'cell', trigger: 'doubleClick' }}
      .selection=${{ enabled: true, mode: 'multiple', showCheckboxColumn: true }}
      .expansion=${{
        enabled: true,
        detailTemplate: ({ data }: { data: User }) => html`
          <div style="display: flex; gap: 24px; align-items: center; padding: 4px 0;">
            <img
              src=${data.avatar}
              alt=""
              style="inline-size: 56px; block-size: 56px; border-radius: 50%; object-fit: cover;"
            />
            <div>
              <h4 style="margin: 0 0 4px 0;">${data.name}</h4>
              <div style="opacity: 0.75; font-size: 13px;">
                ${data.email} &middot; age ${data.age} &middot; satisfaction
                ${data.satisfaction}/5
              </div>
            </div>
          </div>
        `,
      }}
    ></apex-grid>`,
    container
  );
}
