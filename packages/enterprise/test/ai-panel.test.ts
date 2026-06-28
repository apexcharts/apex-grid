import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  ApexGridAI,
  ApexGridEnterprise,
  createMockAdapter,
  enterpriseModules,
} from '../src/index.js';

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
    if (panel.renderRoot.querySelector('[part="result"], [part="error"]')) return;
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

  async function mount(
    withAdapter: boolean
  ): Promise<{ grid: ApexGridEnterprise<Row>; panel: ApexGridAI }> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    if (withAdapter) grid.aiAdapter = createMockAdapter();
    await grid.updateComplete;
    const panel = await fixture<ApexGridAI>(
      html`<apex-grid-ai .grid=${grid} mode="inline"></apex-grid-ai>`
    );
    await panel.updateComplete;
    return { grid, panel };
  }

  it('shows a notice and disables send when no adapter is set', async () => {
    const { panel } = await mount(false);
    expect(part(panel, 'notice'), 'no-adapter notice').to.exist;
    expect(part<HTMLButtonElement>(panel, 'send')?.disabled).to.be.true;
  });

  it('control mode applies a patch and reports what changed', async () => {
    const { grid, panel } = await mount(true);
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
    const { grid, panel } = await mount(true);
    await type(panel, 'sort by amount descending');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    expect(grid.getState().sort).to.have.lengthOf(1);

    part<HTMLButtonElement>(panel, 'undo')?.click();
    for (let i = 0; i < 10; i++) await nextFrame();
    expect(grid.getState().sort, 'undo cleared the sort').to.be.empty;
  });

  it('ask mode answers without mutating the grid', async () => {
    const { grid, panel } = await mount(true);
    // switch to ask mode (second mode button)
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

  it('surfaces a thrown adapter error', async () => {
    const { grid, panel } = await mount(false);
    grid.aiAdapter = async () => {
      throw new Error('boom from adapter');
    };
    await panel.updateComplete;
    await type(panel, 'do something');
    part<HTMLButtonElement>(panel, 'send')?.click();
    await waitForResult(panel);
    expect(part(panel, 'error')?.textContent).to.contain('boom from adapter');
  });
});
