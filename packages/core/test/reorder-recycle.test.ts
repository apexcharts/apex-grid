import { expect, html, nextFrame } from '@open-wc/testing';
import type ApexGridCell from '../src/components/cell.js';
import type { StateController } from '../src/controllers/state.js';
import type { ColumnConfiguration, GridRowReorderingConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import { settle } from './utils/settle.js';
import data, { type TestData } from './utils/test-data.js';

/**
 * Row reorder under rows that re-bind to another record (plan section 4):
 * keyboard grab focus, FLIP ids and cancellation, and the drag ghost resolved
 * by record. The spike group keys the body by slot, so a sort or a move
 * re-binds row elements in place there.
 */
class RecycleFixture<T extends TestData> extends GridTestFixture<T> {
  public rowReordering: GridRowReorderingConfiguration = { enabled: true };

  public override updateConfig() {
    this.columnConfig = [
      { key: 'id', type: 'number', sort: true },
      { key: 'name', sort: true },
      { key: 'active', type: 'boolean' },
      { key: 'importance' },
    ] as ColumnConfiguration<T>[];
  }

  public override async setUp() {
    this.data = JSON.parse(JSON.stringify(data)) as T[];
    await super.setUp();
  }

  public override setupTemplate() {
    return html`<apex-grid
      .data=${this.data}
      .columns=${this.columnConfig}
      .rowReordering=${this.rowReordering}
    ></apex-grid>`;
  }

  public get stateController(): StateController<T> {
    return (this.grid as unknown as { stateController: StateController<T> }).stateController;
  }

  public ids(): number[] {
    return this.grid.pageItems.map((row) => (row as TestData).id);
  }

  /** Runs a key through the grid's navigation, as a key on the focused body would. */
  public key(k: string): void {
    this.stateController.navigation.navigate(new KeyboardEvent('keydown', { key: k }));
  }

  /** The pipeline run and the render of its result. */
  public async pipeline(): Promise<void> {
    await (this.grid as unknown as { pipelineSettled(): Promise<void> }).pipelineSettled();
    await Promise.all(this.grid.rows.map((row) => row.updateComplete));
  }

  public cellOf(record: T, key: keyof TestData): ApexGridCell<T> | undefined {
    const row = this.grid.rows.find((r) => r.data === record);
    return row?.cells.find((cell) => cell.column.key === key);
  }
}

/** The focused element, through every open shadow root. */
function deepActive(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

/** A real keydown on whatever has focus, the way a key press arrives. */
function press(key: string): void {
  (deepActive() ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true })
  );
}

/** Script animations (not CSS transitions or animations) still running on `element`. */
function runningScriptAnimations(element: Element): Animation[] {
  return element
    .getAnimations()
    .filter(
      (a) =>
        !(a instanceof CSSTransition) && !(a instanceof CSSAnimation) && a.playState === 'running'
    );
}

function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { clientX: number; clientY: number; buttons?: number }
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId: 1,
    button: 0,
    buttons: init.buttons ?? (type === 'pointerup' ? 0 : 1),
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

const fx = new RecycleFixture(data);

describe('Row reorder recycling: keyboard grab focus', () => {
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  it('focus follows the grabbed record through each move', async () => {
    const grabbed = fx.grid.pageItems[0];
    fx.cellOf(grabbed, 'name')!.click();
    await fx.waitForUpdate();
    expect(deepActive()).to.equal(fx.cellOf(grabbed, 'name'));

    press(' ');
    await fx.waitForUpdate();
    expect(fx.stateController.rowReorder.grabbed).to.equal(grabbed);

    for (const expected of [1, 2]) {
      press('ArrowDown');
      await settle(fx.grid);
      expect(fx.grid.pageItems.indexOf(grabbed)).to.equal(expected);
      expect(fx.stateController.active.row).to.equal(expected);
      const focused = deepActive() as ApexGridCell<TestData> | null;
      expect(focused, `focus after move to ${expected}`).to.equal(fx.cellOf(grabbed, 'name'));
      expect(focused?.row.data).to.equal(grabbed);
      expect(focused?.tabIndex).to.equal(0);
    }
  });

  it('Escape puts the active row and focus back on the grabbed record', async () => {
    const grabbed = fx.grid.pageItems[0];
    fx.cellOf(grabbed, 'name')!.click();
    await fx.waitForUpdate();
    fx.key(' ');
    fx.key('ArrowDown');
    await settle(fx.grid);
    fx.key('ArrowDown');
    await settle(fx.grid);
    expect(fx.ids()).to.deep.equal([2, 3, 1, 4, 5, 6, 7, 8]);

    fx.key('Escape');
    await settle(fx.grid);
    expect(fx.ids()).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fx.stateController.active.row).to.equal(0);
    const focused = deepActive() as ApexGridCell<TestData> | null;
    expect(focused).to.equal(fx.cellOf(grabbed, 'name'));
    expect(focused?.row.data).to.equal(grabbed);
    expect(focused?.tabIndex).to.equal(0);
  });
});

