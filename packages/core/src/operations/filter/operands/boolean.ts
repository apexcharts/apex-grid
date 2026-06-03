import { isDefined } from '../../../internal/is-defined.js';
import type { FilterOperands } from '../types.js';

export type BooleanKeys = 'all' | 'true' | 'false' | 'empty' | 'notEmpty';

export const BooleanOperands = Object.freeze<FilterOperands<boolean, BooleanKeys>>({
  all: {
    name: 'all',
    label: 'All',
    unary: true,
    logic: (_) => true,
  },
  true: {
    name: 'true',
    label: 'True',
    unary: true,
    logic: (target) => target === true,
  },
  false: {
    name: 'false',
    label: 'False',
    unary: true,
    logic: (target) => target === false,
  },
  empty: {
    name: 'empty',
    label: 'Empty',
    unary: true,
    logic: (target) => !isDefined(target),
  },
  notEmpty: {
    name: 'notEmpty',
    label: 'Not empty',
    unary: true,
    logic: (target) => isDefined(target),
  },
});
