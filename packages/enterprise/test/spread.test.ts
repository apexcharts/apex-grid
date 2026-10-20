import { expect, fixture, fixtureCleanup, html, nextFrame } from '@open-wc/testing';
import type { ColumnConfiguration } from 'apex-grid';
import { computeAggregations } from '../src/features/aggregation.js';
import {
  ConversationMemory,
  createAIEngine,
  createContextBuilder,
  createDefaultRegistry,
  createFakeGridApi,
  createToolExecutor,
  runAnalytics,
} from '../src/features/ai/index.js';
import {
  type CellAddress,
  type CellValue,
  createFunctionRegistry,
  type FormulaEngineHost,
  FormulaStore,
  parseA1,
} from '../src/features/formula/index.js';
import { getGroupMeta } from '../src/features/grouping.js';
import { ApexGridEnterprise, enterpriseModules } from '../src/index.js';
import { type Row as AIRow, enterpriseSchema } from './ai-fixtures.js';

// Spreading an array into call arguments (Math.max(...values), push(...rows))
// throws RangeError past roughly 120k elements. These paths take data-sized
// arrays, so each one runs well past that limit here.
const N = 250_000;

/** Runs `fn`, returning what it threw as a string ('' when nothing). */
function thrownBy(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (error) {
    return String(error);
  }
}

