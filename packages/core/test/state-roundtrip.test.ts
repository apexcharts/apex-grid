import { elementUpdated, expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import { render } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import type { ColumnLayoutState, GridState, RowRef } from '../src/internal/state-snapshot.js';
import * as snapshot from '../src/internal/state-snapshot.js';
import type { ColumnConfiguration } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

// setState and the state setters apply against the view they restore, not the
// stale one, and never throw on malformed input. One file for the batch.

ApexGrid.register();

const columns = [
  { key: 'id', type: 'number' },
  { key: 'name' },
  { key: 'active', type: 'boolean' },
  { key: 'importance' },
] as ColumnConfiguration<TestData>[];

type Row = { id: number; name: string };
const forty: Row[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  name: i < 4 ? `zz${i}` : `row${i}`,
}));
const rowColumns = [{ key: 'id', type: 'number' }, { key: 'name' }] as ColumnConfiguration<Row>[];

async function settle(grid: ApexGrid<any>, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await elementUpdated(grid);
    await nextFrame();
  }
}

function tallParent() {
  const parent = document.createElement('div');
  parent.style.height = '800px';
  return parent;
}

async function mount(extra: Partial<ApexGrid<TestData>> = {}) {
  const grid = await fixture<ApexGrid<TestData>>(
    html`<apex-grid .data=${[...data]} .columns=${columns}></apex-grid>`,
    { parentNode: tallParent() }
  );
  Object.assign(grid, extra);
  await settle(grid);
  return grid;
}

const ids = (grid: ApexGrid<TestData>) => grid.dataView.map((row) => row.id);

