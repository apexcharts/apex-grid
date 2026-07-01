import type ApexFilterRow from '../../src/components/filter-row.js';
import type ApexGridHeader from '../../src/components/header.js';
import type ApexGridHeaderRow from '../../src/components/header-row.js';
import type { Keys } from '../../src/internal/types.js';
import type { OperandKeys } from '../../src/operations/filter/types.js';

export default class FilterRowFixture<T extends object> {
  constructor(
    public element: ApexFilterRow<T>,
    private headerRow?: ApexGridHeaderRow<T>
  ) {}

  /** Find the ApexGridHeader element for a given column key. */
  private getHeader(key: Keys<T>): ApexGridHeader<T> | undefined {
    return this.headerRow?.headers.find((h) => h.column.key === key);
  }

  /** Click the filter icon button inside the given column header. */
  public open(key: Keys<T>) {
    const header = this.getHeader(key);
    if (!header) throw new Error(`No header found for column key "${String(key)}"`);
    const btn = header.shadowRoot!.querySelector<HTMLElement>('[part~="filter-btn"]');
    if (!btn) throw new Error(`No filter button found in header for column "${String(key)}"`);
    btn.click();
  }

  public get active() {
    return this.element.active;
  }

  public get activeStateChips(): HTMLElement[] {
    return Array.from(
      this.element.shadowRoot!.querySelectorAll('[part~="chips-row"] [part~="expression-chip"]')
    );
  }

  public get activeCriteriaButtons(): HTMLElement[] {
    return Array.from(
      this.element.shadowRoot!.querySelectorAll('[part~="chips-row"] button[part~="criteria"]')
    );
  }

  public get input() {
    return this.element.input;
  }

  public get dropdownTarget() {
    return this.element.conditionElement;
  }

  public get dropdown() {
    return this.element.dropdown;
  }

  public get resetButton() {
    return this.element.shadowRoot!.querySelector('#reset') as HTMLElement;
  }

  public get closeButton() {
    return this.element.shadowRoot!.querySelector('#close') as HTMLElement;
  }

  public get dropdownItems() {
    return Array.from(this.dropdown.querySelectorAll<HTMLElement>('[part~="dropdown-item"]'));
  }

  public openDropdown() {
    this.dropdownTarget.click();
  }

  public selectDropdownCondition(name: OperandKeys<T[keyof T]>) {
    this.dropdownItems.find((item) => item.dataset.value === name)?.click();
  }

  public fireInputEvent(value: string) {
    this.input.value = value;
    this.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  public commitInput() {
    this.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }

  public resetInput() {
    this.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }

  public close() {
    this.closeButton.click();
  }

  public reset() {
    this.resetButton.click();
  }
}
