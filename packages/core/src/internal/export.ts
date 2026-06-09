import type { ApexGrid } from '../components/grid.js';
import type { ColumnConfiguration, ColumnDateFormat, Keys } from './types.js';
import { getDisplayColumns } from './utils.js';

/**
 * Primitive cell values supported by the export pipeline.
 *
 * @remarks
 * Returned by the default formatter and accepted from user-supplied formatters.
 * `Date` is preserved (not stringified) so that XLSX export can write it as a
 * native date cell instead of inline text.
 */
export type ExportCellValue = string | number | boolean | Date | null | undefined;

/**
 * Which row set should drive the export.
 *
 * - `'view'` (default) — post-filter, post-sort rows across all pages.
 * - `'all'` — the raw `data` array as supplied by the consumer.
 * - `'page'` — only the rows in the current page slice.
 * - `'selected'` — the current row selection (insertion order).
 */
export type ExportSource = 'view' | 'all' | 'page' | 'selected';

/**
 * Options shared by all export targets.
 */
export interface ExportOptions<T extends object> {
  /** Output filename, without extension. Defaults to `'data'`. */
  filename?: string;
  /** Row set to export. Defaults to `'view'`. */
  source?: ExportSource;
  /**
   * Column keys to include. When omitted, every visible non-hidden column with
   * `exportable !== false` is exported, in display order.
   */
  columns?: ReadonlyArray<Keys<T>>;
  /** Whether to emit a header row. Defaults to `true`. */
  includeHeader?: boolean;
  /**
   * Per-cell value formatter. Receives the column configuration, the raw value
   * from the record, and the record itself. Return one of {@link ExportCellValue}
   * (return a `Date` to keep date typing in XLSX).
   */
  formatter?: (column: ColumnConfiguration<T>, value: unknown, row: T) => ExportCellValue;
}

/**
 * Options for {@link ApexGrid.exportToCSV}.
 */
export interface CSVExportOptions<T extends object> extends ExportOptions<T> {
  /** Field delimiter. Defaults to `','`. */
  delimiter?: string;
  /**
   * Prepend a UTF-8 byte-order mark so Excel auto-detects the encoding when
   * opening the file. Defaults to `true`.
   */
  bom?: boolean;
  /** Line separator. Defaults to `'\r\n'` (RFC 4180). */
  newline?: string;
}

/**
 * Describes an export format offered by the grid's toolbar menu.
 *
 * @remarks
 * The toolbar renders one menu item per entry returned by
 * {@link ApexGrid.exportFormats} and dispatches the chosen `id` to
 * {@link ApexGrid.exportAs}. The community grid offers `'csv'`; derived grids
 * (e.g. `@apexcharts/grid-enterprise`) extend the list (e.g. with `'xlsx'`).
 */
export interface ExportFormat {
  /** Stable format identifier, e.g. `'csv'`. */
  id: string;
  /** Menu item label, e.g. `'Export CSV'`. */
  label: string;
}

/**
 * Resolves the columns that should appear in the export, in display order.
 */
export function resolveExportColumns<T extends object>(
  grid: ApexGrid<T>,
  opts: ExportOptions<T>
): Array<ColumnConfiguration<T>> {
  const all = getDisplayColumns(grid.columns).filter(
    (column) => !column.hidden && column.exportable !== false
  );
  if (!opts.columns?.length) return all;
  const keys = new Set(opts.columns as Keys<T>[]);
  return all.filter((column) => keys.has(column.key));
}

/**
 * Resolves the rows that should appear in the export.
 */
export function resolveExportRows<T extends object>(
  grid: ApexGrid<T>,
  source: ExportSource = 'view'
): ReadonlyArray<T> {
  switch (source) {
    case 'all':
      return grid.data;
    case 'page':
      return grid.pageItems;
    case 'selected':
      return grid.selectedRows;
    default:
      return grid.dataView;
  }
}

/**
 * Returns the column's display label, used as the header cell value.
 */
export function getColumnLabel<T extends object>(column: ColumnConfiguration<T>): string {
  return column.headerText ?? String(column.key);
}

