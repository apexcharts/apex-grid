import { expect } from '@open-wc/testing';
import {
  type CellValue,
  createFunctionRegistry,
  type FormulaEngineHost,
  FormulaStore,
} from '../src/features/formula/index.js';

/** An in-memory engine host for the pure store. */
function memoryHost(rows: number, cols: number) {
  const cells: CellValue[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => (r + 1) as CellValue)
  );
  const host: FormulaEngineHost = {
    readValue: ({ row, col }) => cells[row]?.[col] ?? null,
    writeValue: ({ row, col }, value) => {
      if (cells[row]) cells[row][col] = value;
    },
    isValidAddress: ({ row, col }) => row >= 0 && row < rows && col >= 0 && col < cols,
    functions: createFunctionRegistry(),
  };
  return { cells, host };
}

/** Count Set.prototype.add calls made while `run` executes. */
function countSetAdds(run: () => void): number {
  const original = Set.prototype.add;
  let adds = 0;
  Set.prototype.add = function (this: Set<unknown>, value: unknown) {
    adds += 1;
    return original.call(this, value);
  } as typeof Set.prototype.add;
  try {
    run();
  } finally {
    Set.prototype.add = original;
  }
  return adds;
}

describe('formula store (audit batch B15)', () => {
  // --- range precedents are indexed, not expanded (ent-formula-store-5) -------

  describe('range precedents', () => {
    it('share-of-total filled down builds a graph linear in rows', () => {
      const N = 1000;
      const { cells, host } = memoryHost(N, 2);
      const store = new FormulaStore(host);
      const adds = countSetAdds(() => {
        for (let i = 0; i < N; i++) {
          store.set({ row: i, col: 1 }, `=A${i + 1}/SUM($A$1:$A$${N})`);
        }
      });
      expect(cells[0][1]).to.be.closeTo(1 / ((N * (N + 1)) / 2), 1e-12);
      expect(adds).to.be.below(20 * N);

      // An edit inside the range still reaches every dependent.
      cells[0][0] = 1 + (N * (N + 1)) / 2;
      store.recalc([{ row: 0, col: 0 }], false);
      expect(cells[1][1]).to.be.closeTo(2 / (N * (N + 1)), 1e-12);
    });

    it('a SUM over 100k rows registers a constant number of keys', () => {
      const N = 100_000;
      const { cells, host } = memoryHost(N, 2);
      const store = new FormulaStore(host);
      const adds = countSetAdds(() => {
        store.set({ row: 0, col: 1 }, `=SUM(A1:A${N})`);
      });
      expect(cells[0][1]).to.equal((N * (N + 1)) / 2);
      expect(adds).to.be.below(50);
    });

    it('orders a chain that runs through ranges and detects a cycle through one', () => {
      const { cells, host } = memoryHost(4, 3);
      const store = new FormulaStore(host);
      store.set({ row: 0, col: 1 }, '=A1*2'); // B1 = 2
      store.set({ row: 1, col: 1 }, '=SUM(B1:B1)+1'); // B2 = 3
      store.set({ row: 0, col: 2 }, '=SUM(B1:B2)'); // C1 = 5
      expect(cells[0][2]).to.equal(5);
      cells[0][0] = 10;
      store.recalc([{ row: 0, col: 0 }], false);
      expect(cells[0][1]).to.equal(20);
      expect(cells[1][1]).to.equal(21);
      expect(cells[0][2]).to.equal(41);

      store.set({ row: 2, col: 2 }, '=SUM(C1:C3)');
      expect(String((cells[2][2] as { code?: string }).code)).to.equal('#CYCLE!');
      store.clear({ row: 2, col: 2 });
      store.set({ row: 3, col: 2 }, '=SUM(B1:B4)');
      expect(cells[3][2]).to.equal(20 + 21 + 3 + 4);
    });
  });
});