describe('No argument spread over large arrays', () => {
  before(() => {
    ApexGridEnterprise.use(...enterpriseModules);
    ApexGridEnterprise.register();
  });
  afterEach(() => fixtureCleanup());

  describe('aggregation', () => {
    it('computes min, max, sum, avg and count over 250k values', () => {
      const rows = Array.from({ length: N }, (_, i) => ({ amount: i + 1 }));
      let result: ReturnType<typeof computeAggregations> | undefined;
      expect(
        thrownBy(() => {
          result = computeAggregations(rows, { amount: ['min', 'max', 'sum', 'avg', 'count'] });
        })
      ).to.equal('');
      expect(result).to.deep.equal({
        amount: { min: 1, max: N, sum: (N * (N + 1)) / 2, avg: (N + 1) / 2, count: N },
      });
    });

    it('keeps the empty and signed zero results and skips NaN', () => {
      const fns = ['min', 'max', 'sum', 'avg', 'count'] as const;
      const config = { v: [...fns] };
      expect(computeAggregations([], config)).to.deep.equal({
        v: { min: 0, max: 0, sum: 0, avg: 0, count: 0 },
      });
      // A NaN cell is skipped, like the status bar (see grouping-keys.test.ts).
      const withNaN = computeAggregations([{ v: 3 }, { v: Number.NaN }, { v: 1 }], config).v;
      expect(withNaN.min).to.equal(1);
      expect(withNaN.max).to.equal(3);
      const zeros = computeAggregations([{ v: 0 }, { v: -0 }], config).v;
      expect(Object.is(zeros.min, -0)).to.be.true;
      expect(Object.is(zeros.max, 0)).to.be.true;
      // Non-numbers are skipped, as before.
      expect(computeAggregations([{ v: 'x' }, { v: 5 }, { v: null }], config).v).to.deep.equal({
        min: 5,
        max: 5,
        sum: 5,
        avg: 5,
        count: 1,
      });
    });

    it('a total row max over 250k rows reports the max', async () => {
      interface Row {
        id: number;
        amount: number;
      }
      const columns: ColumnConfiguration<Row>[] = [
        { key: 'id', type: 'number' },
        { key: 'amount', type: 'number' },
      ];
      const data = Array.from({ length: N }, (_, id) => ({ id, amount: id }));
      const grid = await fixture<ApexGridEnterprise<Row>>(
        html`<apex-grid-enterprise
          .data=${data}
          .columns=${columns}
          .totalRow=${{ aggregations: { amount: ['min', 'max'] } }}
        ></apex-grid-enterprise>`
      );
      await grid.updateComplete;
      expect(grid.getTotals()).to.deep.equal({ amount: { min: 0, max: N - 1 } });
    });
  });

  describe('grouping', () => {
    it('renders a group of 125k leaves (default expanded)', async () => {
      interface Row {
        id: number;
        status: string;
      }
      const data: Row[] = Array.from({ length: N }, (_, i) => ({
        id: i,
        status: i % 2 ? 'open' : 'closed',
      }));
      const errors: string[] = [];
      const onError = (event: ErrorEvent) => {
        errors.push(String(event.error ?? event.message));
        event.preventDefault();
      };
      window.addEventListener('error', onError);
      let grid: ApexGridEnterprise<Row> | undefined;
      try {
        grid = await fixture<ApexGridEnterprise<Row>>(
          html`<apex-grid-enterprise
            .data=${data}
            .columns=${[{ key: 'id' }, { key: 'status' }]}
            .groupBy=${['status']}
            .aggregations=${{ id: ['min', 'max'] }}
          ></apex-grid-enterprise>`
        );
        await grid.updateComplete.catch((error: unknown) => errors.push(String(error)));
        await nextFrame();
      } catch (error) {
        errors.push(String(error));
      } finally {
        window.removeEventListener('error', onError);
      }
      expect(errors).to.deep.equal([]);
      const items = (grid?.dataView ?? []) as readonly Row[];
      expect(items.length).to.equal(N + 2);
      const headers = items.map((row) => getGroupMeta<Row>(row)).filter((meta) => meta);
      expect(headers.map((meta) => [meta?.count, meta?.aggregates])).to.deep.equal([
        [N / 2, { id: { min: 0, max: N - 2 } }],
        [N / 2, { id: { min: 1, max: N - 1 } }],
      ]);
    });
  });

  describe('AI', () => {
    const big: AIRow[] = Array.from({ length: N }, (_, i) => ({
      region: 'EMEA',
      product: `P${i}`,
      amount: i + 1,
    }));

    it('runAnalytics answers min, max and range over 250k rows', () => {
      let result: ReturnType<typeof runAnalytics> | undefined;
      expect(
        thrownBy(() => {
          result = runAnalytics(
            { kind: 'aggregate', metrics: ['min', 'max', 'range'], column: 'amount' },
            big,
            enterpriseSchema
          );
        })
      ).to.equal('');
      expect(result?.metrics?.map((metric) => metric.value)).to.deep.equal([1, N, N - 1]);
    });

    it('runPrompt answers a max question over 250k rows', async () => {
      const api = createFakeGridApi<AIRow>({ schema: enterpriseSchema, data: big });
      const result = await createAIEngine<AIRow>(api).runPrompt('what is the maximum amount');
      expect(result.mode).to.equal('ask');
      expect(result.mode === 'ask' ? result.answer : '').to.contain(String(N));
    });

    it('the answer tool reports the highest and lowest over 250k rows', () => {
      const api = createFakeGridApi<AIRow>({ schema: enterpriseSchema, data: big });
      const executor = createToolExecutor(createDefaultRegistry());
      const ask = (question: string) => {
        let answer: string | undefined;
        const error = thrownBy(() => {
          answer = executor.run(
            {
              mode: 'control',
              steps: [{ tool: 'answer', args: { question } }],
              confidence: 1,
              source: 'test',
            },
            { api, ctx: createContextBuilder<AIRow>().build(api, new ConversationMemory()) }
          ).answer;
        });
        return error || answer;
      };
      expect(ask('what is the highest amount?')).to.equal(`The highest Amount is ${N}.`);
      expect(ask('what is the lowest amount?')).to.equal('The lowest Amount is 1.');
    });
  });

  describe('formulas', () => {
    function makeStore(rows: number) {
      const cells: CellValue[][] = Array.from({ length: rows }, (_, i) => [i + 1, null]);
      const host: FormulaEngineHost = {
        readValue: ({ row, col }) => cells[row]?.[col] ?? null,
        writeValue: ({ row, col }, value) => {
          if (cells[row]) cells[row][col] = value;
        },
        isValidAddress: ({ row, col }) => row >= 0 && row < rows && col >= 0 && col < 2,
        functions: createFunctionRegistry(),
      };
      return { cells, store: new FormulaStore(host) };
    }
    const at = (a1: string) => parseA1(a1) as CellAddress;

    it('SUM, COUNT, MIN and MAX over a 250k cell range return a value', () => {
      const { cells, store } = makeStore(N);
      const results: Record<string, unknown> = {};
      for (const fn of ['SUM', 'COUNT', 'MIN', 'MAX']) {
        const error = thrownBy(() => store.set(at('B1'), `=${fn}(A1:A${N})`));
        results[fn] = error || cells[0][1];
      }
      expect(results).to.deep.equal({ SUM: (N * (N + 1)) / 2, COUNT: N, MIN: 1, MAX: N });
    });

    it('MIN and MAX of a range with no numbers still return 0', () => {
      const { cells, store } = makeStore(4);
      store.set(at('B1'), '=MIN(B2:B4)');
      expect(cells[0][1]).to.equal(0);
      store.set(at('B1'), '=MAX(B2:B4)');
      expect(cells[0][1]).to.equal(0);
    });
  });
});
