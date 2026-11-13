import { expect } from '@open-wc/testing';
import type { ColumnConfiguration, SortExpression } from 'apex-grid';
import type {
  ApexGridEnterpriseEventMap,
  GroupRowMeta,
  RangeChangedDetail,
} from 'apex-grid-enterprise';
import { type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ApexGridEnterpriseEventProps,
  apexGridEnterpriseEvents,
} from '../src/generated/enterprise/events.js';
import {
  ApexGridAI,
  ApexGridChart,
  ApexGridEnterprise,
  type ApexGridEnterpriseElement,
  type ApexGridEnterpriseProps,
  ApexGridFilterBuilder,
  ApexGridSetFilter,
  ApexGridStatusBar,
  ApexGridToolPanel,
  createApexGridEnterprise,
} from '../src/enterprise/index.js';
import type { ApexGridElement } from '../src/index.js';

interface Sale {
  id: number;
  region: string;
  amount: number;
}

const SalesGrid = createApexGridEnterprise<Sale>();

const sales: Sale[] = [
  { id: 1, region: 'North', amount: 10 },
  { id: 2, region: 'South', amount: 20 },
  { id: 3, region: 'North', amount: 30 },
];
const columns: ColumnConfiguration<Sale>[] = [
  { key: 'id', type: 'number' },
  { key: 'region' },
  { key: 'amount', type: 'number', headerText: 'Amount' },
];

// --- Type-level checks ------------------------------------------------------
// `npm run typecheck` compiles this file, so a regression in the row typing of
// createApexGridEnterprise<T>() or in the companions' grid prop fails CI.

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
  ? true
  : false;
function assertType<_T extends true>(): void {}

/** The event a typed `on<Event>` prop's handler receives. */
type HandlerEvent<P extends keyof ApexGridEnterpriseEventProps> = Parameters<
  NonNullable<ApexGridEnterpriseProps<Sale>[P]>
>[0];

// One naming rule for the runtime map and the typed handlers, covering every
// community and enterprise event the element's map lists.
assertType<Equal<keyof ApexGridEnterpriseEventProps, keyof typeof apexGridEnterpriseEvents>>();
assertType<
  {
    [P in keyof ApexGridEnterpriseEventProps]: Equal<
      HandlerEvent<P>,
      ApexGridEnterpriseEventMap<Sale>[ApexGridEnterpriseEventProps[P]]
    >;
  }[keyof ApexGridEnterpriseEventProps]
>();
assertType<
  Equal<
    ApexGridEnterpriseEventProps[keyof ApexGridEnterpriseEventProps],
    keyof ApexGridEnterpriseEventMap<Sale>
  >
>();
assertType<Equal<HandlerEvent<'onApexRangeChanged'>['detail'], RangeChangedDetail>>();
assertType<Equal<HandlerEvent<'onRowSelected'>['detail']['added'], Sale[]>>();
assertType<Equal<HandlerEvent<'onSorted'>['detail'], SortExpression<Sale>>>();
// The grouping module fires these on the host; they are in the event map too.
assertType<Equal<HandlerEvent<'onGroupExpanding'>['detail']['expanded'], boolean>>();
assertType<
  Equal<HandlerEvent<'onGroupExpanded'>['detail']['meta'], GroupRowMeta<Sale> | undefined>
>();
// The ref resolves to the row-typed element.
assertType<
  Equal<
    ApexGridEnterpriseProps<Sale>['ref'],
    React.RefAttributes<ApexGridEnterpriseElement<Sale>>['ref']
  >
>();