const DATE_STYLE_MAP: Record<ColumnDateFormat, Intl.DateTimeFormatOptions['dateStyle']> = {
  short: 'short',
  medium: 'medium',
  long: 'long',
  full: 'full',
};

/**
 * Default cell-value formatter. Mirrors the on-screen rendering for each
 * column type while keeping primitive types primitive (so number/boolean/date
 * survive into XLSX as native cells instead of strings).
 */
export function defaultExportFormat<T extends object>(
  column: ColumnConfiguration<T>,
  value: unknown
): ExportCellValue {
  if (value === null || value === undefined) return '';
  switch (column.type) {
    case 'select': {
      const found = column.options?.find((option) => {
        if (option && typeof option === 'object' && 'value' in option) {
          return (option as { value: unknown }).value === value;
        }
        return option === value;
      });
      if (found && typeof found === 'object' && 'label' in found) {
        const label = (found as { label?: unknown }).label;
        if (typeof label === 'string' && label.length > 0) return label;
      }
      return typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    }
    case 'date': {
      if (value instanceof Date) return value;
      const parsed = new Date(value as string | number);
      return Number.isNaN(parsed.getTime()) ? String(value) : parsed;
    }
    case 'boolean':
      return Boolean(value);
    case 'number':
    case 'rating': {
      const n = Number(value);
      return Number.isFinite(n) ? n : '';
    }
    default:
      return typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
  }
}

/**
 * Resolves the export value for a single cell, applying the user-supplied
 * formatter when present and falling back to {@link defaultExportFormat}.
 */
export function resolveExportValue<T extends object>(
  column: ColumnConfiguration<T>,
  row: T,
  opts: ExportOptions<T>
): ExportCellValue {
  const raw = (row as Record<string, unknown>)[column.key as string];
  return opts.formatter ? opts.formatter(column, raw, row) : defaultExportFormat(column, raw);
}

/** Formats a `Date` into the configured date style for CSV output. */
export function formatDateForCSV<T extends object>(
  column: ColumnConfiguration<T>,
  value: Date
): string {
  const style = DATE_STYLE_MAP[column.format ?? 'medium'];
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: style }).format(value);
  } catch {
    return value.toISOString();
  }
}

function escapeCSVCell(value: ExportCellValue, delimiter: string): string {
  if (value === null || value === undefined || value === '') return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  const needsQuoting =
    text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
  return needsQuoting ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds the CSV string for the grid without triggering a download.
 *
 * @remarks
 * Useful when consumers want to ship the bytes through their own transport
 * (clipboard, HTTP upload). The {@link ApexGrid.exportToCSV} method calls
 * this and then triggers a browser download.
 */
export function buildCSV<T extends object>(
  grid: ApexGrid<T>,
  opts: CSVExportOptions<T> = {}
): string {
  const delimiter = opts.delimiter ?? ',';
  const newline = opts.newline ?? '\r\n';
  const includeHeader = opts.includeHeader ?? true;
  const columns = resolveExportColumns(grid, opts);
  const rows = resolveExportRows(grid, opts.source);

  const lines: string[] = [];
  if (includeHeader) {
    lines.push(
      columns.map((column) => escapeCSVCell(getColumnLabel(column), delimiter)).join(delimiter)
    );
  }
  for (const row of rows) {
    const cells = columns.map((column) => {
      let value = resolveExportValue(column, row, opts);
      if (value instanceof Date) {
        value = formatDateForCSV(column, value);
      }
      return escapeCSVCell(value, delimiter);
    });
    lines.push(cells.join(delimiter));
  }

  const body = lines.join(newline);
  return opts.bom === false ? body : `\uFEFF${body}`;
}

/**
 * Triggers a browser download for the given payload.
 *
 * @remarks
 * Falls back to a no-op when called outside the browser (during SSR or unit
 * tests on JSDOM without a body), so consumers can still call the public
 * export API safely.
 */
export function downloadBlob(
  filename: string,
  content: string | Uint8Array,
  mimeType: string
): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  // BlobPart accepts both string and Uint8Array; the cast quiets TS' strict
  // overload resolution which prefers ArrayBufferView only.
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
