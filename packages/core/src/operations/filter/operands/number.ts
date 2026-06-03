import { isDefined } from '../../../internal/is-defined.js';
import type { FilterOperands } from '../types.js';

export type NumberKeys =
  | 'equals'
  | 'doesNotEqual'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'empty'
  | 'notEmpty';

export const NumberOperands = Object.freeze<FilterOperands<number, NumberKeys>>({
  equals: {
    name: 'equals',
    label: 'Equals',
    unary: false,
    logic: (target, term) => target === term,
  },
  doesNotEqual: {
    name: 'doesNotEqual',
    label: 'Does not equal',
    unary: false,
    logic: (target, term) => target !== term,
  },
  greaterThan: {
    name: 'greaterThan',
    label: 'Greater than',
    unary: false,
    logic: (target, term) => target > term,
  },
  lessThan: {
    name: 'lessThan',
    label: 'Less than',
    unary: false,
    logic: (target, term) => target < term,
  },
  greaterThanOrEqual: {
    name: 'greaterThanOrEqual',
    label: 'Greater than or equal',
    unary: false,
    logic: (target, term) => target >= term,
  },
  lessThanOrEqual: {
    name: 'lessThanOrEqual',
    label: 'Less than or equal',
    unary: false,
    logic: (target, term) => target <= term,
  },
  empty: {
    name: 'empty',
    label: 'Empty',
    unary: true,
    logic: (target) => !isDefined(target) || Number.isNaN(target),
  },
  notEmpty: {
    name: 'notEmpty',
    label: 'Not empty',
    unary: true,
    logic: (target) => isDefined(target) && !Number.isNaN(target),
  },
});
