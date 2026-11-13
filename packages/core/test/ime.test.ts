import { expect, html } from '@open-wc/testing';
import type ApexGridToolbar from '../src/components/toolbar.js';
import { isComposing, trackCompositions } from '../src/internal/ime.js';
import type { ColumnConfiguration, GridEditingConfiguration } from '../src/internal/types.js';
import GridTestFixture from './utils/grid-fixture.js';
import data, { type TestData } from './utils/test-data.js';

// Synthetic stand-ins for what a browser fires while an IME converts text.
// Real composition events are composed, so they reach the document listener.
const compose = (target: EventTarget, type: 'compositionstart' | 'compositionend', text = '') =>
  target.dispatchEvent(new CompositionEvent(type, { bubbles: true, composed: true, data: text }));

/** A keydown as the browser sends it; `keyCode: 229` is the IME's "Process" key code. */
const keydown = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

/** An event with neither `isComposing` nor `keyCode`, which only the element flag can read. */
const bare = (target: EventTarget) =>
  target.dispatchEvent(new Event('keydown', { bubbles: true, composed: true }));

/** Sets the control's text and fires `input`, marked as composing when asked. */
const input = (target: HTMLInputElement, value: string, isComposing = false) => {
  target.value = value;
  target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, isComposing }));
};

/** Outlasts the toolbar's fixed 200 ms quick-filter debounce. */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 250));

