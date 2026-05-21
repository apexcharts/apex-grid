import { createContext } from '@lit/context';
import type { ReactiveController } from 'lit';
import type { ActiveNode, GridHost } from '../internal/types.js';
import { EditingController } from './editing.js';
import { FilterController } from './filter.js';
import { NavigationController } from './navigation.js';
import { PaginationController } from './pagination.js';
import { ReorderController } from './reorder.js';
import { ResizeController } from './resize.js';
import { SelectionController } from './selection.js';
import { SortController } from './sort.js';

export class StateController<T extends object> implements ReactiveController {
  public sorting!: SortController<T>;
  public filtering!: FilterController<T>;
  public navigation!: NavigationController<T>;
  public resizing!: ResizeController<T>;
  public pagination!: PaginationController<T>;
  public reordering!: ReorderController<T>;
  public editing!: EditingController<T>;
  public selection!: SelectionController<T>;

  public get active() {
    return this.navigation.active;
  }

  public set active(node: ActiveNode<T>) {
    this.navigation.active = node;
  }

  public get headerRow() {
    // @ts-expect-error - Protected member access
    return this.host.headerRow;
  }

  public get scrollContainer() {
    // @ts-expect-error - Protected member access
    return this.host.scrollContainer;
  }

  public get paginator() {
    // @ts-expect-error - Protected member access
    return this.host.paginator;
  }

  public get toolbar() {
    // @ts-expect-error - Protected member access
    return this.host.toolbar;
  }

  /**
   * Cumulative pin offsets (in px) keyed by column key. Populated by the
   * {@link GridDOMController} after each layout.
   */
  public get pinOffsets(): Map<unknown, number> {
    // @ts-expect-error - Protected member access
    const dom = this.host.DOM as { pinOffsets?: Map<unknown, number> } | undefined;
    return dom?.pinOffsets ?? new Map();
  }

  constructor(public host: GridHost<T>) {
    this.host.addController(this);
    this.init();
  }

  protected init() {
    this.sorting = new SortController(this.host);
    this.filtering = new FilterController(this.host);
    this.navigation = new NavigationController(this.host);
    this.resizing = new ResizeController(this.host);
    this.pagination = new PaginationController(this.host);
    this.reordering = new ReorderController(this.host);
    this.editing = new EditingController(this.host);
    this.selection = new SelectionController(this.host);
  }

  public hostConnected() {}

  public hostUpdate(): void {
    this.headerRow?.requestUpdate();
    this.scrollContainer?.requestUpdate();
    this.paginator?.requestUpdate();
    this.toolbar?.requestUpdate();
  }
}

export const gridStateContext = createContext<StateController<any>>('gridStateController');
