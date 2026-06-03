import { LitVirtualizer } from '@lit-labs/virtualizer/LitVirtualizer.js';
import { registerComponent } from '../internal/register.js';
import { GRID_BODY } from '../internal/tags.js';

export default class ApexVirtualizer extends LitVirtualizer {
  public static get tagName() {
    return GRID_BODY;
  }

  public static register(): void {
    registerComponent(ApexVirtualizer);
  }

  // The virtualizer used to own vertical scrolling, which made it a scroll container
  // and broke `position: sticky` for body cells in pinned columns (cells would anchor
  // to the virtualizer instead of the horizontally-scrolling grid host). With
  // `scroller = false` the grid host owns both axes, so headers and pinned body cells
  // share a single sticky containing block.
  public override scroller = false;

  public override async connectedCallback() {
    await super.layoutComplete;

    super.connectedCallback();
    this.setAttribute('tabindex', '0');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexVirtualizer.tagName]: ApexVirtualizer;
  }
}