describe('Row reorder recycling: FLIP ids and cancellation', () => {
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  it('three grab moves inside one FLIP leave at most one row FLIP per element', async () => {
    fx.stateController.active = { column: 'id' as never, row: 0 };
    fx.key(' ');
    const start = performance.now();
    for (let i = 0; i < 3; i++) {
      fx.key('ArrowDown');
      await fx.pipeline();
      await nextFrame();
    }
    // The checks below mean something only while the first FLIP still runs.
    expect(performance.now() - start).to.be.below(200);
    expect(fx.ids()).to.deep.equal([2, 3, 4, 1, 5, 6, 7, 8]);

    const perRow = fx.grid.rows.map((row) => runningScriptAnimations(row));
    expect(perRow.flat().length).to.be.greaterThan(0);
    expect(Math.max(...perRow.map((animations) => animations.length))).to.be.at.most(1);
    expect(perRow.flat().map((animation) => animation.id)).to.satisfy((ids: string[]) =>
      ids.every((id) => id === 'apex-flip-y')
    );
  });

  it('a re-bind to another record cancels the row FLIP it carried', async () => {
    expect(fx.grid.moveRow(0, 2, 'after')).to.be.true;
    await fx.pipeline();
    await nextFrame();
    const flipping = fx.grid.rows.filter((row) => runningScriptAnimations(row).length > 0);
    expect(flipping.length).to.be.greaterThan(0);
    const shown = new Map(fx.grid.rows.map((row) => [row, row.data] as const));
    // Each running FLIP against the record its element showed when it ran.
    const startedFor = new WeakMap<Animation, TestData>();
    for (const row of fx.grid.rows) {
      for (const animation of runningScriptAnimations(row)) startedFor.set(animation, row.data);
    }

    // A programmatic sort plays no FLIP of its own.
    fx.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await fx.pipeline();
    expect(fx.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);

    let rebound = 0;
    for (const row of fx.grid.rows) {
      // Whatever still runs on an element is for the record it renders now.
      for (const animation of runningScriptAnimations(row)) {
        expect(startedFor.get(animation) ?? row.data, `row ${row.index} FLIP`).to.equal(row.data);
      }
      if (shown.get(row) === row.data) continue;
      rebound++;
      expect(runningScriptAnimations(row), `row ${row.index}`).to.deep.equal([]);
    }
    // Item keys move each element with its record, so only slot keys re-bind.
    const slotKeyed = (globalThis as { __apexRowKeying?: unknown }).__apexRowKeying === 'spike';
    if (slotKeyed) expect(rebound, 'rows re-bound to another record').to.be.greaterThan(0);
    else expect(rebound).to.equal(0);
  });
});

describe('Row reorder recycling: drag ghost', () => {
  beforeEach(async () => await fx.setUp());
  afterEach(() => fx.tearDown());

  const grip = (row: HTMLElement) =>
    row.shadowRoot!.querySelector('[part="reorder-handle"]') as HTMLElement;

  it('the ghost shows the pressed record after a re-bind before the threshold', async () => {
    const record = fx.grid.pageItems[0];
    const row0 = fx.grid.rows[0] as unknown as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    const x = r0.left + 8;
    grip(row0).dispatchEvent(pointerEvent('pointerdown', { clientX: x, clientY: r0.top + 8 }));

    fx.grid.sortExpressions = [{ key: 'id', direction: 'descending' }];
    await fx.pipeline();
    expect(fx.ids()).to.deep.equal([8, 7, 6, 5, 4, 3, 2, 1]);

    fx.grid.dispatchEvent(pointerEvent('pointermove', { clientX: x, clientY: r0.top + 14 }));
    const reorder = fx.stateController.rowReorder;
    expect(reorder.dragging).to.equal(record);
    const texts = reorder.ghost?.cells.map((cell) => cell.text) ?? [];
    expect(texts).to.include(record.name);
    expect(texts).to.include(String(record.id));
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0 }));
  });

  it('a pressed record filtered out before the threshold gets no other record in its ghost', async () => {
    const record = fx.grid.pageItems[0];
    const row0 = fx.grid.rows[0] as unknown as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    const x = r0.left + 8;
    grip(row0).dispatchEvent(pointerEvent('pointerdown', { clientX: x, clientY: r0.top + 8 }));

    // No rendered row shows the pressed record now. Under slot keys the
    // pressed element shows record 2, so its own snapshot must decline.
    fx.grid.filter([{ key: 'id', condition: 'greaterThan', searchTerm: 1 }] as never);
    await fx.pipeline();
    expect(fx.ids()).to.deep.equal([2, 3, 4, 5, 6, 7, 8]);
    expect(fx.grid.rows.some((row) => row.data === record)).to.be.false;

    fx.grid.dispatchEvent(pointerEvent('pointermove', { clientX: x, clientY: r0.top + 14 }));
    const texts = fx.stateController.rowReorder.ghost?.cells.map((cell) => cell.text) ?? [];
    for (const other of fx.grid.pageItems) {
      expect(texts, `record ${other.id}`).to.not.include(other.name);
      expect(texts, `record ${other.id}`).to.not.include(String(other.id));
    }
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0 }));
  });

  it('after a live swap exactly one row is [dragging] and it renders the dragged record', async () => {
    const record = fx.grid.pageItems[0];
    const row0 = fx.grid.rows[0] as unknown as HTMLElement;
    const r0 = row0.getBoundingClientRect();
    const r1 = (fx.grid.rows[1] as unknown as HTMLElement).getBoundingClientRect();
    const x = r0.left + 8;
    grip(row0).dispatchEvent(pointerEvent('pointerdown', { clientX: x, clientY: r0.top + 8 }));
    fx.grid.dispatchEvent(
      pointerEvent('pointermove', { clientX: x, clientY: r1.top + r1.height * 0.75 })
    );
    await fx.pipeline();
    expect(fx.ids()).to.deep.equal([2, 1, 3, 4, 5, 6, 7, 8]);

    const dragging = fx.grid.rows.filter((row) => row.hasAttribute('dragging'));
    expect(dragging.length).to.equal(1);
    expect(dragging[0].data).to.equal(record);
    document.body.dispatchEvent(pointerEvent('pointerup', { clientX: 0, clientY: 0 }));
  });
});
