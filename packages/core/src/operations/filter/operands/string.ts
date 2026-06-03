import { isDefined } from '../../../internal/is-defined.js';
import { normalizeCase } from '../../../internal/normalize-case.js';
import type { FilterOperands } from '../types.js';

export type StringKeys =
  | 'contains'
  | 'doesNotContain'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'doesNotEqual'
  | 'empty'
  | 'notEmpty';

export const StringOperands = Object.freeze<FilterOperands<string, StringKeys>>({
  contains: {
    name: 'contains',
    label: 'Contains',
    unary: false,
    logic: (target, term, caseSensitive?) =>
      normalizeCase(target, caseSensitive).includes(normalizeCase(term, caseSensitive)),
  },
  doesNotContain: {
    name: 'doesNotContain',
    label: 'Does not contain',
    unary: false,
    logic: (target, term, caseSensitive?) =>
      !normalizeCase(target, caseSensitive).includes(normalizeCase(term, caseSensitive)),
  },
  startsWith: {
    name: 'startsWith',
    label: 'Starts with',
    unary: false,
    logic: (target, searchTerm, caseSensitive?) =>
      normalizeCase(target, caseSensitive).startsWith(normalizeCase(searchTerm, caseSensitive)),
  },
  endsWith: {
    name: 'endsWith',
    label: 'Ends with',
    unary: false,
    logic: (target, searchTerm, caseSensitive?) =>
      normalizeCase(target, caseSensitive).endsWith(normalizeCase(searchTerm, caseSensitive)),
  },
  equals: {
    name: 'equals',
    label: 'Equals',
    unary: false,
    logic: (target, searchTerm, caseSensitive) =>
      normalizeCase(target, caseSensitive) === normalizeCase(searchTerm, caseSensitive),
  },

  doesNotEqual: {
    name: 'doesNotEqual',
    label: 'Does not equal',
    unary: false,
    logic: (target, searchTerm, caseSensitive) =>
      normalizeCase(target, caseSensitive) !== normalizeCase(searchTerm, caseSensitive),
  },

  empty: {
    name: 'empty',
    label: 'Empty',
    unary: true,
    logic: (target) => !isDefined(target) || target.length < 1,
  },

  notEmpty: {
    name: 'notEmpty',
    label: 'Not empty',
    unary: true,
    logic: (target) => isDefined(target) && target.length > 0,
  },
});
