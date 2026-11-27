#!/usr/bin/env node
/**
 * Bộ tạo file Excel (.xlsx chuẩn OpenXML) đa sheet thuần Node.js (Zero-Dependency).
 * Hỗ trợ:
 * - Sheet bảng dữ liệu có AutoFilter, Freeze Pane, tự tính chiều cao dòng cho ô nhiều dòng (code snippet).
 * - Sheet Dashboard đa khu vực (Banner tiêu đề, KPI Strip có công thức Excel thật COUNTIF/SUM, nhiều bảng thống kê).
 * - Tô màu trực quan theo Trạng thái (PASS/FAIL/WARN/SKIPPED) & Mức độ (Critical/High/Medium/Low).
 */
import { deflateRawSync } from 'node:zlib';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(val) {
  // Loại bỏ các ký tự điều khiển XML không hợp lệ (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F)
  return String(val ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function colLetter(colIdx) {
  let n = colIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function sanitizeSheetName(name, fallback) {
  const cleaned = String(name || fallback)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

function createZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const uncompressed = file.content;
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

export const XLSX_STYLE = {
  DEFAULT: 0,
  TITLE: 1,
  SUBTITLE: 2,
  SECTION: 3,
  HEADER: 4,
  DATA_LEFT: 5,
  DATA_CENTER: 6,
  DATA_CODE: 7,
  TOTAL_LEFT: 8,
  TOTAL_CENTER: 9,
  BADGE_PASS: 10,
  BADGE_FAIL: 11,
  BADGE_WARN: 12,
  BADGE_MED: 13,
  BADGE_INFO: 14,
  KPI_LABEL: 15,
  KPI_VALUE: 16,
};

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="11">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1B365D"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="9"/><name val="Consolas"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F5132"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF842029"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF664D03"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FF1B365D"/><name val="Calibri"/></font>
  </fonts>
  <fills count="12">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1B365D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E2EC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E4488"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD1E7DD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE8CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="17">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="8" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="9" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="9" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="10" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

function resolveBadgeStyle(rawVal) {
  const upper = String(rawVal ?? '').toUpperCase().trim();
  if (upper === 'PASS' || upper === 'PASSED' || upper === 'OK' || upper === 'TỐT' || upper === 'ĐẠT') {
    return XLSX_STYLE.BADGE_PASS;
  }
  if (
    upper === 'FAIL' ||
    upper === 'FAILED' ||
    upper === 'CRITICAL' ||
    upper === 'BREAKING' ||
    upper === 'ERROR' ||
    upper === 'CẦN BỔ SUNG'
  ) {
    return XLSX_STYLE.BADGE_FAIL;
  }
  if (upper === 'WARN' || upper === 'WARNING' || upper === 'HIGH') {
    return XLSX_STYLE.BADGE_WARN;
  }
  if (upper === 'MEDIUM' || upper === 'DEGRADED' || upper === 'TRUNG BÌNH') {
    return XLSX_STYLE.BADGE_MED;
  }
  if (upper === 'LOW' || upper === 'INFO' || upper === 'SKIPPED' || upper === 'CANCELLED') {
    return XLSX_STYLE.BADGE_INFO;
  }
  return null;
}

function renderCellXml(ref, cell, defaultStyle) {
  const isObj = cell !== null && typeof cell === 'object' && !Array.isArray(cell);
  const styleId = isObj && typeof cell.s === 'number' ? cell.s : defaultStyle;
  if (isObj && typeof cell.f === 'string') {
    const cached =
      typeof cell.v === 'number' && Number.isFinite(cell.v)
        ? `<v>${cell.v}</v>`
        : cell.v !== undefined
          ? `<v>${escapeXml(cell.v)}</v>`
          : '';
    return `<c r="${ref}" s="${styleId}"><f>${escapeXml(cell.f)}</f>${cached}</c>`;
  }

  const val = isObj ? cell.v : cell;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `<c r="${ref}" s="${styleId}"><v>${val}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(val ?? '')}</t></is></c>`;
}

function estimateRowHeight(cells, colWidths, baseHeight = 20) {
  let maxLines = 1;
  for (let i = 0; i < cells.length; i++) {
    const raw = cells[i];
    const val = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.v : raw;
    if (typeof val !== 'string' || !val) continue;
    const width = Math.max(colWidths[i] ?? 20, 10);
    const explicitLines = val.split('\n');
    let wrapped = 0;
    for (const line of explicitLines) {
      wrapped += Math.max(1, Math.ceil(line.length / Math.max(width - 2, 8)));
    }
    if (wrapped > maxLines) maxLines = wrapped;
  }
  return Math.min(Math.max(baseHeight, maxLines * 14 + 6), 190);
}

/**
 * Dựng worksheet từ định nghĩa dạng `rows` tự do (Dashboard đa khối) HOẶC dạng bảng chuẩn (`headers` + `rows`).
 */
function buildWorksheetXml(sheet) {
  const merges = [...(sheet.merges ?? [])];
  const rowXmls = [];
  let freezeRow = sheet.freezeRow ?? 0;
  let autoFilterRef = sheet.autoFilter ?? null;
  let widths = [];

  if (Array.isArray(sheet.customRows)) {
    // Chế độ Dashboard tự do: mỗi phần tử là { cells, height?, mergeFullWidth?, style? }
    const colCount = sheet.colCount ?? Math.max(...sheet.customRows.map((r) => (r.cells ?? []).length), 1);
    widths = sheet.colWidths
      ? [...sheet.colWidths]
      : Array.from({ length: colCount }, () => 18);

    let rowNum = 1;
    for (const rowDef of sheet.customRows) {
      const cells = rowDef.cells ?? [];
      if (rowDef.mergeFullWidth && colCount > 1) {
        merges.push(`A${rowNum}:${colLetter(colCount - 1)}${rowNum}`);
      }
      if (Array.isArray(rowDef.merges)) {
        for (const [startCol, endCol] of rowDef.merges) {
          merges.push(`${colLetter(startCol)}${rowNum}:${colLetter(endCol)}${rowNum}`);
        }
      }
      const rowStyle = rowDef.defaultStyle ?? XLSX_STYLE.DATA_LEFT;
      const cellCount = rowDef.mergeFullWidth ? 1 : Math.max(cells.length, rowDef.padToCols ? colCount : 0);
      const rendered = [];
      for (let i = 0; i < cellCount; i++) {
        const cellVal = i < cells.length ? cells[i] : '';
        let cellStyle = rowStyle;
        if (rowDef.centerCols?.includes(i)) cellStyle = XLSX_STYLE.DATA_CENTER;
        if (rowDef.statusCols?.includes(i)) {
          const badge = resolveBadgeStyle(
            cellVal && typeof cellVal === 'object' ? cellVal.v : cellVal,
          );
          if (badge !== null) cellStyle = badge;
        }
        rendered.push(renderCellXml(`${colLetter(i)}${rowNum}`, cellVal, cellStyle));
      }
      const ht = rowDef.height ?? estimateRowHeight(cells, widths, 20);
      rowXmls.push(`<row r="${rowNum}" ht="${ht}" customHeight="1">${rendered.join('')}</row>`);
      rowNum++;
    }
  } else {
    // Chế độ bảng chuẩn có Title, Subtitle, Header, AutoFilter & Data Rows
    const headers = sheet.headers ?? [];
    const rows = sheet.rows ?? [];
    const colCount = Math.max(headers.length, 1);
    const centerCols = new Set(sheet.centerCols ?? []);
    const statusCols = new Set(sheet.statusCols ?? []);
    const codeCols = new Set(sheet.codeCols ?? []);

    widths = sheet.colWidths
      ? [...sheet.colWidths]
      : headers.map((h, i) => {
          let maxLen = String(h ?? '').length;
          for (const r of rows) {
            const raw = r[i];
            const val = raw && typeof raw === 'object' ? raw.v : raw;
            const firstLineLen = String(val ?? '').split('\n')[0]?.length ?? 0;
            if (firstLineLen > maxLen) maxLen = firstLineLen;
          }
          return Math.min(Math.max(maxLen + 4, 12), 54);
        });

    let rowNum = 1;
    if (sheet.title) {
      merges.push(`A${rowNum}:${colLetter(colCount - 1)}${rowNum}`);
      rowXmls.push(
        `<row r="${rowNum}" ht="28" customHeight="1">${renderCellXml(`A${rowNum}`, sheet.title, XLSX_STYLE.TITLE)}</row>`,
      );
      rowNum++;
    }
    if (sheet.subtitle) {
      merges.push(`A${rowNum}:${colLetter(colCount - 1)}${rowNum}`);
      rowXmls.push(
        `<row r="${rowNum}" ht="22" customHeight="1">${renderCellXml(`A${rowNum}`, sheet.subtitle, XLSX_STYLE.SUBTITLE)}</row>`,
      );
      rowNum++;
    }

    const headerRowNum = rowNum;
    freezeRow = headerRowNum;
    const headerCells = headers
      .map((h, idx) => renderCellXml(`${colLetter(idx)}${headerRowNum}`, h, XLSX_STYLE.HEADER))
      .join('');
    rowXmls.push(`<row r="${headerRowNum}" ht="24" customHeight="1">${headerCells}</row>`);
    rowNum++;

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const r = rows[rIdx];
      const isTotalRow = Boolean(sheet.totalLastRow && rIdx === rows.length - 1);
      const rendered = headers
        .map((_, idx) => {
          const val = r[idx];
          let styleId = isTotalRow
            ? centerCols.has(idx)
              ? XLSX_STYLE.TOTAL_CENTER
              : XLSX_STYLE.TOTAL_LEFT
            : codeCols.has(idx)
              ? XLSX_STYLE.DATA_CODE
              : centerCols.has(idx)
                ? XLSX_STYLE.DATA_CENTER
                : XLSX_STYLE.DATA_LEFT;

          if (!isTotalRow && statusCols.has(idx)) {
            const rawVal = val && typeof val === 'object' ? val.v : val;
            const badge = resolveBadgeStyle(rawVal);
            if (badge !== null) styleId = badge;
          }
          return renderCellXml(`${colLetter(idx)}${rowNum}`, val, styleId);
        })
        .join('');

      const ht = estimateRowHeight(r, widths, 20);
      rowXmls.push(`<row r="${rowNum}" ht="${ht}" customHeight="1">${rendered}</row>`);
      rowNum++;
    }

    if (sheet.enableAutoFilter !== false && rows.length > 0) {
      autoFilterRef = `A${headerRowNum}:${colLetter(colCount - 1)}${rowNum - 1}`;
    }
  }

  const colsXml = widths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const mergeXml =
    merges.length > 0
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
  const filterXml = autoFilterRef ? `<autoFilter ref="${autoFilterRef}"/>` : '';
  const paneXml =
    freezeRow > 0
      ? `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="${sheet.selected ? 1 : 0}" workbookViewId="0">${paneXml}</sheetView>
  </sheetViews>
  <cols>${colsXml}</cols>
  <sheetData>${rowXmls.join('')}</sheetData>
  ${filterXml}
  ${mergeXml}
</worksheet>`;
}

export function buildMultiSheetXlsxBuffer(sheets) {
  const normalized = sheets.map((s, idx) => ({
    ...s,
    safeName: sanitizeSheetName(s.name, `Sheet${idx + 1}`),
    selected: idx === 0,
  }));

  const contentTypesOverrides = normalized
    .map(
      (_, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${contentTypesOverrides}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetEntries = normalized
    .map(
      (s, idx) =>
        `<sheet name="${escapeXml(s.safeName)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`,
    )
    .join('');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries}</sheets>
</workbook>`;

  const workbookRelsEntries = [
    ...normalized.map(
      (_, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`,
    ),
    `<Relationship Id="rId${normalized.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join('');

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelsEntries}
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/styles.xml', content: Buffer.from(buildStylesXml(), 'utf8') },
    ...normalized.map((s, idx) => ({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      content: Buffer.from(buildWorksheetXml(s), 'utf8'),
    })),
  ];

  return createZipBuffer(files);
}
