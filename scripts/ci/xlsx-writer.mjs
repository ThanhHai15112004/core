#!/usr/bin/env node
/**
 * Bộ tạo file Excel (.xlsx chuẩn OpenXML) đa sheet thuần Node.js (Zero-Dependency).
 * Dùng chung cho báo cáo CI (GitHub Actions, GitLab CI, Local) mà không cần `backend/dist` hay thư viện ngoài.
 * Hỗ trợ: tiêu đề gộp ô, phụ đề ngày giờ, header xanh đậm (#1E4488) chữ trắng, tô màu PASS/FAIL/SKIPPED,
 * kẻ khung viền, cố định dòng tiêu đề (freeze pane) và tự động tính độ rộng cột.
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
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIdx) {
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

/**
 * Style indices trong styles.xml:
 *   0 = Default
 *   1 = Title (Bold 14pt Navy, center)
 *   2 = Subtitle (Italic 10pt Gray, center)
 *   3 = Table Header (Bold 10pt White on #1E4488, thin border, center)
 *   4 = Data Left (10pt, thin border, left wrap)
 *   5 = Data Center (10pt, thin border, center)
 *   6 = Status PASS (Bold Green #0F5132 on #D1E7DD, thin border, center)
 *   7 = Status FAIL (Bold Red #842029 on #F8D7DA, thin border, center)
 *   8 = Status SKIPPED/INFO (Bold Slate #495057 on #E9ECEF, thin border, center)
 */
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF1E4488"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F5132"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF842029"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF495057"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E4488"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD1E7DD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9ECEF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD0D7DE"/></left>
      <right style="thin"><color rgb="FFD0D7DE"/></right>
      <top style="thin"><color rgb="FFD0D7DE"/></top>
      <bottom style="thin"><color rgb="FFD0D7DE"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

function resolveCellStyle(val, colIdx, centerCols, statusCols) {
  if (statusCols.has(colIdx)) {
    const upper = String(val ?? '').toUpperCase();
    if (upper.includes('PASS') || upper === 'OK') return 6;
    if (upper.includes('FAIL') || upper.includes('BREAKING') || upper.includes('ERROR')) return 7;
    if (upper.includes('SKIP') || upper.includes('INFO') || upper.includes('CANCEL')) return 8;
  }
  return centerCols.has(colIdx) ? 5 : 4;
}

function buildWorksheetXml(sheet) {
  const headers = sheet.headers ?? [];
  const rows = sheet.rows ?? [];
  const colCount = Math.max(headers.length, 1);
  const centerCols = new Set(sheet.centerCols ?? []);
  const statusCols = new Set(sheet.statusCols ?? []);

  const widths = headers.map((h, i) => {
    let maxLen = String(h ?? '').length;
    for (const r of rows) {
      const len = String(r[i] ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    return Math.min(Math.max(maxLen + 4, 12), 68);
  });

  const merges = [];
  const rowXmls = [];
  let rowNum = 1;

  if (sheet.title) {
    const endCol = colLetter(colCount - 1);
    merges.push(`A${rowNum}:${endCol}${rowNum}`);
    rowXmls.push(
      `<row r="${rowNum}" ht="26" customHeight="1"><c r="A${rowNum}" t="inlineStr" s="1"><is><t>${escapeXml(sheet.title)}</t></is></c></row>`,
    );
    rowNum++;
  }

  if (sheet.subtitle) {
    const endCol = colLetter(colCount - 1);
    merges.push(`A${rowNum}:${endCol}${rowNum}`);
    rowXmls.push(
      `<row r="${rowNum}" ht="18" customHeight="1"><c r="A${rowNum}" t="inlineStr" s="2"><is><t>${escapeXml(sheet.subtitle)}</t></is></c></row>`,
    );
    rowNum++;
  }

  const headerRowNum = rowNum;
  const headerCells = headers
    .map(
      (h, idx) =>
        `<c r="${colLetter(idx)}${headerRowNum}" t="inlineStr" s="3"><is><t>${escapeXml(h)}</t></is></c>`,
    )
    .join('');
  rowXmls.push(`<row r="${headerRowNum}" ht="22" customHeight="1">${headerCells}</row>`);
  rowNum++;

  for (const r of rows) {
    const cells = headers
      .map((_, idx) => {
        const val = r[idx];
        const styleId = resolveCellStyle(val, idx, centerCols, statusCols);
        const ref = `${colLetter(idx)}${rowNum}`;
        if (typeof val === 'number' && Number.isFinite(val)) {
          return `<c r="${ref}" s="${styleId}"><v>${val}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(val ?? '')}</t></is></c>`;
      })
      .join('');
    rowXmls.push(`<row r="${rowNum}" ht="20" customHeight="1">${cells}</row>`);
    rowNum++;
  }

  const colsXml = widths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const mergeXml =
    merges.length > 0
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="${sheet.selected ? 1 : 0}" workbookViewId="0">
      <pane ySplit="${headerRowNum}" topLeftCell="A${headerRowNum + 1}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>${colsXml}</cols>
  <sheetData>${rowXmls.join('')}</sheetData>
  ${mergeXml}
</worksheet>`;
}

/**
 * Tạo Buffer `.xlsx` hợp lệ gồm nhiều worksheet.
 * @param {Array<{name: string, title?: string, subtitle?: string, headers: string[], rows: any[][], centerCols?: number[], statusCols?: number[]}>} sheets
 */
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