/** Compile-only: row-typed props, settable members only, never rendered. */
export function enterprisePropsCompile(rows: Sale[]): ReactNode {
  // A method's own value, so the method case fails only for being a method.
  const grid = document.createElement('apex-grid-enterprise') as ApexGridEnterpriseElement<Sale>;
  return (
    <>
      <SalesGrid
        data={rows}
        columns={columns}
        groupBy={['region']}
        aggregations={{ amount: ['sum'] }}
        rangeSelection
        theme="dark"
        rowId={(row) => row.id}
        style={{ height: 300 }}
        onApexRangeChanged={(e) => {
          assertType<Equal<typeof e.detail.stats.sum, number>>();
        }}
        onApexViewChanged={(e) => {
          assertType<Equal<typeof e.detail, null>>();
        }}
      />
      {/* @ts-expect-error data is Sale[], so a row with a string amount is rejected */}
      <SalesGrid data={[{ id: 1, region: 'x', amount: 'ten' }]} />
      {/* @ts-expect-error a column key must be a key of Sale */}
      <SalesGrid columns={[{ key: 'email' }]} />
      {/* @ts-expect-error totalItems is getter-only */}
      <SalesGrid totalItems={1} />
      {/* @ts-expect-error selectRange is a method */}
      <SalesGrid selectRange={grid.selectRange} />
      {/* @ts-expect-error selectRange is a method on the base component too */}
      <ApexGridEnterprise selectRange={grid.selectRange} />
      <ApexGridEnterprise data={rows} groupBy={['region']} theme="dark tinted" />
    </>
  );
}

/**
 * Compile-only: each companion's `grid` prop takes a row-typed enterprise grid
 * (the element a ref or a ref callback hands back), or null before it mounts.
 */
export function companionGridCompile(
  grid: ApexGridEnterpriseElement<Sale> | null,
  community: ApexGridElement<Sale>
): ReactNode {
  return (
    <>
      <ApexGridStatusBar grid={grid} />
      <ApexGridToolPanel grid={grid} pivotMode={false} />
      <ApexGridSetFilter grid={grid} column="region" />
      <ApexGridFilterBuilder grid={grid} />
      <ApexGridChart grid={grid} type="bar" source="selection" onApexChartCreated={() => {}} />
      <ApexGridAI grid={grid} mode="inline" onApexAiResult={() => {}} />
      {/* @ts-expect-error a community <apex-grid> has no enterprise features to bind */}
      <ApexGridStatusBar grid={community} />
      {/* @ts-expect-error grid is an element, not a selector */}
      <ApexGridChart grid="#sales" />
    </>
  );
}

// --- Runtime checks ---------------------------------------------------------

function tick(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

async function render(node: ReactNode): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(node);
  await tick();
  return { container, root };
}

function cleanup(root: Root, container: HTMLElement): void {
  root.unmount();
  container.remove();
}

/** The status bar's value for a stat label, e.g. "Sum". */
function statValue(bar: Element, label: string): string | null {
  for (const stat of bar.shadowRoot?.querySelectorAll('[part="stat"]') ?? []) {
    if (stat.querySelector('[part="stat-label"]')?.textContent?.trim() === label) {
      return stat.querySelector('[part="stat-value"]')?.textContent?.trim() ?? null;
    }
  }
  return null;
}

const TAGS = [
  'apex-grid-enterprise',
  'apex-grid-tool-panel',
  'apex-grid-status-bar',
  'apex-grid-set-filter',
  'apex-grid-filter-builder',
  'apex-grid-chart',
  'apex-grid-ai',
];

