import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { ApexGridAI, ApexGridEnterprise, enterpriseModules, type Reasoner } from '../src/index.js';

interface Row {
  region: string;
  product: string;
  amount: number;
}

const columns: ColumnConfiguration<Row>[] = [
  { key: 'region', sort: true, filter: true },
  { key: 'product', sort: true, filter: true },
  { key: 'amount', type: 'number', sort: true, filter: true },
];

const data: Row[] = [
  { region: 'EMEA', product: 'A', amount: 10 },
  { region: 'AMER', product: 'B', amount: 30 },
  { region: 'APAC', product: 'C', amount: 20 },
];

function part<T extends HTMLElement>(panel: ApexGridAI, name: string): T | null {
  return panel.renderRoot.querySelector<T>(`[part="${name}"]`);
}

async function waitForResult(panel: ApexGridAI): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await nextFrame();
    if (panel.renderRoot.querySelector('[part="result"], [part="error"], [part="abstention"]')) {
      return;
    }
  }
}

async function type(panel: ApexGridAI, text: string): Promise<void> {
  const input = part<HTMLTextAreaElement>(panel, 'input');
  if (!input) throw new Error('no input');
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await panel.updateComplete;
}

describe('AI Toolkit — <apex-grid-ai>', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridAI.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(): Promise<{ grid: ApexGridEnterprise<Row>; panel: ApexGridAI }> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    const panel = await fixture<ApexGridAI>(
      html`<apex-grid-ai .grid=${grid} mode="inline"></apex-grid-ai>`
    );
    await panel.updateComplete;
    return { grid, panel };
  }

  it('disables send until a prompt is entered (rule engine, no adapter needed)', async () => {
    const { panel } = await mount();
    expect(part<HTMLButtonElement>(panel, 'send')?.disabled).to.be.true;
    await type(panel, 'sort by amount');
    expect(part<HTMLButtonElement>(panel, 'send')?.disabled).to.be.false;
  });

  it('control mode applies a change and reports what changed', async () => {
    const { grid, panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);

    expect(grid.getState().sort.map((s) => ({ key: s.key, direction: s.direction }))).to.deep.equal(
      [{ key: 'amount', direction: 'descending' }]
    );
    expect(part(panel, 'result')?.textContent).to.contain('sort');
    expect(part(panel, 'undo'), 'undo button').to.exist;
  });

  it('names an applied enterprise field without its state path', async () => {
    const { panel } = await mount();
    await type(panel, 'group by region');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    const text = part(panel, 'result')?.textContent ?? '';
    expect(text).to.contain('groupBy');
    expect(text).not.to.contain('modules');
  });

  it('undo restores the prior view', async () => {
    const { grid, panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    expect(grid.getState().sort).to.have.lengthOf(1);

    part<HTMLButtonElement>(panel, 'undo')?.click();
    for (let i = 0; i < 10; i++) await nextFrame();
    expect(grid.getState().sort, 'undo cleared the sort').to.be.empty;
  });

  it('ask mode answers without mutating the grid', async () => {
    const { grid, panel } = await mount();
    const modeButtons =
      panel.renderRoot.querySelectorAll<HTMLButtonElement>('[part="mode-button"]');
    modeButtons[1].click();
    await panel.updateComplete;
    expect(modeButtons[1].getAttribute('aria-pressed')).to.equal('true');

    await type(panel, 'how many rows are there?');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);

    expect(part(panel, 'result')?.textContent).to.contain('3'); // 3 rows
    expect(grid.getState().sort, 'ask did not change state').to.be.empty;
  });

  it('abstains honestly when the prompt cannot be mapped (no silent no-op)', async () => {
    const { grid, panel } = await mount();
    // No command verb the rules know, and the stray "who" must not answer confidently.
    await type(panel, 'delete who have amount less than 15');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);

    expect(part(panel, 'abstention'), 'abstention region').to.exist;
    expect(part(panel, 'abstention')?.textContent).to.contain(
      'could not turn that into a grid action'
    );
    expect(grid.getState().filter, 'abstention did not mutate the grid').to.be.empty;
  });

  it('surfaces a thrown reasoner error', async () => {
    const { grid, panel } = await mount();
    const boom: Reasoner = {
      name: 'boom',
      score: () => 1,
      reason: () => Promise.reject(new Error('boom from reasoner')),
    };
    grid.aiReasoner = boom;
    await panel.updateComplete;
    await type(panel, 'do something the rules cannot map xyzzy');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    // The localized headline, with the reasoner's own message as secondary detail.
    expect(part(panel, 'error')?.textContent).to.contain('Something went wrong. ');
    expect(part(panel, 'error')?.textContent).to.contain('boom from reasoner');
  });

  it('labels a result with its source (rule engine by default)', async () => {
    const { panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    const badge = part(panel, 'source');
    expect(badge, 'source badge').to.exist;
    expect(badge?.textContent).to.contain('Rule engine');
  });

  it('preview dry-runs the prompt without applying it', async () => {
    const { grid, panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'preview-button')?.click();
    for (let i = 0; i < 40; i++) {
      await nextFrame();
      if (part(panel, 'preview')) break;
    }
    expect(part(panel, 'preview'), 'preview region').to.exist;
    expect(part(panel, 'preview')?.textContent).to.contain('sort');
    expect(grid.getState().sort, 'preview must not mutate the grid').to.be.empty;
  });

  it('logs turns in the transcript and clears them', async () => {
    const { panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    expect(part(panel, 'history'), 'history region').to.exist;
    expect(panel.renderRoot.querySelectorAll('[part="history-item"]')).to.have.lengthOf(1);

    part<HTMLButtonElement>(panel, 'clear-history')?.click();
    await panel.updateComplete;
    expect(part(panel, 'history'), 'history cleared').to.not.exist;
  });

  it('exposes aria-modal="true" in dialog mode', async () => {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    const panel = await fixture<ApexGridAI>(
      html`<apex-grid-ai .grid=${grid} mode="dialog"></apex-grid-ai>`
    );
    await panel.updateComplete;
    const container = part(panel, 'panel')!;
    expect(container.getAttribute('role')).to.equal('dialog');
    expect(container.getAttribute('aria-modal')).to.equal('true');
  });
});