describe('IME composition guard', () => {
  describe('isComposing', () => {
    let control: HTMLInputElement;

    beforeEach(() => {
      trackCompositions();
      control = document.createElement('input');
      document.body.append(control);
    });

    afterEach(() => control.remove());

    it('reads event.isComposing on keydown and input', () => {
      expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))).to.be
        .true;
      expect(isComposing(new InputEvent('input', { isComposing: true }))).to.be.true;
      expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter' }))).to.be.false;
      expect(isComposing(new InputEvent('input'))).to.be.false;
    });

    it('reads keyCode 229, which Chromium on Windows and Safari send', () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 });
      expect(event.keyCode, 'the browser honours keyCode in the init dict').to.equal(229);
      expect(isComposing(event)).to.be.true;
      expect(isComposing(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }))).to.be.false;
    });

    it('falls back to the element flag between compositionstart and compositionend', () => {
      const seen: boolean[] = [];
      control.addEventListener('keydown', (event) => seen.push(isComposing(event)));
      bare(control);
      compose(control, 'compositionstart');
      bare(control);
      compose(control, 'compositionend', '東京');
      bare(control);
      expect(seen).to.deep.equal([false, true, false]);
    });

    it('tracks the original target inside a shadow root', () => {
      const host = document.createElement('div');
      document.body.append(host);
      const inner = document.createElement('input');
      host.attachShadow({ mode: 'open' }).append(inner);
      const seen: boolean[] = [];
      // Read where the event is retargeted to the host.
      host.addEventListener('keydown', (event) => seen.push(isComposing(event)));
      compose(inner, 'compositionstart');
      bare(inner);
      compose(inner, 'compositionend');
      bare(inner);
      host.remove();
      expect(seen).to.deep.equal([true, false]);
    });

    it('believes an explicit isComposing: false over a composition that never ended', () => {
      // Chromium drops a composition without compositionend when script
      // writes the control's value during it.
      const seen: boolean[] = [];
      control.addEventListener('keydown', (event) => seen.push(isComposing(event)));
      control.addEventListener('input', (event) => seen.push(isComposing(event)));
      compose(control, 'compositionstart');
      keydown(control, 'Escape');
      input(control, 'h');
      keydown(control, 'Enter', { keyCode: 229 });
      bare(control);
      expect(seen).to.deep.equal([false, false, true, true]);
    });

    it('forgets a composition when its control loses focus', () => {
      control.focus();
      compose(control, 'compositionstart');
      control.blur();
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      let composing = true;
      control.addEventListener('keydown', (e) => {
        composing = isComposing(e);
      });
      control.dispatchEvent(event);
      expect(composing).to.be.false;
    });

    it('is idempotent and inert for a second call', () => {
      trackCompositions();
      trackCompositions();
      const seen: boolean[] = [];
      control.addEventListener('keydown', (event) => seen.push(isComposing(event)));
      compose(control, 'compositionstart');
      compose(control, 'compositionend');
      keydown(control, 'Enter');
      expect(seen).to.deep.equal([false]);
    });
  });

  describe('cell editor', () => {
    class EditFixture extends GridTestFixture<TestData> {
      public editing: GridEditingConfiguration = { enabled: true, mode: 'cell' };

      public override updateConfig() {
        this.columnConfig = [
          { key: 'id', type: 'number' },
          { key: 'name', editable: true },
          {
            key: 'importance',
            editable: true,
            editorTemplate: (ctx) =>
              html`<input data-apex-editor part="custom" .value=${String(ctx.value)} />`,
          },
        ] as ColumnConfiguration<TestData>[];
      }

      public override async setUp() {
        this.data = JSON.parse(JSON.stringify(data)) as TestData[];
        await super.setUp();
      }

      public override setupTemplate() {
        return html`<apex-grid
          .data=${this.data}
          .columns=${this.columnConfig}
          .editing=${this.editing}
        ></apex-grid>`;
      }

      public editor(key: 'name' | 'importance') {
        const cell = this.rows.get(0).cells.get(key as never).element;
        return cell.shadowRoot!.querySelector<HTMLInputElement>('input[data-apex-editor]')!;
      }

      public async open(key: 'name' | 'importance') {
        await this.grid.editCell(0, key);
        await this.waitForUpdate();
        return this.editor(key);
      }
    }

    const TDD = new EditFixture(data);
    beforeEach(async () => await TDD.setUp());
    afterEach(() => TDD.tearDown());

    it('Enter during a composition keeps the editor open, Enter after it commits', async () => {
      const editor = await TDD.open('name');
      compose(editor, 'compositionstart');
      input(editor, 'かぶしき', true);
      const confirming = keydown(editor, 'Enter', { isComposing: true });
      input(editor, '株式', true);
      compose(editor, 'compositionend', '株式');
      await TDD.waitForUpdate();

      expect(confirming.defaultPrevented, 'the IME keeps its Enter').to.be.false;
      expect(TDD.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
      expect(TDD.grid.data[0].name).to.equal('A');

      keydown(editor, 'Enter');
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.grid.data[0].name).to.equal('株式');
    });

    it('ignores the keyCode 229 Enter Safari sends after compositionend', async () => {
      const editor = await TDD.open('name');
      compose(editor, 'compositionstart');
      input(editor, '東京', true);
      compose(editor, 'compositionend', '東京');
      keydown(editor, 'Enter', { keyCode: 229 });
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell, 'the confirming Enter does not commit').to.not.be.null;

      keydown(editor, 'Enter', { keyCode: 13 });
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.grid.data[0].name).to.equal('東京');
    });

    it('Escape during a composition backs out of the conversion, not the edit', async () => {
      const editor = await TDD.open('name');
      input(editor, 'Draft');
      compose(editor, 'compositionstart');
      input(editor, 'Draftとうきょう', true);
      keydown(editor, 'Escape', { isComposing: true });
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell, 'still editing').to.not.be.null;

      compose(editor, 'compositionend', '');
      keydown(editor, 'Escape');
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.grid.data[0].name).to.equal('A');
    });

    it('Tab during a composition does not commit or move', async () => {
      const editor = await TDD.open('name');
      input(editor, 'とう', true);
      const tab = keydown(editor, 'Tab', { isComposing: true });
      await TDD.waitForUpdate();
      expect(tab.defaultPrevented).to.be.false;
      expect(TDD.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'name' });
    });

    it('a custom editor keeps Escape and Tab of a composition (cell-level handler)', async () => {
      const editor = await TDD.open('importance');
      input(editor, 'ちゅう', true);
      keydown(editor, 'Escape', { isComposing: true });
      keydown(editor, 'Tab', { isComposing: true });
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell).to.deep.equal({ rowIndex: 0, columnKey: 'importance' });

      keydown(editor, 'Escape');
      await TDD.waitForUpdate();
      expect(TDD.grid.editingCell).to.be.null;
      expect(TDD.grid.data[0].importance).to.equal('medium');
    });
  });

  describe('filter panel', () => {
    class PanelFixture extends GridTestFixture<TestData> {
      public override updateConfig(): void {
        this.columnConfig = [
          { key: 'id', type: 'number', filter: true },
          { key: 'name', filter: true },
          { key: 'importance', filter: true },
        ] as ColumnConfiguration<TestData>[];
      }

      public async open(key: 'name' | 'id' | 'importance') {
        this.filterRow.open(key);
        await this.waitForUpdate();
        return this.filterRow.input;
      }
    }

    const TDD = new PanelFixture(data);
    let filtering: string[];

    beforeEach(async () => {
      await TDD.setUp();
      filtering = [];
      TDD.grid.addEventListener('filtering', (e) => filtering.push(e.detail.type));
    });
    afterEach(() => TDD.tearDown());

    it('does not filter by text still being converted, and filters once it is', async () => {
      const field = await TDD.open('importance');
      compose(field, 'compositionstart');
      input(field, 'h', true);
      input(field, 'hい', true);
      await TDD.waitForUpdate();
      expect(TDD.grid.filterExpressions, 'nothing applied mid-composition').to.deep.equal([]);
      expect(TDD.grid.totalItems).to.equal(data.length);

      input(field, 'high', true);
      compose(field, 'compositionend', 'high');
      await TDD.waitForUpdate();
      expect(TDD.grid.totalItems).to.equal(data.filter((d) => d.importance === 'high').length);
      expect(filtering).to.deep.equal(['add']);

      // A browser that follows the end with an input of the same text applies nothing again.
      input(field, 'high');
      await TDD.waitForUpdate();
      expect(filtering).to.deep.equal(['add']);

      // Ordinary typing afterwards applies at once, as before.
      input(field, 'hig');
      await TDD.waitForUpdate();
      expect(filtering).to.deep.equal(['add', 'modify']);
    });

    it('a keystroke after the composition forgets the composed text', async () => {
      const field = await TDD.open('name');
      input(field, 'a', true);
      compose(field, 'compositionend', 'a');
      await TDD.waitForUpdate();
      // Enter starts a new expression and clears the box.
      keydown(field, 'Enter');
      await TDD.waitForUpdate();
      input(field, 'a');
      await TDD.waitForUpdate();
      expect(filtering).to.deep.equal(['add', 'add']);
    });

    it('Enter during a composition does not start a new expression', async () => {
      const field = await TDD.open('name');
      input(field, 'とう', true);
      keydown(field, 'Enter', { isComposing: true });
      await TDD.waitForUpdate();
      expect(field.value, 'the converted text stays').to.equal('とう');

      compose(field, 'compositionend', 'とう');
      keydown(field, 'Enter', { keyCode: 229 });
      await TDD.waitForUpdate();
      expect(TDD.filterRow.input.value).to.equal('とう');

      keydown(TDD.filterRow.input, 'Enter');
      await TDD.waitForUpdate();
      expect(TDD.filterRow.input.value, 'a real Enter commits the chip').to.equal('');
    });

    it('Escape during a composition leaves the panel open', async () => {
      const field = await TDD.open('name');
      field.focus();
      compose(field, 'compositionstart');
      input(field, 'とう', true);
      keydown(field, 'Escape', { isComposing: true });
      await TDD.waitForUpdate();
      expect(TDD.filterRow.active).to.be.true;

      // Safari: compositionend, then the key with keyCode 229.
      compose(field, 'compositionend', '');
      keydown(field, 'Escape', { keyCode: 229 });
      await TDD.waitForUpdate();
      expect(TDD.filterRow.active).to.be.true;

      keydown(field, 'Escape');
      await TDD.waitForUpdate();
      expect(TDD.filterRow.active).to.be.false;
    });

    it('a numeric column also waits for the composition', async () => {
      const field = await TDD.open('id');
      input(field, '8', true);
      await TDD.waitForUpdate();
      expect(TDD.grid.totalItems).to.equal(data.length);
      compose(field, 'compositionend', '8');
      await TDD.waitForUpdate();
      expect(TDD.grid.totalItems).to.equal(1);
    });
  });

  describe('quick filter', () => {
    class QuickFixture extends GridTestFixture<TestData> {
      public override setupTemplate() {
        return html`<apex-grid
          show-quick-filter
          .data=${this.data}
          .columns=${this.columnConfig}
        ></apex-grid>`;
      }

      public get toolbar() {
        return this.grid.renderRoot.querySelector<ApexGridToolbar<TestData>>('apex-grid-toolbar')!;
      }

      public get search() {
        return this.toolbar.renderRoot.querySelector<HTMLInputElement>('input')!;
      }
    }

    const TDD = new QuickFixture(data);
    let changes: string[];

    beforeEach(async () => {
      await TDD.setUp();
      changes = [];
      TDD.grid.addEventListener('quickFilterChanging', (e) => changes.push(e.detail.nextValue));
    });
    afterEach(() => TDD.tearDown());

    it('does not search for text still being converted, and searches once it is', async () => {
      const search = TDD.search;
      compose(search, 'compositionstart');
      input(search, 'h', true);
      input(search, 'ひ', true);
      await TDD.waitForUpdate();
      expect(changes).to.deep.equal([]);
      expect(TDD.grid.quickFilter).to.equal('');

      input(search, 'high', true);
      compose(search, 'compositionend', 'high');
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes).to.deep.equal(['high']);
      expect(TDD.grid.totalItems).to.equal(data.filter((d) => d.importance === 'high').length);

      input(search, 'high');
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes, 'the trailing input is not applied twice').to.deep.equal(['high']);
    });

    it('keeps the debounce for typing without an IME', async () => {
      input(TDD.search, 'h');
      input(TDD.search, 'hi');
      input(TDD.search, 'high');
      expect(changes, 'nothing before the window ends').to.deep.equal([]);
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes).to.deep.equal(['high']);
    });

    it('a composition end goes through the same debounce', async () => {
      input(TDD.search, 'ひ', true);
      compose(TDD.search, 'compositionend', 'ひ');
      expect(changes).to.deep.equal([]);
      await pastDebounce();
      expect(changes).to.deep.equal(['ひ']);
    });

    it('a search pending from before a composition does not fire in the middle of it', async () => {
      const search = TDD.search;
      input(search, '東', true);
      compose(search, 'compositionend', '東');
      // The next reading starts inside the debounce window of the first.
      compose(search, 'compositionstart');
      input(search, '東きょう', true);
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes, 'nothing applied mid-composition').to.deep.equal([]);
      expect(search.value, 'the reading is not overwritten').to.equal('東きょう');

      input(search, '東京', true);
      compose(search, 'compositionend', '東京');
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes).to.deep.equal(['東京']);
      expect(TDD.grid.quickFilter).to.equal('東京');
    });

    it('a search pending from ASCII typing does not fire once a composition starts', async () => {
      const search = TDD.search;
      input(search, 'a');
      compose(search, 'compositionstart');
      input(search, 'aと', true);
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(changes).to.deep.equal([]);
      expect(search.value).to.equal('aと');
    });

    it('keys after a composition the browser dropped still reach the search', async () => {
      const search = TDD.search;
      compose(search, 'compositionstart');
      input(search, 'とう', true);
      // Setting the value from code drops the composition with no compositionend.
      TDD.grid.quickFilter = 'high';
      await TDD.waitForUpdate();
      expect(search.value).to.equal('high');

      keydown(search, 'Escape');
      await TDD.waitForUpdate();
      expect(search.value).to.equal('');
      expect(TDD.grid.quickFilter).to.equal('');

      input(search, 'h');
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(TDD.grid.quickFilter).to.equal('h');
    });

    it('Escape during a composition does not clear the search', async () => {
      const search = TDD.search;
      input(search, 'high');
      await pastDebounce();
      await TDD.waitForUpdate();
      expect(TDD.grid.quickFilter).to.equal('high');

      compose(search, 'compositionstart');
      input(search, 'highと', true);
      keydown(search, 'Escape', { isComposing: true });
      // Backing out of the conversion restores the text from before it.
      search.value = 'high';
      compose(search, 'compositionend', '');
      keydown(search, 'Escape', { keyCode: 229 });
      await TDD.waitForUpdate();
      expect(TDD.grid.quickFilter).to.equal('high');

      keydown(search, 'Escape');
      await TDD.waitForUpdate();
      expect(search.value).to.equal('');
      expect(TDD.grid.quickFilter).to.equal('');
    });
  });
});
