import { html, render } from 'lit';
import type { ColumnConfiguration } from '../../src/index.js';
import { generateUsers, PRIORITY_CHOICES, type User } from '../shared.js';

const columns: ColumnConfiguration<User>[] = [
  {
    key: 'id',
    headerText: 'ID',
    resizable: true,
    type: 'number',
    filter: true,
    sort: true,
    width: '80px',
    pinned: 'start',
  },
  {
    key: 'name',
    headerText: 'Customer',
    editable: true,
    filter: true,
    sort: true,
    width: '190px',
    pinned: 'start',
  },
  {
    key: 'owner',
    headerText: 'Owner',
    type: 'avatar',
    width: '80px',
  },
  {
    key: 'plan',
    headerText: 'Plan',
    type: 'badge',
    width: '130px',
    sort: true,
    filter: true,
    badgeVariant: (plan) => (plan === 'Enterprise' ? 'gold' : plan === 'Pro' ? 'brand' : 'muted'),
  },
  {
    key: 'status',
    headerText: 'Status',
    type: 'status',
    width: '120px',
    sort: true,
    filter: true,
  },
  {
    key: 'mrr',
    headerText: 'MRR',
    type: 'currency',
    currency: 'USD',
    editable: true,
    sort: true,
    filter: true,
    width: '120px',
  },
  {
    key: 'health',
    headerText: 'Health',
    type: 'progress',
    max: 100,
    sort: true,
    width: '150px',
  },
  {
    key: 'trend',
    headerText: 'Trend (8w)',
    type: 'sparkline',
    width: '130px',
  },
  {
    key: 'satisfaction',
    headerText: 'CSAT',
    type: 'rating',
    max: 5,
    sort: true,
    filter: true,
    editable: true,
  },
  {
    key: 'priority',
    headerText: 'Priority',
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
    key: 'subscribed',
    headerText: 'Auto-renew',
    type: 'boolean',
    editable: true,
    sort: true,
    filter: true,
    width: '120px',
  },
  {
    key: 'email',
    headerText: 'Contact',
    editable: true,
    width: '180px',
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
                ${data.plan} &middot; ${data.status} &middot; owner ${data.owner} &middot;
                ${data.email}
              </div>
            </div>
          </div>
        `,
      }}
    ></apex-grid>`,
    container
  );
}
