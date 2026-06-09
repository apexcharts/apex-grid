import type { ExportCellValue, ExportOptions } from 'apex-grid/internal';

// Minimal write-only OOXML (XLSX) implementation. Produces a single-sheet
// workbook with bold headers and a date cell format, packaged in a store-only
// (no-compression) ZIP container. No external dependencies — the goal is to
// keep the bundle footprint of the export feature near zero.
//
// Moved out of the community `apex-grid` package in v3: Excel export is an
// enterprise feature (CSV remains free), matching the AG Grid community/
// enterprise split.

const encoder = new TextEncoder();

// --- CRC-32 (IEEE 802.3) for ZIP entries -----------------------------------

let _crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  _crcTable = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (c >>> 8) ^ table[(c ^ data[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

// --- Store-only ZIP writer -------------------------------------------------

interface ZipFile {
  name: string;
  data: Uint8Array;
}

interface ZipEntry extends ZipFile {
  crc: number;
  offset: number;
  nameBytes: Uint8Array;
}

/**
 * Builds a store-only (no compression) ZIP archive containing the given
 * files. The XLSX format permits stored entries, which keeps this writer
 * ~100 lines without pulling in a deflate implementation.
 */
function buildZip(files: ReadonlyArray<ZipFile>): Uint8Array {
  const parts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // version needed to extract
    view.setUint16(6, 0x0800, true); // flag bit 11: UTF-8 filename
    view.setUint16(8, 0, true); // compression: stored
    view.setUint16(10, 0, true); // mod time
    view.setUint16(12, 0x0021, true); // mod date: 1980-01-01
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    parts.push(header, file.data);
    entries.push({ ...file, crc, offset, nameBytes });
    offset += header.length + file.data.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(cd.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 0x031e, true); // version made by (unix, v3.0)
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x0021, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    cd.set(entry.nameBytes, 46);
    parts.push(cd);
    offset += cd.length;
  }

  const centralSize = offset - centralStart;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  parts.push(eocd);

  let total = 0;
  for (const part of parts) total += part.length;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

// --- XML helpers -----------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(value: string): string {
  // XLSX is intolerant of control chars below 0x20 (except tab, LF, CR).
  // Strip them rather than letting Excel report a "corrupt file" warning.
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    const ch = value[i];
    out += XML_ESCAPES[ch] ?? ch;
  }
  return out;
}

/** Excel column letter for zero-based column index (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Converts a `Date` to the Excel serial date number (days since the 1899-12-30
 * epoch, with the day rolling over at the user's local midnight). Time of day
 * is preserved as the fractional part.
 */
export function toExcelSerial(date: Date): number {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000 - Date.UTC(1899, 11, 30);
  return localMs / 86_400_000;
}

// --- Sheet rendering -------------------------------------------------------

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATE = 2;

function renderCell(ref: string, value: ExportCellValue, styleIndex?: number): string {
  const s = styleIndex && styleIndex !== STYLE_DEFAULT ? ` s="${styleIndex}"` : '';
  if (value === null || value === undefined || value === '') {
    return styleIndex ? `<c r="${ref}"${s}/>` : '';
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  if (value instanceof Date) {
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${toExcelSerial(value)}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    String(value)
  )}</t></is></c>`;
}

/** A worksheet representation passed to {@link buildXLSX}. */
export interface XLSXSheetData {
  /** Worksheet tab name. */
  name?: string;
  /** Header row labels (rendered with bold styling). */
  headers: string[];
  /** Data rows. Each row is an array of cell values, aligned to `headers`. */
  rows: ExportCellValue[][];
}

/**
 * Options for {@link ApexGridEnterprise.exportToXLSX}. Mirrors the community
 * grid's CSV options, plus an optional worksheet name.
 */
export interface XLSXExportOptions<T extends object> extends ExportOptions<T> {
  /** Worksheet tab name. Defaults to `'Sheet1'`. Trimmed to 31 chars. */
  sheetName?: string;
}

/** Filename-illegal characters per the OOXML spec for sheet names. */
const SHEET_NAME_DISALLOWED = /[\\/?*[\]:]/g;

function sanitizeSheetName(raw: string): string {
  return raw.replace(SHEET_NAME_DISALLOWED, '_').slice(0, 31) || 'Sheet1';
}

/**
 * Builds the complete `.xlsx` bytes for a single-sheet workbook.
 */
export function buildXLSX(sheet: XLSXSheetData): Uint8Array {
  const sheetName = sanitizeSheetName(sheet.name ?? 'Sheet1');
  const headerCount = sheet.headers.length;
  const maxRowWidth = sheet.rows.reduce((acc, row) => Math.max(acc, row.length), 0);
  const totalCols = Math.max(headerCount, maxRowWidth);
  const totalRows = sheet.rows.length + (headerCount ? 1 : 0);

  const sheetRows: string[] = [];
  let rowNum = 1;
  if (headerCount) {
    const cells: string[] = [];
    for (let c = 0; c < headerCount; c++) {
      cells.push(renderCell(`${columnLetter(c)}${rowNum}`, sheet.headers[c], STYLE_HEADER));
    }
    sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
    rowNum++;
  }
  for (const row of sheet.rows) {
    const cells: string[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = renderCell(`${columnLetter(c)}${rowNum}`, row[c]);
      if (cell) cells.push(cell);
    }
    sheetRows.push(`<row r="${rowNum}">${cells.join('')}</row>`);
    rowNum++;
  }

  const dimension =
    totalRows > 0 && totalCols > 0 ? `A1:${columnLetter(totalCols - 1)}${totalRows}` : 'A1';

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    '</worksheet>';

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    '</fonts>' +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>` +
    '</cellXfs>' +
    '</styleSheet>';

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    '</Types>';

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>';

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  return buildZip([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', data: encoder.encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) },
  ]);
}
