import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { gridStateContext, type StateController } from '../controllers/state.js';
import { registerComponent } from '../internal/register.js';
import { GRID_GROUP_HEADER_ROW_TAG } from '../internal/tags.js';
import type {
  ApexColumnGroupContext,
  ColumnConfiguration,
  ColumnGroupConfiguration,
} from '../internal/types.js';
import { styles } from '../styles/group-header-row/group-header-row.css.js';

/**
 * Spanning header row rendered above the column header row. Group cells are
 * derived at render time from contiguous runs of same-`group` columns in the
 * display order, split at pin boundaries. Lays out over the same CSS grid tracks
 * as the body (the host applies `grid-template-columns`), spanning members via
 * `grid-column`.
 *
 * @csspart group-header - A spanning group header cell.
 * @csspart group-header-label - The label inside a group header cell.
 * @csspart group-spacer - A placeholder over chrome / ungrouped columns.
 */
export default class ApexGridGroupHeaderRow<T extends object> extends LitElement {
  public static get tagName() {
    return GRID_GROUP_HEADER_ROW_TAG;
  }

  public static override styles = styles;

  public static register(): void {
    registerComponent(ApexGridGroupHeaderRow);
  }

  @consume({ context: gridStateContext, subscribe: true })
  @property({ attribute: false })
  public state!: StateController<T>;

  /** Display-ordered, pin-grouped columns (matches the body track order). */
  @property({ attribute: false })
  public columns: Array<ColumnConfiguration<T>> = [];

  /** Cumulative pin offsets (px) keyed by column key. */
  @property({ attribute: false })
  public pinOffsets: Map<unknown, number> = new Map();

  /** Configured column groups. */
  @property({ attribute: false })
  public groups: ColumnGroupConfiguration[] = [];

  /** Group ids already warned about (non-contiguous), so we warn once each. */
  #warned = new Set<string>();

  public override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'row');
    this.setAttribute('aria-rowindex', '1');
  }

  /** Number of leading chrome columns (selection + expansion). */
  #chromeCount(): number {
    return (
      (this.state?.selection.showCheckboxColumn ? 1 : 0) +
      (this.state?.expansion.showToggleColumn ? 1 : 0)
    );
  }

  protected override render() {
    const groupsById = new Map(this.groups.map((group) => [group.id, group]));
    const visible = this.columns.filter((column) => !column.hidden);
    const chrome = this.#chromeCount();
    const seen = new Set<string>();
    const cells = [];

    let i = 0;
    while (i < visible.length) {
      const column = visible[i];
      const group = column.group ? groupsById.get(column.group) : undefined;
      const startLine = chrome + i + 1;

      if (!group) {
        cells.push(
          html`<div part="group-spacer" style=${styleMap({ gridColumn: `${startLine} / span 1` })}></div>`
        );
        i += 1;
        continue;
      }

      // Extend the run while the next column shares the group id and pin region.
      let end = i;
      while (
        end + 1 < visible.length &&
        visible[end + 1].group === column.group &&
        (visible[end + 1].pinned ?? null) === (column.pinned ?? null)
      ) {
        end += 1;
      }

      // A group whose members aren't contiguous within one pin region shows up
      // as a second run for an id we've already rendered — warn and render the
      // run as a plain spacer rather than a misleading duplicate header.
      if (seen.has(group.id)) {
        if (!this.#warned.has(group.id)) {
          this.#warned.add(group.id);
          // biome-ignore lint/suspicious/noConsole: intentional one-shot misconfiguration diagnostic
          console.warn(
            `[apex-grid] Column group "${group.id}" is not contiguous within a single pin region; its spanning header was skipped for the out-of-place members.`
          );
        }
        for (let k = i; k <= end; k += 1) {
          const line = chrome + k + 1;
          cells.push(
            html`<div part="group-spacer" style=${styleMap({ gridColumn: `${line} / span 1` })}></div>`
          );
        }
        i = end + 1;
        continue;
      }
      seen.add(group.id);

      cells.push(this.#renderGroupCell(group, visible[i], visible[end], startLine, end, chrome));
      i = end + 1;
    }

    return html`${
      chrome > 0
        ? html`<div part="group-spacer" style=${styleMap({ gridColumn: `1 / span ${chrome}` })}></div>`
        : nothing
    }${cells}`;
  }

  #renderGroupCell(
    group: ColumnGroupConfiguration,
    first: ColumnConfiguration<T>,
    last: ColumnConfiguration<T>,
    startLine: number,
    endIndex: number,
    chrome: number
  ) {
    const span = endIndex - (startLine - chrome - 1) + 1;
    const endLine = startLine + span;
    const pinned = first.pinned ?? null;

    const style: Record<string, string> = { gridColumn: `${startLine} / ${endLine}` };
    // Pin the group cell to the edge of its anchoring member so it tracks the
    // frozen column(s) during horizontal scroll.
    if (pinned === 'start') {
      const offset = this.pinOffsets.get(first.key);
      if (typeof offset === 'number') style['--apex-pin-offset'] = `${offset}px`;
    } else if (pinned === 'end') {
      const offset = this.pinOffsets.get(last.key);
      if (typeof offset === 'number') style['--apex-pin-offset'] = `${offset}px`;
    }

    const content = group.headerTemplate
      ? group.headerTemplate({ group, span } as ApexColumnGroupContext)
      : group.headerText;

    return html`<div
      part="group-header"
      role="columnheader"
      aria-colindex=${startLine}
      aria-colspan=${span}
      data-pinned=${pinned ?? 'none'}
      style=${styleMap(style)}
    >
      <span part="group-header-label">${content}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [ApexGridGroupHeaderRow.tagName]: ApexGridGroupHeaderRow<object>;
  }
}
