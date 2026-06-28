import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import {
  type AIAdapter,
  type AIRequest,
  ApexGridEnterprise,
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
];

describe('AI Toolkit — runPrompt orchestration', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  async function mount(adapter: AIAdapter | null): Promise<ApexGridEnterprise<Row>> {
    const grid = await fixture<ApexGridEnterprise<Row>>(html`<apex-grid-enterprise
      .data=${data}
      .columns=${columns}
    ></apex-grid-enterprise>`);
    grid.aiAdapter = adapter;
    await grid.updateComplete;
    await nextFrame();
    return grid;
  }

  it('applies a control patch and exposes a working undo', async () => {
    let seen: AIRequest | null = null;
    const adapter: AIAdapter = async (request) => {
      seen = request;
      return { patch: { sort: [{ key: 'amount', direction: 'descending' }] } };
    };
    const grid = await mount(adapter);

    const result = await grid.runPrompt('sort by amount, highest first');
    await grid.updateComplete;

    expect(seen, 'adapter receives the live schema').to.not.be.null;
    expect((seen as unknown as AIRequest).mode).to.equal('control');
    expect((seen as unknown as AIRequest).schema.columns.map((c) => c.key)).to.include('amount');

    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.result.applied).to.include('sort');
    expect(grid.getState().sort.map((s) => ({ key: s.key, direction: s.direction }))).to.deep.equal(
      [{ key: 'amount', direction: 'descending' }]
    );

    result.undo();
    await grid.updateComplete;
    expect(grid.getState().sort, 'undo restores the prior view').to.be.empty;
  });

  it('answers in ask mode without mutating the grid', async () => {
    const adapter: AIAdapter = async (request) =>
      request.mode === 'ask' ? { answer: 'AMER, with 30' } : { patch: {} };
    const grid = await mount(adapter);

    const result = await grid.runPrompt('which region has the highest amount?', { mode: 'ask' });
    await grid.updateComplete;

    expect(result.mode).to.equal('ask');
    if (result.mode !== 'ask') return;
    expect(result.answer).to.equal('AMER, with 30');
    expect(grid.getState().sort, 'ask mode does not touch state').to.be.empty;
  });

  it('rejects when no adapter is set', async () => {
    const grid = await mount(null);
    let threw = false;
    try {
      await grid.runPrompt('do something');
    } catch (error) {
      threw = true;
      expect(String(error)).to.include('no adapter');
    }
    expect(threw).to.be.true;
  });

  it('sanitizes an adapter patch before applying and reports the drops', async () => {
    const adapter: AIAdapter = async () => ({
      patch: {
        sort: [
          { key: 'amount', direction: 'descending' },
          { key: 'ghost', direction: 'ascending' },
        ],
      },
    });
    const grid = await mount(adapter);

    const result = await grid.runPrompt('sort it');
    await grid.updateComplete;

    expect(result.mode).to.equal('control');
    if (result.mode !== 'control') return;
    expect(result.patch.sort).to.deep.equal([{ key: 'amount', direction: 'descending' }]);
    expect(result.warnings.some((w) => w.includes('unknown column "ghost"'))).to.be.true;
    expect(grid.getState().sort.map((s) => ({ key: s.key, direction: s.direction }))).to.deep.equal(
      [{ key: 'amount', direction: 'descending' }]
    );
  });

  it('undo is idempotent: a second call is a no-op', async () => {
    const adapter: AIAdapter = async () => ({
      patch: { sort: [{ key: 'amount', direction: 'ascending' }] },
    });
    const grid = await mount(adapter);

    const result = await grid.runPrompt('sort');
    if (result.mode !== 'control') throw new Error('expected control');

    result.undo();
    await grid.updateComplete;
    const second = result.undo();
    expect(second.warnings.some((w) => w.includes('already undone'))).to.be.true;
  });
});
