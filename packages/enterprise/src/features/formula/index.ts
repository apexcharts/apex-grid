/**
 * Public surface of the formula engine. F1 (engine: parser, evaluator,
 * functions, value model) and F2 (reference model) land here first as pure,
 * self-contained modules. Later cycles (F3 recalc, F4 editor, F5 wiring) build
 * on this barrel and the package's `index.ts` re-exports the user-facing parts.
 */

// Value model + error values (F1).
export {
  type CellValue,
  cycleError,
  divZeroError,
  FormulaError,
  type FormulaErrorCode,
  firstError,
  isFormulaError,
  nameError,
  ParseError,
  refError,
  toBoolean,
  toNumber,
  toText,
  valueError,
} from './errors.js';

// Evaluator (F1).
export { evaluate, type FormulaContext } from './evaluator.js';

// Function registry (F1).
export {
  BUILTIN_FUNCTION_NAMES,
  createFunctionRegistry,
  type FormulaFn,
} from './functions.js';

// Parser + AST (F1).
export {
  type BinaryNode,
  type BinaryOperator,
  type BooleanLiteralNode,
  type CallNode,
  type FormulaAst,
  formulaReferences,
  type NumberLiteralNode,
  parseFormula,
  type RangeNode,
  type ReferenceNode,
  type RefList,
  type StringLiteralNode,
  type UnaryNode,
  type UnaryOperator,
} from './parser.js';

// Reference model (F2).
export {
  buildColumnLetters,
  type CellAddress,
  type ColumnLetterMaps,
  columnLetterToIndex,
  formatA1,
  formatCell,
  indexToColumnLetter,
  isRangeAddress,
  normalizeRange,
  parseA1,
  type RangeAddress,
  rangeCells,
} from './refs.js';

// Store + dependency graph + recalc (F3).
export {
  FORMULA_MODULE_ID,
  FormulaController,
  type FormulaEngineHost,
  FormulaStore,
  formulaModule,
  type RecalcChange,
} from './store.js';