describe('AI Toolkit: <apex-grid-ai> turn lifecycle and focus', () => {
  const PLAN = {
    mode: 'control' as const,
    steps: [
      {
        tool: 'applyState',
        args: { patch: { sort: [{ key: 'amount', direction: 'descending' }] } },
      },
    ],
    confidence: 0.9,
    source: 'llm:slow',
  };

  /** A reasoner that never looks at the abort signal: each call parks until released. */
  function deafReasoner(): { reasoner: Reasoner; release: Array<() => void> } {
    const release: Array<() => void> = [];
    const reasoner: Reasoner = {
      name: 'llm:slow',
      score: () => 1,
      reason: () => new Promise((resolve) => release.push(() => resolve(PLAN))),
    };
    return { reasoner, release };
  }

  /** A reasoner that rejects with an AbortError when its signal fires, as fetch does. */
  const listeningReasoner: Reasoner = {
    name: 'llm:slow',
    score: () => 1,
    reason: (_utterance, ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal?.addEventListener('abort', () =>
          reject(new DOMException('signal is aborted without reason', 'AbortError'))
        );
      }),
  };

  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
    ApexGridAI.register();
  });
  afterEach(() => {
    fixtureCleanup();
    for (const el of document.querySelectorAll('apex-grid-ai')) el.remove();
  });

  async function frames(n = 5): Promise<void> {
    for (let i = 0; i < n; i++) await nextFrame();
  }

  async function mountGrid(): Promise<ApexGridEnterprise<Row>> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    await grid.updateComplete;
    return grid;
  }

  async function mount(
    mode: 'inline' | 'dialog' = 'inline'
  ): Promise<{ grid: ApexGridEnterprise<Row>; panel: ApexGridAI }> {
    const grid = await mountGrid();
    const panel = await fixture<ApexGridAI>(
      html`<apex-grid-ai .grid=${grid} mode=${mode}></apex-grid-ai>`
    );
    await panel.updateComplete;
    if (mode === 'dialog') {
      panel.show();
      await panel.updateComplete;
      await frames(2);
    }
    return { grid, panel };
  }

  const active = (panel: ApexGridAI) => panel.shadowRoot?.activeElement ?? null;
  const label = (panel: ApexGridAI, name: string) => part(panel, name)?.textContent?.trim();

  function keydown(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        composed: true,
        cancelable: true,
        ...init,
      })
    );
  }

  it('Cancel retires the turn: a late result is dropped and the next turn stays cancellable', async () => {
    const { grid, panel } = await mount();
    const { reasoner, release } = deafReasoner();
    grid.aiReasoner = reasoner;
    const results: unknown[] = [];
    panel.addEventListener('apex-ai-result', (event) => results.push(event));

    await type(panel, 'xyzzy plugh frobnicate A');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    expect(release, 'turn A in flight').to.have.lengthOf(1);
    expect(label(panel, 'send')).to.equal('Cancel');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await panel.updateComplete;
    expect(label(panel, 'notice'), 'a cancel reads as cancelled').to.equal('Cancelled.');
    expect(part(panel, 'error'), 'a cancel is not an error').to.not.exist;

    await type(panel, 'xyzzy plugh frobnicate B');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    expect(release, 'turn B in flight').to.have.lengthOf(2);

    release[0]();
    await frames();
    expect(label(panel, 'send'), 'B can still be cancelled').to.equal('Cancel');
    expect(part(panel, 'result'), 'the cancelled turn is not shown').to.not.exist;
    expect(results, 'no event for the cancelled turn').to.be.empty;
    expect(panel.renderRoot.querySelectorAll('[part="history-item"]')).to.have.lengthOf(0);

    release[1]();
    await waitForResult(panel);
    expect(label(panel, 'send')).to.equal('Send');
    expect(part(panel, 'result'), 'turn B lands').to.exist;
    expect(results).to.have.lengthOf(1);
    const items = panel.renderRoot.querySelectorAll('[part="history-item"]');
    expect(items).to.have.lengthOf(1);
    expect(items[0].textContent).to.contain('frobnicate B');
  });

  it('a cancel with a signal-honouring reasoner shows cancelled, not the abort message', async () => {
    const { grid, panel } = await mount();
    grid.aiReasoner = listeningReasoner;
    await type(panel, 'xyzzy plugh frobnicate A');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    expect(part(panel, 'error'), 'no raw abort error').to.not.exist;
    expect(label(panel, 'notice')).to.equal('Cancelled.');
    expect(label(panel, 'send')).to.equal('Send');
  });

  it('a cancelled preview is dropped too', async () => {
    const { grid, panel } = await mount();
    const { reasoner, release } = deafReasoner();
    grid.aiReasoner = reasoner;
    await type(panel, 'xyzzy plugh frobnicate A');
    part<HTMLButtonElement>(panel, 'preview-button')!.click();
    await frames();
    part<HTMLButtonElement>(panel, 'send')!.click(); // Cancel
    release[0]();
    await frames();
    expect(part(panel, 'preview'), 'cancelled preview not shown').to.not.exist;
    expect(label(panel, 'notice')).to.equal('Cancelled.');
  });

  it('a turn started on the new grid in the same task as the re-bind is kept', async () => {
    const { panel } = await mount();
    const other = await mountGrid();
    await type(panel, 'sort by amount descending');
    panel.grid = other as unknown as ApexGridAI['grid'];
    keydown(part(panel, 'input')!, 'Enter', { ctrlKey: true });
    await waitForResult(panel);
    expect(other.getState().sort).to.have.lengthOf(1);
    expect(part(panel, 'result'), 'the new grid turn lands').to.exist;
    expect(part(panel, 'undo')).to.exist;
    expect(label(panel, 'send')).to.equal('Send');
  });

  it('Escape while thinking closes the dialog without an error on reopen', async () => {
    const { grid, panel } = await mount('dialog');
    grid.aiReasoner = listeningReasoner;
    let closed = 0;
    panel.addEventListener('apex-ai-closed', () => closed++);
    await type(panel, 'xyzzy plugh frobnicate A');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    keydown(part(panel, 'input')!, 'Escape');
    await frames();
    expect(panel.open).to.be.false;
    expect(closed).to.equal(1);
    panel.show();
    await frames(2);
    expect(part(panel, 'error'), 'no abort error on reopen').to.not.exist;
    expect(label(panel, 'send')).to.equal('Send');
  });

  it('Tab and Shift+Tab wrap inside the dialog', async () => {
    const { panel } = await mount('dialog');
    const close = part<HTMLButtonElement>(panel, 'close')!;
    const send = part<HTMLButtonElement>(panel, 'send')!;
    await type(panel, 'sort by amount');
    const preview = part<HTMLButtonElement>(panel, 'preview-button')!;
    preview.focus();
    keydown(preview, 'Tab');
    expect(active(panel), 'Tab from the last control wraps to the first').to.equal(close);
    keydown(close, 'Tab', { shiftKey: true });
    expect(active(panel), 'Shift+Tab from the first wraps to the last').to.equal(preview);
    expect(send.isConnected).to.be.true;
  });

  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    it(`${modifier === 'ctrlKey' ? 'Ctrl' : 'Cmd'}+Enter in the prompt sends`, async () => {
      const { grid, panel } = await mount();
      await type(panel, 'sort by amount descending');
      keydown(part(panel, 'input')!, 'Enter', { [modifier]: true });
      await waitForResult(panel);
      expect(grid.getState().sort).to.have.lengthOf(1);
    });
  }

  it('re-binding to another grid retires the turn and clears the old grid state', async () => {
    const { grid, panel } = await mount();
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await waitForResult(panel);
    expect(part(panel, 'undo')).to.exist;

    const { reasoner, release } = deafReasoner();
    grid.aiReasoner = reasoner;
    await type(panel, 'xyzzy plugh frobnicate A');
    part<HTMLButtonElement>(panel, 'send')!.click();
    await frames();
    expect(label(panel, 'send')).to.equal('Cancel');

    const other = await mountGrid();
    panel.grid = other as unknown as ApexGridAI['grid'];
    await panel.updateComplete;
    expect(label(panel, 'send')).to.equal('Send');
    expect(part(panel, 'result')).to.not.exist;
    expect(part(panel, 'notice')).to.not.exist;
    expect(part(panel, 'history'), 'transcript cleared').to.not.exist;

    release[0]();
    await frames();
    expect(part(panel, 'result'), 'the old grid turn does not land').to.not.exist;
    expect(part(panel, 'history')).to.not.exist;
    expect(other.getState().sort, 'the new grid is untouched').to.be.empty;
  });
});
