import type ApexGridHeader from '../../src/components/header.js';

const DEFAULT_ARGS: PointerEventInit = { pointerId: 1, bubbles: true, composed: true };

export default class HeaderTestFixture<T extends object> {
  constructor(public element: ApexGridHeader<T>) {}

  protected get(selector: string) {
    return this.element.shadowRoot!.querySelector(selector) as HTMLElement;
  }

  protected get contentPart() {
    return this.get('[part~="content"]');
  }

  protected get actionsPart() {
    return this.get('[part~="actions"]');
  }

  public get sortPart() {
    return this.actionsPart.querySelector('[part~="action"]')! as HTMLElement;
  }

  public get resizePart() {
    return this.get('[part~="resizable"]');
  }

  public get titlePart() {
    return this.get('[part~="title"]');
  }

  public get sortIcon() {
    const svg = this.sortPart.querySelector('svg');
    if (!svg) return null as unknown as { name: string };
    // The sort affordance is a stacked up/down chevron; the active direction is
    // reflected on the sort button via `data-sort-active`. Map it back to the
    // legacy icon names the sort specs assert on.
    const direction = this.sortPart.getAttribute('data-sort-active') ?? '';
    const name =
      direction === 'ascending'
        ? 'arrow-upward'
        : direction === 'descending'
          ? 'arrow-downward'
          : '';
    return { name };
  }

  public get isSorted() {
    return this.sortPart.part.contains('sorted');
  }

  public get hasFilterStyle() {
    return this.element.part.contains('filtered');
  }

  public get text() {
    return this.contentPart.textContent?.trim();
  }

  public startResize() {
    this.resizePart.dispatchEvent(new PointerEvent('pointerdown', DEFAULT_ARGS));
  }

  public stopResize() {
    this.resizePart.dispatchEvent(new PointerEvent('pointerup', DEFAULT_ARGS));
    this.resizePart.dispatchEvent(new PointerEvent('lostpointercapture', DEFAULT_ARGS));
  }

  public resize(x: number) {
    this.resizePart.dispatchEvent(
      new PointerEvent('pointermove', {
        ...DEFAULT_ARGS,
        clientX: this.element.getBoundingClientRect().left + this.element.offsetWidth + x,
      })
    );
  }

  public autosize() {
    this.resizePart.dispatchEvent(new Event('dblclick', DEFAULT_ARGS));
  }

  public sort() {
    this.sortPart.click();
  }
}
