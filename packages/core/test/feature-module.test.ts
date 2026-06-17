import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ReactiveController } from 'lit';
import { ApexGrid } from '../src/components/grid.js';
import { StateController } from '../src/controllers/state.js';
import type {
  GridFeatureModule,
  PresentedRow,
  RowPresenter,
  RowPresenterContext,
  RowTransformer,
} from '../src/internal/feature-module.js';
import type { GridHost } from '../src/internal/types.js';
import data, { type TestData } from './utils/test-data.js';

/** Reaches the protected `stateController` field for assertions. */
function stateOf<T extends object>(grid: ApexGrid<T>): StateController<T> {
  return (grid as unknown as { stateController: StateController<T> }).stateController;
}

/** Recursively collects elements matching `selector` across shadow roots. */
function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const out: Element[] = [];
  const visit = (node: ShadowRoot | Element) => {
    for (const el of node.querySelectorAll(selector)) out.push(el);
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return out;
}

describe('Feature module seam', () => {
  afterEach(() => fixtureCleanup());

  it('community grid registers zero feature modules (behaviour unchanged)', async () => {
    ApexGrid.register();
    const grid = await fixture<ApexGrid<TestData>>(html`<apex-grid .data=${data}></apex-grid>`);
    const state = stateOf(grid);

    expect(state.modules.size).to.equal(0);
    expect(state.module('anything')).to.be.undefined;

    // Built-in controllers remain wired exactly as before.
    for (const key of [
      'sorting',
      'filtering',
      'navigation',
      'resizing',
      'pagination',
      'reordering',
      'editing',
      'selection',
      'expansion',
      'tree',
    ] as const) {
      expect(state[key], `built-in controller "${key}"`).to.exist;
    }

    // The row-transform / row-presenter seams are inert with no modules:
    // transform returns the input untouched, presenter returns null.
    const rows = [...data];
    expect(state.applyModuleTransforms(rows), 'transform is identity').to.equal(rows);
    expect(
      state.presentRow(rows[0], { columns: grid.columns, rowIndex: 0 }),
      'presenter returns null'
    ).to.be.null;
  });

  it('injected module is constructed and retrievable via module(id)', async () => {
    let created = 0;
    let registeredWithHost = false;

    class DummyController implements ReactiveController {
      constructor(host: GridHost<TestData>) {
        created += 1;
        host.addController(this);
        registeredWithHost = true;
      }
      hostConnected() {}
    }

    const dummyModule: GridFeatureModule<TestData> = {
      id: 'dummy',
      create: (host) => new DummyController(host),
    };

    class SeamTestGrid<T extends object> extends ApexGrid<T> {
      public static override get tagName() {
        return 'apex-grid-seam-test';
      }
      public static override register() {
        if (!customElements.get(SeamTestGrid.tagName)) {
          customElements.define(SeamTestGrid.tagName, SeamTestGrid);
        }
      }
      protected override createStateController(): StateController<T> {
        return new StateController<T>(this, [dummyModule as unknown as GridFeatureModule<T>]);
      }
    }

    SeamTestGrid.register();
    const grid = await fixture<SeamTestGrid<TestData>>(
      html`<apex-grid-seam-test .data=${data}></apex-grid-seam-test>`
    );
    const state = stateOf(grid);

    expect(created, 'module.create called exactly once').to.equal(1);
    expect(registeredWithHost, 'controller registered with host').to.be.true;
    expect(state.modules.size).to.equal(1);
    expect(state.module('dummy')).to.be.instanceOf(DummyController);

    // Built-in controllers still present alongside the injected module.
    expect(state.sorting).to.exist;
    expect(state.tree).to.exist;
  });
});

describe('Row transform + presenter seams', () => {
  afterEach(() => fixtureCleanup());

  /** A synthesized "group header" row, identified by reference. */
  const HEADER: TestData = { id: -1, name: 'GROUP HEADER', active: false, importance: 'low' };

  /**
   * Stub module that both injects the header row (RowTransformer) and renders
   * it full-width (RowPresenter) — the shape the enterprise grouping feature
   * will take.
   */
  class GroupingStub
    implements ReactiveController, RowTransformer<TestData>, RowPresenter<TestData>
  {
    constructor(host: GridHost<TestData>) {
      host.addController(this);
    }
    hostConnected() {}
    processRows(rows: ReadonlyArray<TestData>): TestData[] {
      return [HEADER, ...rows];
    }
    presentRow(row: TestData, ctx: RowPresenterContext<TestData>): PresentedRow | null {
      if (row !== HEADER) return null;
      return {
        content: html`<span part="group-label">Group · ${ctx.columns.length} cols</span>`,
        level: 1,
        expanded: true,
      };
    }
  }

  const groupingStubModule: GridFeatureModule<TestData> = {
    id: 'grouping-stub',
    create: (host) => new GroupingStub(host),
  };

  class StubGrid<T extends object> extends ApexGrid<T> {
    public static override get tagName() {
      return 'apex-grid-rowtransform-test';
    }
    public static override register() {
      if (!customElements.get(StubGrid.tagName)) {
        customElements.define(StubGrid.tagName, StubGrid);
      }
    }
    protected override createStateController(): StateController<T> {
      return new StateController<T>(this, [groupingStubModule as unknown as GridFeatureModule<T>]);
    }
  }

  async function mount() {
    StubGrid.register();
    const grid = await fixture<StubGrid<TestData>>(
      html`<apex-grid-rowtransform-test .data=${data}></apex-grid-rowtransform-test>`
    );
    await grid.updateComplete;
    return grid;
  }

  it('RowTransformer injects synthesized rows into the dataView on first paint', async () => {
    const grid = await mount();
    const items = grid.pageItems as readonly TestData[];
    expect(items.length).to.equal(data.length + 1);
    expect(items[0]).to.equal(HEADER);
  });

  it('RowPresenter is consulted per row (owns the header, null otherwise)', async () => {
    const grid = await mount();
    const state = stateOf(grid);
    const ctx: RowPresenterContext<TestData> = { columns: grid.columns, rowIndex: 0 };

    const presented = state.presentRow(HEADER, ctx);
    expect(presented, 'presenter owns the header row').to.not.be.null;
    expect(presented!.level).to.equal(1);
    expect(presented!.expanded).to.equal(true);

    expect(state.presentRow(data[0], ctx), 'presenter ignores normal rows').to.be.null;
  });

  it('renders the presented row full-width in the body', async () => {
    const grid = await mount();
    await nextFrame();
    await nextFrame();

    const groupRows = deepQueryAll(grid.shadowRoot!, '[part="group-row"]');
    expect(groupRows.length, 'a full-width group row is rendered').to.be.greaterThan(0);
    expect(groupRows[0].textContent ?? '').to.contain('Group');
  });
});
