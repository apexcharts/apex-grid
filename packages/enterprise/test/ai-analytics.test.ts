import { expect } from '@open-wc/testing';
import {
  type AnalyticsQuery,
  createAIEngine,
  createEntityResolver,
  createIntentDetector,
  formatAnalyticsAnswer,
  runAnalytics,
} from '../src/features/ai/index.js';
import { enterpriseSchema, makeApi, makeContext, type Row, rows } from './ai-fixtures.js';

/** Run a query over the fixture rows and format it, as the tool does. */
const say = (query: AnalyticsQuery): string =>
  formatAnalyticsAnswer(runAnalytics(query, rows, enterpriseSchema), enterpriseSchema);

describe('AI analytics — executor + formatter', () => {
  it('aggregate: computes every requested metric (fixes the first-match bug)', () => {
    expect(
      say({ kind: 'aggregate', metrics: ['min', 'max', 'median'], column: 'amount' })
    ).to.equal('Amount: minimum 10; maximum 30; median 20.');
  });

  it('aggregate: a single metric reads as a sentence', () => {
    expect(say({ kind: 'aggregate', metrics: ['avg'], column: 'amount' })).to.equal(
      'The average Amount is 20.'
    );
  });

  it('aggregate: distinct count of a categorical column', () => {
    expect(say({ kind: 'aggregate', metrics: ['distinct'], column: 'region' })).to.equal(
      'There are 3 distinct Region values.'
    );
  });

  it('aggregate: a plain row count needs no column', () => {
    expect(say({ kind: 'aggregate', metrics: ['count'] })).to.equal('There are 3 rows.');
  });

  it('computes range and stddev', () => {
    const result = runAnalytics(
      { kind: 'aggregate', metrics: ['range', 'stddev'], column: 'amount' },
      rows,
      enterpriseSchema
    );
    expect(result.metrics?.[0]).to.deep.equal({ func: 'range', value: 20 });
    expect(result.metrics?.[1]?.value).to.be.closeTo(8.165, 0.01);
  });

  it('group: lists a metric per group', () => {
    expect(say({ kind: 'group', metrics: ['sum'], column: 'amount', groupBy: 'region' })).to.equal(
      'Total Amount by Region: EMEA 10; AMER 30; APAC 20.'
    );
  });

  it('group: ranked returns the winning group', () => {
    expect(
      say({
        kind: 'group',
        metrics: ['avg'],
        column: 'amount',
        groupBy: 'region',
        direction: 'top',
        limit: 1,
      })
    ).to.equal('AMER has the highest average Amount (30).');
  });

  it('rank: a superlative returns the row, not just the number', () => {
    expect(
      say({
        kind: 'rank',
        metrics: [],
        column: 'amount',
        direction: 'top',
        limit: 1,
        labelColumn: 'product',
      })
    ).to.equal('B has the highest Amount (30).');
  });

  it('rank: bottom N lists the rows', () => {
    expect(
      say({
        kind: 'rank',
        metrics: [],
        column: 'amount',
        direction: 'bottom',
        limit: 2,
        labelColumn: 'product',
      })
    ).to.equal('Bottom 2 by Amount: A 10; C 20.');
  });

  it('scope: filters rows before computing', () => {
    expect(
      say({
        kind: 'aggregate',
        metrics: ['sum'],
        column: 'amount',
        where: [{ key: 'region', operand: 'equals', value: 'EMEA' }],
      })
    ).to.equal('The total Amount is 10 (Region = EMEA).');
  });

  it('guards a non-numeric measure', () => {
    expect(say({ kind: 'aggregate', metrics: ['avg'], column: 'region' })).to.contain(
      'could not compute'
    );
  });

  it('guards empty data', () => {
    expect(
      formatAnalyticsAnswer(
        runAnalytics(
          { kind: 'aggregate', metrics: ['sum'], column: 'amount' },
          [],
          enterpriseSchema
        ),
        enterpriseSchema
      )
    ).to.equal('There is no data to analyze.');
  });
});

describe('AI analytics — detection + resolution (rule engine)', () => {
  const detector = createIntentDetector();
  const resolver = createEntityResolver();
  const parse = (utterance: string) => {
    const ctx = makeContext(makeApi());
    const intent = detector.detect(utterance, ctx);
    return { kind: intent.kind, query: resolver.resolve(intent, ctx).query };
  };

  it('classifies analytical questions as analyze', () => {
    expect(parse('find the min, max, median of amount').kind).to.equal('analyze');
    expect(parse('average amount by region').kind).to.equal('analyze');
    expect(parse('who has the highest amount').kind).to.equal('analyze');
    expect(parse('top 2 by amount').kind).to.equal('analyze');
    expect(parse('how many distinct regions are there').kind).to.equal('analyze');
  });

  it('does not steal control commands that share keywords', () => {
    expect(parse('sort by amount descending').kind).to.equal('sort');
    expect(parse('group by region').kind).to.equal('group');
    expect(parse('filter amount > 100').kind).to.equal('filter');
  });

  it('resolves a multi-metric aggregate', () => {
    const { query } = parse('find the min, max, median of amount');
    expect(query?.kind).to.equal('aggregate');
    expect(query?.metrics).to.deep.equal(['min', 'max', 'median']);
    expect(query?.column).to.equal('amount');
  });

  it('resolves a grouped aggregate', () => {
    const { query } = parse('average amount by region');
    expect(query?.kind).to.equal('group');
    expect(query?.metrics).to.deep.equal(['avg']);
    expect(query?.column).to.equal('amount');
    expect(query?.groupBy).to.equal('region');
    expect(query?.direction).to.equal(undefined);
  });

  it('resolves a superlative to a ranked row', () => {
    const { query } = parse('who has the highest amount');
    expect(query?.kind).to.equal('rank');
    expect(query?.column).to.equal('amount');
    expect(query?.direction).to.equal('top');
    expect(query?.limit).to.equal(1);
  });

  it('treats "highest total" as sum ranked, not max', () => {
    const { query } = parse('which region has the highest total amount');
    expect(query?.kind).to.equal('group');
    expect(query?.metrics).to.deep.equal(['sum']);
    expect(query?.groupBy).to.equal('region');
    expect(query?.direction).to.equal('top');
  });
});

describe('AI analytics — end-to-end via the engine (no LLM, read-only)', () => {
  it('answers a multi-metric question and never mutates the grid', async () => {
    const api = makeApi();
    const result = await createAIEngine<Row>(api).runPrompt('find the min, max, median of amount');
    expect(result.mode).to.equal('ask');
    if (result.mode !== 'ask') return;
    expect(result.answer).to.equal('Amount: minimum 10; maximum 30; median 20.');
    expect(api.calls, 'analytics must not mutate the grid').to.be.empty;
  });

  it('answers a grouped aggregate', async () => {
    const result = await createAIEngine<Row>(makeApi()).runPrompt('average amount by region');
    if (result.mode !== 'ask') throw new Error('expected ask');
    expect(result.answer).to.equal('Average Amount by Region: EMEA 10; AMER 30; APAC 20.');
  });

  it('answers a superlative comparison', async () => {
    const result = await createAIEngine<Row>(makeApi()).runPrompt(
      'which region has the highest total amount'
    );
    if (result.mode !== 'ask') throw new Error('expected ask');
    expect(result.answer).to.equal('AMER has the highest total Amount (30).');
  });
});
