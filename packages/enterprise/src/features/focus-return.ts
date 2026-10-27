/**
 * Focus return for the overlays that take focus from the grid (the context
 * menu, the AI dialog, the chart dialog) and put it back when they close.
 *
 * Any other element gets focus back as it was. A grid body cell is a slot,
 * not a record: a sort or a scroll while the overlay is open can move the
 * cell's record to another row, or leave the same element showing another
 * record at another index. So a body cell is remembered by its address (its
 * row index and column) and focus only goes back to it while it still stands
 * at that address. Otherwise focus returns through the grid body, which hands
 * it to the active cell when that row is rendered and keeps it otherwise.
 * A cell still at its address is focused as before, which scrolls it back
 * into view when the grid moved while the overlay was open. The body path
 * does not scroll: the record it stood for may be anywhere by then.
 */

/** The parts of a body cell, and of its row, the return reads. */
interface BodyCell extends HTMLElement {
  column?: { key?: unknown };
  row?: HTMLElement & { index?: number };
}

/** Where focus was before an overlay took it. */
export interface FocusReturn {
  element: HTMLElement;
  /** Set when `element` is a grid body cell: the address it stood for and the body it is in. */
  cell?: { body: HTMLElement; row: number; column: unknown };
}

/** Whether `cell` is a body cell (not a pinned one) and, if so, the body it sits in. */
function bodyOf(cell: BodyCell): HTMLElement | null {
  if (cell.localName !== 'apex-grid-cell') return null;
  const body = cell.row?.parentElement;
  return body?.localName === 'apex-virtualizer' ? body : null;
}

/** Capture the deepest focused element across shadow roots, or null when nothing is focused. */
export function captureFocus(): FocusReturn | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  const cell = el as BodyCell;
  const body = bodyOf(cell);
  if (!body || cell.row?.index === undefined) return { element: el };
  return { element: el, cell: { body, row: cell.row.index, column: cell.column?.key } };
}

/** Put focus back where {@link captureFocus} found it (see the module comment). */
export function returnFocus(origin: FocusReturn | null): void {
  if (!origin) return;
  const { element, cell } = origin;
  if (!cell) {
    if (element.isConnected && typeof element.focus === 'function') element.focus();
    return;
  }
  const at = element as BodyCell;
  if (
    element.isConnected &&
    bodyOf(at) === cell.body &&
    at.row?.index === cell.row &&
    at.column?.key === cell.column
  ) {
    element.focus();
    return;
  }
  // The body forwards focus to the active cell when it is rendered (the
  // grid's own tab-in path), and keeps it when it is not.
  if (cell.body.isConnected) cell.body.focus({ preventScroll: true });
}
