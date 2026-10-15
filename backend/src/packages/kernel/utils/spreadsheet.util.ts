import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Tiện ích xử lý bảng tính Excel (.xlsx OpenXML) & CSV thuần Node.js (Zero-Dependency)
 * Hỗ trợ:
 * 1. Đọc trực tiếp file `.xlsx` (Buffer hoặc Base64) -> mảng 2 chiều `string[][]` hoặc mảng Object theo Header.
 * 2. Tạo file `.xlsx` chuẩn OpenXML (Buffer hoặc Base64) mở trực tiếp trên Microsoft Excel, Google Sheets, LibreOffice.
 * 3. Đọc và ghi CSV chuẩn RFC 4180 (hỗ trợ UTF-8 BOM cho tiếng Việt).
 */

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

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Chuyển chỉ số cột (0-based) sang ký hiệu cột Excel (A, B, ..., Z, AA, AB...) */
export function columnIndexToLetter(colIdx: number): string {
  let n = colIdx + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Chuyển tham chiếu ô Excel (vd: "C5", "AA12") sang chỉ số cột 0-based */
export function cellRefToColumnIndex(cellRef: string): number {
  const match = /^([A-Z]+)/i.exec(cellRef.trim());
  if (!match?.[1]) return -1;
  const letters = match[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/** Đóng gói danh sách file trong bộ nhớ thành ZIP Buffer (dùng cho .xlsx) */
function createZipArchive(files: ReadonlyArray<{ name: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const uncompressed = file.content;
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed);

    // Local File Header (30 bytes + file name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // compression method: deflate (8)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, compressed);

    // Central Directory Header (46 bytes + file name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // compression: deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

/** Giải nén các entry từ ZIP Buffer (hỗ trợ cả Central Directory lẫn Local File Header) */
function extractZipEntries(zipBuffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();

  // Tìm End of Central Directory (PK\x05\x06) từ cuối buffer
  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minEocdOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    let cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

    for (let i = 0; i < totalEntries && cdOffset + 46 <= zipBuffer.length; i++) {
      const sig = zipBuffer.readUInt32LE(cdOffset);
      if (sig !== 0x02014b50) break;

      const compressionMethod = zipBuffer.readUInt16LE(cdOffset + 10);
      const compressedSize = zipBuffer.readUInt32LE(cdOffset + 20);
      const nameLen = zipBuffer.readUInt16LE(cdOffset + 28);
      const extraLen = zipBuffer.readUInt16LE(cdOffset + 30);
      const commentLen = zipBuffer.readUInt16LE(cdOffset + 32);
      const localHeaderOffset = zipBuffer.readUInt32LE(cdOffset + 42);

      const fileName = zipBuffer.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');

      if (localHeaderOffset + 30 <= zipBuffer.length) {
        const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const rawData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          entries.set(fileName, rawData);
        } else if (compressionMethod === 8) {
          entries.set(fileName, inflateRawSync(rawData));
        }
      }

      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // Fallback quét Local File Header tuần tự
  let pos = 0;
  while (pos + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zipBuffer.readUInt16LE(pos + 8);
    const compressedSize = zipBuffer.readUInt32LE(pos + 18);
    const nameLen = zipBuffer.readUInt16LE(pos + 26);
    const extraLen = zipBuffer.readUInt16LE(pos + 28);
    const fileName = zipBuffer.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const dataStart = pos + 30 + nameLen + extraLen;
    const rawData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      entries.set(fileName, rawData);
    } else if (compressionMethod === 8) {
      entries.set(fileName, inflateRawSync(rawData));
    }
    pos = dataStart + compressedSize;
  }

  return entries;
}

/**
 * Tạo file Excel `.xlsx` chuẩn OpenXML từ danh sách cột Header và các dòng dữ liệu
 */
export function buildXlsxBuffer(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  sheetName = 'Users',
): Buffer {
  const safeSheetName = escapeXml(sheetName.slice(0, 31) || 'Sheet1');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

  const allMatrix: ReadonlyArray<ReadonlyArray<unknown>> = [headers, ...rows];
  const xmlRows: string[] = [];

  for (let rIdx = 0; rIdx < allMatrix.length; rIdx++) {
    const rowNumber = rIdx + 1;
    const rowCells = allMatrix[rIdx]!;
    const styleAttr = rIdx === 0 ? ' s="1"' : '';
    const xmlCells: string[] = [];

    for (let cIdx = 0; cIdx < rowCells.length; cIdx++) {
      const ref = `${columnIndexToLetter(cIdx)}${rowNumber}`;
      const val = rowCells[cIdx];
      if (typeof val === 'number' && Number.isFinite(val)) {
        xmlCells.push(`<c r="${ref}"${styleAttr}><v>${val}</v></c>`);
      } else {
        const text = escapeXml(val ?? '');
        xmlCells.push(
          `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${text}</t></is></c>`,
        );
      }
    }
    xmlRows.push(`<row r="${rowNumber}">${xmlCells.join('')}</row>`);
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${xmlRows.join('')}</sheetData>
</worksheet>`;

  return createZipArchive([
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/styles.xml', content: Buffer.from(stylesXml, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', content: Buffer.from(sheetXml, 'utf8') },
  ]);
}

/**
 * Đọc trực tiếp file Excel `.xlsx` (từ Buffer hoặc chuỗi Base64 / Data URL) thành mảng 2 chiều `string[][]`
 */
export function parseXlsxToMatrix(input: Buffer | string): string[][] {
  const buf =
    typeof input === 'string'
      ? Buffer.from(input.replace(/^data:[^;]+;base64,/i, '').trim(), 'base64')
      : input;

  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Invalid .xlsx file format (missing ZIP header signature)');
  }

  const entries = extractZipEntries(buf);

  // 1. Đọc bảng Shared Strings (`xl/sharedStrings.xml`) nếu có
  const sharedStrings: string[] = [];
  const sharedStringsBuf = entries.get('xl/sharedStrings.xml');
  if (sharedStringsBuf) {
    const sstXml = sharedStringsBuf.toString('utf8');
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(sstXml)) !== null) {
      const siInner = siMatch[1] ?? '';
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      let combined = '';
      while ((tMatch = tRegex.exec(siInner)) !== null) {
        combined += unescapeXml(tMatch[1] ?? '');
      }
      sharedStrings.push(combined);
    }
  }

  // 2. Tìm worksheet đầu tiên (`xl/worksheets/sheet1.xml` hoặc bất kỳ `xl/worksheets/sheet*.xml`)
  let sheetBuf = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetBuf) {
    for (const [entryName, content] of entries.entries()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(entryName)) {
        sheetBuf = content;
        break;
      }
    }
  }
  if (!sheetBuf) {
    throw new Error('Invalid .xlsx file: no worksheet found inside archive');
  }

  const sheetXml = sheetBuf.toString('utf8');
  const matrix: string[][] = [];

  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowInner = rowMatch[1] ?? '';
    const rowCells: string[] = [];
    let nextColIdx = 0;

    const cellRegex = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] ?? '';
      const cellInner = cellMatch[2] ?? '';

      const refMatch = /\br="([A-Z]+\d+)"/i.exec(attrs);
      const typeMatch = /\bt="([^"]+)"/i.exec(attrs);
      const colIdx = refMatch?.[1] ? cellRefToColumnIndex(refMatch[1]) : nextColIdx;
      const cellType = typeMatch?.[1] ?? '';

      let cellValue = '';
      if (cellType === 'inlineStr') {
        const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
        let tMatch: RegExpExecArray | null;
        while ((tMatch = tRegex.exec(cellInner)) !== null) {
          cellValue += unescapeXml(tMatch[1] ?? '');
        }
      } else {
        const vMatch = /<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/.exec(cellInner);
        const rawVal = vMatch?.[1] ? unescapeXml(vMatch[1].trim()) : '';
        if (cellType === 's') {
          const sstIdx = Number.parseInt(rawVal, 10);
          cellValue = Number.isFinite(sstIdx) ? (sharedStrings[sstIdx] ?? '') : rawVal;
        } else {
          cellValue = rawVal;
        }
      }

      if (colIdx >= 0) {
        while (rowCells.length <= colIdx) {
          rowCells.push('');
        }
        rowCells[colIdx] = cellValue.trim();
        nextColIdx = colIdx + 1;
      }
    }

    if (rowCells.some((c) => c.length > 0)) {
      matrix.push(rowCells);
    }
  }

  return matrix;
}
