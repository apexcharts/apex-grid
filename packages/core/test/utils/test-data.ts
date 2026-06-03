import type { SortComparer } from '../../src/operations/sort/types.js';

type Importance = 'low' | 'medium' | 'high';

const importanceOrdering = ['low', 'medium', 'high'] as const;
export const importanceComparer: SortComparer<TestData, 'importance'> = (a, b) =>
  importanceOrdering.indexOf(a) - importanceOrdering.indexOf(b);

export interface TestData {
  id: number;
  name: string;
  active: boolean;
  importance: Importance;
}

export default [
  { id: 1, name: 'A', active: false, importance: 'medium' },
  { id: 2, name: 'B', active: false, importance: 'low' },
  { id: 3, name: 'C', active: true, importance: 'medium' },
  { id: 4, name: 'D', active: false, importance: 'low' },
  { id: 5, name: 'a', active: true, importance: 'high' },
  { id: 6, name: 'b', active: false, importance: 'medium' },
  { id: 7, name: 'c', active: true, importance: 'low' },
  { id: 8, name: 'd', active: true, importance: 'high' },
] as TestData[];
