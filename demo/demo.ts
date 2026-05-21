import {
  configureTheme,
  defineComponents,
  IgcButtonComponent,
  IgcInputComponent,
  IgcSelectComponent,
  IgcSwitchComponent,
} from 'igniteui-webcomponents';
import { html, render } from 'lit';
import { ColumnConfiguration } from '../src/index';
import { ApexGrid } from '../src/index.js';

defineComponents(IgcButtonComponent, IgcInputComponent, IgcSelectComponent, IgcSwitchComponent);

type User = {
  id: number;
  name: string;
  age: number;
  subscribed: boolean;
  satisfaction: number;
  priority: string;
  email: string;
  avatar: string;
};

const choices = ['low', 'standard', 'high'];
const themes = ['bootstrap', 'material', 'fluent', 'indigo'];

function getElement<T>(qs: string): T {
  return document.querySelector(qs) as T;
}

function generateData(length: number): User[] {
  return Array.from(
    { length },
    (_, idx) =>
      ({
        id: idx,
        name: `User - ${getRandomInt(length)}`,
        age: getRandomInt(100),
        subscribed: Boolean(getRandomInt(2)),
        satisfaction: getRandomInt(5),
        priority: oneOf(choices),
        email: `user${idx}@org.com`,
        avatar: getAvatar(),
      }) as User,
  );
}

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function oneOf<T>(collection: T[]) {
  return collection.at(getRandomInt(collection.length));
}

function getAvatar() {
  const [type, idx] = [getRandomInt(2) % 2 ? 'women' : 'men', getRandomInt(100)];
  return `https://static.infragistics.com/xplatform/images/people/${type}/${idx}.jpg`;
}

async function setTheme(theme?: string) {
  theme = theme ?? (getElement<IgcSelectComponent>(IgcSelectComponent.tagName).value);
  const variant = getElement<IgcSwitchComponent>(IgcSwitchComponent.tagName).checked
    ? 'dark'
    : 'light';

  await import(
    /* @vite-ignore */
    `/node_modules/igniteui-webcomponents/themes/${variant}/${theme}.css?${Date.now()}`
  );

  Array.from(document.head.querySelectorAll('style[type="text/css"]'))
    .slice(0, -1)
    .forEach(s => s.remove());

  configureTheme(theme as any);
}

function getGrid() {
  return document.querySelector<ApexGrid<User>>('apex-grid')!;
}

const themeChoose = html`
  <div class="sample-drop-down">
    <igc-select
      value="bootstrap"
      outlined
      label="Choose theme"
      @igcChange=${({ detail }) => setTheme(detail.value)}
    >
      ${themes.map(theme => html`<igc-select-item .value=${theme}>${theme}</igc-select-item>`)}
    </igc-select>
    <igc-switch
      label-position="after"
      @igcChange=${() => setTheme()}
      >Dark variant</igc-switch
    >
    <igc-button variant="outlined" @click=${() => getGrid().exportToCSV({ filename: 'users' })}>
      Export CSV
    </igc-button>
    <igc-button variant="outlined" @click=${() => getGrid().exportToXLSX({ filename: 'users', sheetName: 'Users' })}>
      Export XLSX
    </igc-button>
  </div>
`;

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
    options: choices.map(choice => ({
      value: choice,
      label: choice.charAt(0).toUpperCase() + choice.slice(1),
    })),
    sort: {
      comparer: (a, b) => choices.indexOf(a) - choices.indexOf(b),
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

const data = generateData(1e4);
ApexGrid.register();

render(
  html`${themeChoose}<apex-grid
      show-quick-filter
      column-reordering
      .data=${data}
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
                ${data.email} &middot; age ${data.age} &middot; satisfaction ${data.satisfaction}/5
              </div>
            </div>
          </div>
        `,
      }}
    ></apex-grid>`,
  document.getElementById('demo')!,
);
await setTheme('bootstrap');
