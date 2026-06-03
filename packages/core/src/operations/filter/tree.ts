import type { Keys } from '../../internal/types.js';
import type { FilterExpression } from './types.js';

export class FilterExpressionTree<T> {
  protected operands: Array<FilterExpression<T>> = [];

  constructor(public key: Keys<T>) {}

  public get empty() {
    return this.operands.length < 1;
  }

  public get length() {
    return this.operands.length;
  }

  public get all() {
    return Array.from(this.iterator());
  }

  public get ands() {
    return this.operands.filter((each) => each.criteria === 'and');
  }

  public get ors() {
    return this.operands.filter((each) => each.criteria === 'or');
  }

  public has(expression: FilterExpression<T>) {
    return this.operands.includes(expression);
  }

  public add(expression: FilterExpression<T>) {
    if (!expression.criteria) {
      expression.criteria = 'and';
    }

    if (!this.has(expression)) {
      this.operands.push(expression);
    }

    return this;
  }

  public remove(expression: FilterExpression<T>) {
    this.operands = this.operands.filter((each) => each !== expression);
    return this;
  }

  protected *iterator() {
    for (const operand of this.operands) {
      yield operand;
    }
  }

  public [Symbol.iterator]() {
    return this.iterator();
  }
}