describe('state round-trip', () => {
  afterEach(() => fixtureCleanup());

  describe('pagination restores against the restored view', () => {
    it('restores page 5 when the same setState clears a narrowing quick filter', async () => {
      const grid = await fixture<ApexGrid<Row>>(html`
        <apex-grid
          .data=${[...forty]}
          .columns=${rowColumns}
          .pagination=${{ enabled: true, pageSize: 4 }}
        ></apex-grid>
      `);
      grid.quickFilter = 'zz';
      await settle(grid);
      expect(grid.pageCount).to.equal(1);

      const result = grid.setState({ quickFilter: '', pagination: { page: 5, pageSize: 4 } });
      await settle(grid);

      expect(result.warnings).to.deep.equal([]);
      expect(grid.pageCount).to.equal(10);
      expect(grid.page).to.equal(5);
    });

    it('restores a persisted page when setState runs before the first render', async () => {
      const grid = document.createElement('apex-grid') as ApexGrid<Row>;
      grid.columns = rowColumns;
      grid.pagination = { enabled: true, pageSize: 4 };
      grid.data = [...forty];
      const result = grid.setState({ pagination: { page: 3, pageSize: 4 } });
      document.body.appendChild(grid);
      try {
        await settle(grid);
        expect(result.warnings).to.deep.equal([]);
        expect(grid.pageCount).to.equal(10);
        expect(grid.page).to.equal(3);
      } finally {
        grid.remove();
      }
    });

    it('round-trips a saved page after a narrowing filter (setState of getState)', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.page = 3;
      await settle(grid);
      expect(grid.page).to.equal(3);
      const saved = grid.getState();

      grid.filter({ key: 'name', condition: 'equals', searchTerm: 'a', caseSensitive: true });
      await settle(grid);
      expect(grid.pageCount).to.equal(1);

      const result = grid.setState(saved);
      await settle(grid);
      expect(result.warnings).to.deep.equal([]);
      expect(grid.pageCount).to.equal(4);
      expect(grid.page).to.equal(3);
    });

    it('still clamps a page past the end against the restored view', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 4 } });
      grid.setState({ quickFilter: '', pagination: { page: 99, pageSize: 4 } });
      await settle(grid);
      expect(grid.page).to.equal(1);
    });

    it('a page bound before the first render is kept, not clamped against no rows', async () => {
      const hundred = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `r${i}` }));
      const grid = await fixture<ApexGrid<Row>>(html`
        <apex-grid
          .data=${hundred}
          .columns=${rowColumns}
          .pagination=${{ enabled: true, pageSize: 10 }}
          .page=${3}
        ></apex-grid>
      `);
      await settle(grid);
      expect(grid.pageCount).to.equal(10);
      expect(grid.page).to.equal(3);
    });
    it('grid.page fires the page events while an unrelated update is pending', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      const events: string[] = [];
      grid.addEventListener('pageChanging', () => events.push('changing'));
      grid.addEventListener('pageChanged', () => events.push('changed'));
      grid.requestUpdate();
      grid.page = 2;
      await settle(grid);
      expect(grid.page).to.equal(2);
      expect(events).to.deep.equal(['changing', 'changed']);
    });

    it('a vetoed pageChanging keeps the page while an unrelated update is pending', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.addEventListener('pageChanging', (event) => event.preventDefault());
      grid.requestUpdate();
      grid.page = 2;
      await settle(grid);
      expect(grid.page).to.equal(0);
    });

    it('grid.page right after a data swap clamps against the new rows', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.data = data.slice(0, 5);
      grid.page = 5;
      await settle(grid);
      expect(grid.page).to.equal(2);
    });

    it('setState after a setState still clamps and warns (strict throws)', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.setState({ sort: [{ key: 'id', direction: 'descending' }] });
      const result = grid.setState({ pagination: { page: 99, pageSize: 2 } });
      expect(result.warnings).to.deep.equal(['pagination: page 99 out of range; clamped to 3']);
      grid.setState({ sort: [{ key: 'id', direction: 'ascending' }] });
      expect(() =>
        grid.setState({ pagination: { page: 99, pageSize: 2 } }, { strict: true })
      ).to.throw(/out of range/);
    });

    it('a filter() that drops every entry leaves grid.page firing the page events', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.filter({ key: 'nope', condition: 'contains', searchTerm: 'x' } as any);
      await settle(grid);
      const events: string[] = [];
      grid.addEventListener('pageChanging', (event) => {
        events.push('changing');
        event.preventDefault();
      });
      grid.page = 2;
      await settle(grid);
      expect(events).to.deep.equal(['changing']);
      expect(grid.page).to.equal(0);
    });

    it('filter([]) leaves setState able to report a clamp', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.filter([]);
      await settle(grid);
      const result = grid.setState({ pagination: { page: 99, pageSize: 2 } });
      expect(result.warnings).to.deep.equal(['pagination: page 99 out of range; clamped to 3']);
    });

    it('an equal pagination object reassigned before grid.page keeps the page events', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      const events: string[] = [];
      grid.addEventListener('pageChanging', () => events.push('changing'));
      grid.addEventListener('pageChanged', () => events.push('changed'));
      grid.pagination = { enabled: true, pageSize: 2 };
      grid.page = 3;
      await settle(grid);
      expect(grid.page).to.equal(3);
      expect(events).to.deep.equal(['changing', 'changed']);
    });

    it('an equal pagination object reassigned before a vetoed grid.page keeps the page', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      grid.addEventListener('pageChanging', (event) => event.preventDefault());
      grid.pagination = { ...grid.pagination };
      grid.page = 3;
      await settle(grid);
      expect(grid.page).to.equal(0);
    });

    it('a pagination object with a new page size still keeps grid.page for the reclamp', async () => {
      const grid = await mount({ pagination: { enabled: true, pageSize: 2 } });
      let changing = 0;
      grid.addEventListener('pageChanging', () => changing++);
      grid.pagination = { enabled: true, pageSize: 4 };
      grid.page = 5;
      await settle(grid);
      expect(changing).to.equal(0);
      expect(grid.page).to.equal(1);
    });
  });

  describe('sortExpressions and filterExpressions replace', () => {
    it('sortExpressions replaces the previous sort and [] clears it', async () => {
      const grid = await mount();
      grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
      await settle(grid);
      grid.sortExpressions = [{ key: 'name', direction: 'ascending' }];
      await settle(grid);
      expect(grid.sortExpressions.map((e) => e.key)).to.deep.equal(['name']);
      grid.sortExpressions = [];
      await settle(grid);
      expect(grid.sortExpressions).to.have.lengthOf(0);
    });

    it('filterExpressions replaces, self-assignment is a no-op, [] clears', async () => {
      const grid = await mount();
      grid.filterExpressions = [{ key: 'name', condition: 'contains', searchTerm: 'a' } as any];
      await settle(grid);
      grid.filterExpressions = [{ key: 'name', condition: 'contains', searchTerm: 'b' } as any];
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(1);
      expect(ids(grid)).to.deep.equal([2, 6]);

      const current = grid.filterExpressions;
      grid.filterExpressions = current;
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(1);

      grid.filterExpressions = [];
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(0);
      expect(grid.dataView).to.have.lengthOf(data.length);
    });

    it('assigning undefined or null clears instead of throwing', async () => {
      const grid = await mount();
      grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
      grid.filterExpressions = [{ key: 'name', condition: 'contains', searchTerm: 'a' } as any];
      await settle(grid);
      expect(() => {
        (grid as any).filterExpressions = undefined;
        (grid as any).sortExpressions = null;
      }).not.to.throw();
      await settle(grid);
      expect(grid.sortExpressions).to.have.lengthOf(0);
      expect(grid.filterExpressions).to.have.lengthOf(0);
    });

    it('a sort assigned before new columns in the same task is kept', async () => {
      const grid = await mount({ columns: columns.slice(0, 3) });
      grid.sortExpressions = [{ key: 'importance', direction: 'descending' }];
      grid.columns = columns;
      await settle(grid);
      expect(grid.sortExpressions.map((e) => e.key)).to.deep.equal(['importance']);
    });

    it('a filter assigned before new columns in the same task is kept', async () => {
      const grid = await mount({ columns: columns.slice(0, 3) });
      grid.filterExpressions = [
        { key: 'importance', condition: 'equals', searchTerm: 'low' } as any,
      ];
      grid.columns = columns;
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(1);
      expect(ids(grid)).to.deep.equal([2, 4, 7]);
    });

    it('a template binding the sort before new columns applies the new sort', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const view = (cols: ColumnConfiguration<TestData>[], sort: any[]) =>
        html`<apex-grid .data=${data} .sortExpressions=${sort} .columns=${cols}></apex-grid>`;
      try {
        render(view(columns.slice(0, 2), [{ key: 'id', direction: 'descending' }]), host);
        const grid = host.querySelector('apex-grid') as ApexGrid<TestData>;
        await settle(grid);
        render(view(columns, [{ key: 'importance', direction: 'descending' }]), host);
        await settle(grid);
        expect(grid.getState().sort.map((e) => e.key)).to.deep.equal(['importance']);
      } finally {
        host.remove();
      }
    });

    it('sort() and filter() add onto an assigned, not yet applied, expression', async () => {
      const grid = await mount();
      grid.sortExpressions = [{ key: 'active', direction: 'descending' }];
      grid.sort({ key: 'id', direction: 'descending' });
      grid.filterExpressions = [{ key: 'name', condition: 'contains', searchTerm: 'a' } as any];
      grid.filter({ key: 'importance', condition: 'equals', searchTerm: 'low' } as any);
      await settle(grid);
      expect(grid.sortExpressions.map((e) => e.key)).to.deep.equal(['active', 'id']);
      expect(grid.filterExpressions.map((e) => e.key)).to.deep.equal(['name', 'importance']);
    });

    it('a sort entry without a direction takes the default', async () => {
      const grid = await mount();
      grid.sortExpressions = [{ key: 'id' } as any];
      await settle(grid);
      expect(grid.sortExpressions.map((e) => e.direction)).to.deep.equal(['ascending']);
    });

    it('an assigned filter reads back like the applied one before it renders', () => {
      const grid = document.createElement('apex-grid') as ApexGrid<TestData>;
      grid.columns = columns;
      grid.filterExpressions = [{ key: 'name', condition: 'contains', searchTerm: 'a' } as any];
      const [expression] = grid.filterExpressions;
      expect(typeof expression.condition).to.equal('object');
      expect(grid.getState().filter).to.deep.equal([
        {
          key: 'name',
          operand: 'contains',
          searchTerm: 'a',
          criteria: 'and',
          caseSensitive: false,
        },
      ]);
    });

    it('filterExpressions bound before columns does not throw and filters', async () => {
      const expr = [{ key: 'importance', condition: 'equals', searchTerm: 'low' }] as any;
      const grid = await fixture<ApexGrid<TestData>>(
        html`<apex-grid .data=${data} .filterExpressions=${expr} .columns=${columns}></apex-grid>`
      );
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(1);
      expect(ids(grid)).to.deep.equal([2, 4, 7]);
    });

    it('auto-generate with filterExpressions does not throw and filters', async () => {
      const expr = [{ key: 'importance', condition: 'equals', searchTerm: 'low' }] as any;
      const grid = await fixture<ApexGrid<TestData>>(
        html`<apex-grid auto-generate .data=${data} .filterExpressions=${expr}></apex-grid>`
      );
      await settle(grid);
      expect(grid.filterExpressions).to.have.lengthOf(1);
      expect(grid.dataView).to.have.lengthOf(3);
    });

    it('imperative filterExpressions before columns does not throw', () => {
      const grid = document.createElement('apex-grid') as ApexGrid<TestData>;
      expect(() => {
        grid.data = data;
        grid.filterExpressions = [
          { key: 'importance', condition: 'equals', searchTerm: 'low' },
        ] as any;
        grid.columns = columns;
      }).not.to.throw();
      expect(grid.filterExpressions).to.have.lengthOf(1);
    });
  });

  describe('filter() resolves operands safely', () => {
    it('does not mutate the caller expression and accepts frozen input', async () => {
      const grid = await mount();
      const expr = Object.freeze({ key: 'name', condition: 'contains', searchTerm: 'a' }) as any;
      expect(() => grid.filter(expr)).not.to.throw();
      expect(expr.condition).to.equal('contains');
      await settle(grid);
      expect(ids(grid)).to.deep.equal([1, 5]);
    });

    it('drops an unknown key or an operand the column type lacks, view keeps working', async () => {
      const grid = await mount();
      expect(() =>
        grid.filter([
          { key: 'nope', condition: 'contains', searchTerm: 'a' },
          { key: 'id', condition: 'contains', searchTerm: 1 },
          { key: 'name', condition: 'toString', searchTerm: 'a' },
        ] as any)
      ).not.to.throw();
      expect(grid.filterExpressions).to.have.lengthOf(0);
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(ids(grid)).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);
    });
  });

  describe('setState validates elements, not only slices', () => {
    it('drops prototype operand names ("toString", "constructor") with a warning', async () => {
      const grid = await mount();
      const result = grid.setState({
        filter: [
          { key: 'name', operand: 'toString', searchTerm: 'a' },
          { key: 'name', operand: 'constructor', searchTerm: 'a' },
        ],
      });
      expect(result.warnings).to.have.lengthOf(2);
      expect(grid.filterExpressions).to.have.lengthOf(0);
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(ids(grid)[0]).to.equal(8);
    });

    it('drops a binary operand with no searchTerm', async () => {
      const grid = await mount();
      const result = grid.setState({ filter: [{ key: 'name', operand: 'contains' }] });
      expect(result.warnings.some((w) => w.includes('searchTerm'))).to.be.true;
      expect(grid.filterExpressions).to.have.lengthOf(0);
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(ids(grid)[0]).to.equal(8);
    });

    it('keeps a unary operand with no searchTerm', async () => {
      const grid = await mount();
      const result = grid.setState({ filter: [{ key: 'active', operand: 'true' }] });
      expect(result.warnings).to.deep.equal([]);
      await settle(grid);
      expect(ids(grid)).to.deep.equal([3, 5, 7, 8]);
    });

    it('drops a sort entry with an invalid direction', async () => {
      const grid = await mount();
      const result = grid.setState({ sort: [{ key: 'id', direction: 'desc' as any }] });
      expect(result.warnings.some((w) => w.includes('direction'))).to.be.true;
      expect(grid.getState().sort).to.deep.equal([]);
    });

    it('never throws on malformed elements; bad entries are dropped with warnings', async () => {
      const grid = await mount({ selection: { enabled: true, mode: 'multiple' } });
      let result!: ReturnType<ApexGrid<TestData>['setState']>;
      expect(() => {
        result = grid.setState({
          columns: [null, 7, { key: 'name' }],
          sort: [null, { key: 'id', direction: 'descending' }],
          filter: [null, 'x'],
          selection: [0, 2, null, { index: 'length' }, { index: -1 }, { index: 1 }],
          expansion: [null],
          treeExpanded: [null],
          rowPinning: { top: [3], bottom: [null] },
          rowOrder: [null],
        } as unknown as Partial<GridState>);
      }).not.to.throw();
      expect(result.warnings.length).to.be.greaterThan(4);
      expect(grid.columns[0].key).to.equal('name');
      expect(grid.sortExpressions.map((e) => e.key)).to.deep.equal(['id']);
      expect(grid.selectedRows.map((r) => r.id)).to.deep.equal([2]);
    });

    it('applyColumnLayout skips a repeated key', () => {
      const out = snapshot.applyColumnLayout(columns, [
        { key: 'id' },
        { key: 'id' },
        { key: 'name' },
      ]);
      expect(out.map((c) => c.key)).to.deep.equal(['id', 'name', 'active', 'importance']);
    });

    it('resolveRowRefs ignores non-object refs and non-integer indexes', () => {
      const refs = [0, null, { index: 1.5 }, { index: -1 }, { index: 2 }] as unknown as RowRef[];
      expect(snapshot.resolveRowRefs(refs, data).map((r) => r.id)).to.deep.equal([3]);
    });
  });

  describe('mergeColumnLayout overlays a partial layout', () => {
    it('keeps order, width and pinning; overlays only defined fields', () => {
      const merge = (snapshot as Record<string, unknown>).mergeColumnLayout as
        | ((c: ColumnLayoutState[], p: ColumnLayoutState[]) => ColumnLayoutState[])
        | undefined;
      expect(merge, 'mergeColumnLayout is exported').to.be.a('function');
      const current: ColumnLayoutState[] = [
        { key: 'id' },
        { key: 'name' },
        { key: 'email', width: '200px', pinned: 'end' },
        { key: 'amount' },
      ];
      const hidden = merge!(current, [{ key: 'email', hidden: true }]);
      expect(hidden.map((c) => c.key)).to.deep.equal(['id', 'name', 'email', 'amount']);
      expect(hidden[2]).to.deep.include({ width: '200px', pinned: 'end', hidden: true });
      const shown = merge!(hidden, [{ key: 'email', hidden: false }, { key: 'ghost' }]);
      expect(shown[2]).to.deep.include({ width: '200px', pinned: 'end', hidden: false });
      expect(shown).to.have.lengthOf(4);
      expect(current[2].hidden, 'input not mutated').to.equal(undefined);
    });
  });

  describe('selection and expansion report what was applied', () => {
    it('a vetoed selection is not reported as applied', async () => {
      const grid = await mount({ selection: { enabled: true, mode: 'multiple' } });
      grid.addEventListener('rowSelecting', (e) => e.preventDefault());
      const result = grid.setState({ selection: [{ index: 0 }] });
      expect(grid.selectedRows).to.have.lengthOf(0);
      expect(result.applied).to.not.include('selection');
      expect(result.warnings.some((w) => w.startsWith('selection'))).to.be.true;
    });

    it('selection on a grid without selection enabled warns', async () => {
      const grid = await mount();
      const result = grid.setState({ selection: [{ index: 0 }] });
      expect(result.applied).to.not.include('selection');
      expect(result.warnings.some((w) => w.startsWith('selection'))).to.be.true;
      // An empty slice (every getState snapshot carries one) stays silent.
      expect(grid.setState({ selection: [], expansion: [] }).warnings).to.deep.equal([]);
    });

    it('a vetoed expansion is not reported as applied', async () => {
      const grid = await mount({ expansion: { enabled: true } } as any);
      grid.addEventListener('rowExpanding', (e) => e.preventDefault());
      const result = grid.setState({ expansion: [{ index: 0 }] });
      expect(grid.expandedRows).to.have.lengthOf(0);
      expect(result.applied).to.not.include('expansion');
    });
  });

  describe('snapshot shape', () => {
    it('maps every slice to the GridState keys it restores', async () => {
      const grid = await mount();
      const result = grid.setState({ treeExpanded: [], treeExpandedKeys: [] });
      expect(result.applied).to.deep.equal(['tree']);
      expect(snapshot.SET_STATE_SLICE_KEYS.tree).to.deep.equal([
        'treeExpanded',
        'treeExpandedKeys',
      ]);
      const keys = Object.values(snapshot.SET_STATE_SLICE_KEYS).flat();
      expect(keys).to.have.members(Object.keys(grid.getState()).filter((key) => key !== 'version'));
    });

    it('getState().quickFilter is a string after the attribute is removed', async () => {
      const grid = await fixture<ApexGrid<TestData>>(
        html`<apex-grid quick-filter="high" .data=${data} .columns=${columns}></apex-grid>`
      );
      await settle(grid);
      grid.removeAttribute('quick-filter');
      await settle(grid);
      const state = grid.getState();
      expect(state.quickFilter).to.equal('');
      expect(grid.setState(state, { strict: true }).warnings).to.deep.equal([]);
    });
  });

  describe('quick filter before the first render', () => {
    it('the quick-filter attribute present at mount is applied', async () => {
      const grid = await fixture<ApexGrid<TestData>>(
        html`<apex-grid quick-filter="high" .data=${data} .columns=${columns}></apex-grid>`,
        { parentNode: tallParent() }
      );
      await settle(grid, 4);
      expect(grid.totalItems).to.equal(2);
    });

    it('the .quickFilter property bound at mount is applied', async () => {
      const grid = await fixture<ApexGrid<TestData>>(
        html`<apex-grid .quickFilter=${'high'} .data=${data} .columns=${columns}></apex-grid>`,
        { parentNode: tallParent() }
      );
      await settle(grid, 4);
      expect(grid.totalItems).to.equal(2);
    });
  });

  describe('stateChanged listener tracking', () => {
    async function countSnapshots(grid: ApexGrid<TestData>, updates = 5) {
      let calls = 0;
      const original = grid.getState.bind(grid);
      grid.getState = ((options?: any) => {
        calls++;
        return original(options);
      }) as typeof grid.getState;
      for (let i = 0; i < updates; i++) {
        grid.requestUpdate();
        await grid.updateComplete;
      }
      return calls;
    }

    it('a once listener stops the snapshot work after it fires', async () => {
      const grid = await mount();
      let fired = 0;
      grid.addEventListener('stateChanged', () => fired++, { once: true });
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      expect(fired).to.equal(1);
      expect(await countSnapshots(grid)).to.equal(0);
    });

    it('an aborted signal stops the snapshot work', async () => {
      const grid = await mount();
      const controller = new AbortController();
      grid.addEventListener('stateChanged', () => {}, { signal: controller.signal });
      controller.abort();
      expect(await countSnapshots(grid)).to.equal(0);
    });

    it('a listener added twice and removed once leaves nothing attached', async () => {
      const grid = await mount();
      const handler = () => {};
      grid.addEventListener('stateChanged', handler);
      grid.addEventListener('stateChanged', handler);
      grid.removeEventListener('stateChanged', handler);
      expect(await countSnapshots(grid)).to.equal(0);
    });

    it('re-adding a tracked listener with once does not untrack it', async () => {
      const grid = await mount();
      let fired = 0;
      const handler = () => fired++;
      grid.addEventListener('stateChanged', handler);
      grid.addEventListener('stateChanged', handler, { once: true });
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      grid.sort({ key: 'id', direction: 'ascending' });
      await settle(grid);
      expect(fired).to.equal(2);
    });

    it('a once hook left from an earlier registration does not untrack a re-added listener', async () => {
      const grid = await mount();
      let fired = 0;
      const handler = () => fired++;
      grid.addEventListener('stateChanged', handler, { once: true });
      grid.removeEventListener('stateChanged', handler);
      grid.addEventListener('stateChanged', handler);
      grid.sort({ key: 'id', direction: 'descending' });
      await settle(grid);
      grid.sort({ key: 'id', direction: 'ascending' });
      await settle(grid);
      expect(fired).to.equal(2);
    });

    it('a listener attached before the first render sees no emit for the initial state', async () => {
      const grid = document.createElement('apex-grid') as ApexGrid<TestData>;
      let fired = 0;
      grid.addEventListener('stateChanged', () => fired++);
      grid.columns = columns;
      grid.data = [...data];
      document.body.appendChild(grid);
      try {
        await settle(grid);
        expect(fired).to.equal(0);
        grid.sort({ key: 'id', direction: 'descending' });
        await settle(grid);
        expect(fired).to.equal(1);
      } finally {
        grid.remove();
      }
    });

    it('no emit for the initial clamp of an out of range page bound before the first render', async () => {
      const grid = document.createElement('apex-grid') as ApexGrid<Row>;
      let fired = 0;
      grid.addEventListener('stateChanged', () => fired++);
      grid.columns = rowColumns;
      grid.data = [...forty];
      grid.pagination = { enabled: true, pageSize: 10 };
      grid.page = 99;
      document.body.appendChild(grid);
      try {
        await settle(grid, 5);
        expect(grid.page).to.equal(3);
        expect(fired).to.equal(0);
        grid.sort({ key: 'id', direction: 'descending' });
        await settle(grid);
        expect(fired).to.equal(1);
      } finally {
        grid.remove();
      }
    });

    it('a second subscription does not swallow a pending change for the first', async () => {
      const grid = await mount();
      let a = 0;
      grid.addEventListener('stateChanged', () => a++);
      grid.sort({ key: 'id', direction: 'descending' });
      grid.addEventListener('stateChanged', () => {});
      await settle(grid);
      expect(a).to.equal(1);
    });
  });

  describe('row refs serialise in linear time', () => {
    it('getState after select-all at 100k rows reads the data a linear number of times', async function () {
      this.timeout(30000);
      const n = 100_000;
      const budget = 10 * n;
      let reads = 0;
      let counting = false;
      const raw: Row[] = Array.from({ length: n }, (_, i) => ({ id: i, name: `r${i}` }));
      const proxied = new Proxy(raw, {
        get(target, prop, receiver) {
          if (counting && typeof prop === 'string' && /^\d+$/.test(prop)) {
            reads++;
            // Fail fast instead of scanning n^2 / 2 elements.
            if (reads > budget) throw new Error(`read budget of ${budget} exceeded`);
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const grid = await fixture<ApexGrid<Row>>(
        html`<apex-grid
          .data=${proxied}
          .columns=${rowColumns}
          .selection=${{ enabled: true, mode: 'multiple' }}
        ></apex-grid>`,
        { parentNode: tallParent() }
      );
      await settle(grid, 1);
      await grid.selectAllRows();
      await grid.updateComplete;

      reads = 0;
      counting = true;
      let state: GridState;
      try {
        state = grid.getState();
      } finally {
        counting = false;
      }
      expect(state.selection).to.have.lengthOf(n);
      expect(state.selection[n - 1]).to.deep.equal({ index: n - 1 });
      expect(reads).to.be.at.most(budget);
    });
  });
});