describe('react-apex-grid/enterprise', () => {
  it('exports the enterprise grid, its typed factory and the six companions', async () => {
    const entry = await import('../src/enterprise/index.js');
    expect(Object.keys(entry).sort()).to.deep.equal([
      'ApexGridAI',
      'ApexGridChart',
      'ApexGridEnterprise',
      'ApexGridFilterBuilder',
      'ApexGridSetFilter',
      'ApexGridStatusBar',
      'ApexGridToolPanel',
      'createApexGridEnterprise',
    ]);
    expect(createApexGridEnterprise<Sale>()).to.equal(ApexGridEnterprise);
  });

  it('registers the seven enterprise elements in the browser', () => {
    expect(TAGS.filter((tag) => !customElements.get(tag))).to.deep.equal([]);
  });

  it('mounts the enterprise grid with data, columns and every feature module', async () => {
    const { container, root } = await render(
      <SalesGrid data={sales} columns={columns} style={{ height: 300 }} />
    );
    const el = container.querySelector('apex-grid-enterprise') as ApexGridEnterpriseElement<Sale>;
    expect(el).to.be.instanceOf(customElements.get('apex-grid-enterprise')!);
    await el.updateComplete;
    expect(el.data).to.deep.equal(sales);
    expect(el.columns.map((c) => c.key)).to.deep.equal(['id', 'region', 'amount']);
    expect(el.dataView).to.have.length(3);
    // Range selection is an opt-in module: it answers only if the entry ran
    // ApexGridEnterprise.use(...enterpriseModules) before registering.
    el.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'amount' });
    expect(el.getSelectionBounds()).to.not.equal(null);
    cleanup(root, container);
  });

  it('hands typed enterprise events to on<Event> props', async () => {
    const ranges: RangeChangedDetail[] = [];
    const views: string[] = [];
    const { container, root } = await render(
      <SalesGrid
        data={sales}
        columns={columns}
        style={{ height: 300 }}
        onApexRangeChanged={(e) => ranges.push(e.detail)}
        onApexViewChanged={(e) => views.push(e.type)}
      />
    );
    const el = container.querySelector('apex-grid-enterprise') as ApexGridEnterpriseElement<Sale>;
    await el.updateComplete;
    el.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'amount' });
    expect(ranges.at(-1)?.stats.sum).to.equal(60);

    const before = views.length;
    root.render(
      <SalesGrid
        data={sales.slice(0, 1)}
        columns={columns}
        style={{ height: 300 }}
        onApexRangeChanged={(e) => ranges.push(e.detail)}
        onApexViewChanged={(e) => views.push(e.type)}
      />
    );
    await tick();
    expect(views.length).to.be.greaterThan(before);
    expect(views.at(-1)).to.equal('apex-view-changed');
    cleanup(root, container);
  });

  it('hands the grouping events to onGroupExpanding and onGroupExpanded', async () => {
    const expanding: { key: string; expanded: boolean }[] = [];
    const expanded: { key: string; expanded: boolean; label?: string }[] = [];
    let veto = true;
    const { container, root } = await render(
      <SalesGrid
        data={sales}
        columns={columns}
        groupBy={['region']}
        style={{ height: 300 }}
        onGroupExpanding={(e) => {
          expanding.push({ key: e.detail.key, expanded: e.detail.expanded });
          if (veto) e.preventDefault();
        }}
        onGroupExpanded={(e) => {
          const { key, expanded: open, meta } = e.detail;
          expanded.push({ key, expanded: open, label: meta?.label });
        }}
      />
    );
    const el = container.querySelector('apex-grid-enterprise') as ApexGridEnterpriseElement<Sale>;
    await el.updateComplete;
    const north = el.getGroups().find((g) => g.label === 'North');
    expect(north).to.not.equal(undefined);

    // Cancelled from the React handler: no follow-up event.
    el.toggleGroup(north!.key);
    expect(expanding).to.deep.equal([{ key: north!.key, expanded: false }]);
    expect(expanded).to.deep.equal([]);

    veto = false;
    el.toggleGroup(north!.key);
    expect(expanding).to.have.length(2);
    expect(expanded).to.deep.equal([{ key: north!.key, expanded: false, label: 'North' }]);
    cleanup(root, container);
  });

  it('binds a companion to the grid a ref callback hands back', async () => {
    function Sales() {
      const [grid, setGrid] = useState<ApexGridEnterpriseElement<Sale> | null>(null);
      return (
        <>
          <SalesGrid ref={setGrid} data={sales} columns={columns} style={{ height: 300 }} />
          <ApexGridStatusBar grid={grid} />
        </>
      );
    }
    const { container, root } = await render(<Sales />);
    const el = container.querySelector('apex-grid-enterprise') as ApexGridEnterpriseElement<Sale>;
    const bar = container.querySelector('apex-grid-status-bar') as Element & {
      grid: unknown;
      updateComplete: Promise<boolean>;
    };
    expect(bar.grid).to.equal(el);
    await el.updateComplete;
    el.selectRange({ row: 0, column: 'amount' }, { row: 2, column: 'amount' });
    await tick();
    await bar.updateComplete;
    expect(statValue(bar, 'Sum')).to.equal('60');
    cleanup(root, container);
  });
});
