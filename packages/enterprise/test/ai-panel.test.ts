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
