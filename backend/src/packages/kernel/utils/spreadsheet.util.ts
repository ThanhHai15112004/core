import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Tiện ích xử lý bảng tính Excel (.xlsx OpenXML) & CSV thuần Node.js (Zero-Dependency)
 * Hỗ trợ:
 * 1. Đọc trực tiếp file `.xlsx` (Buffer hoặc Base64) -> mảng 2 chiều `string[][]` hoặc mảng Object theo Header.
 * 2. Tạo file `.xlsx` chuẩn OpenXML có định dạng báo cáo chuyên nghiệp (Tiêu đề gộp ô, Ngày xuất dữ liệu,
 *    Logo PNG tùy chọn, Header nền xanh đậm #1E4488 chữ trắng, kẻ khung viền, định dạng Text giữ số 0 đầu SĐT,
 *    tự động căn độ rộng cột & cố định dòng tiêu đề) mở trực tiếp trên Microsoft Excel, Google Sheets, LibreOffice, WPS.
 */

export interface XlsxBuildOptions {
  /** Tên worksheet (mặc định: 'Sheet1') */
  readonly sheetName?: string | undefined;
  /** Tiêu đề báo cáo lớn ở Dòng 1, gộp ngang toàn bảng (VD: 'DANH SÁCH CÁN BỘ NHÂN VIÊN') */
  readonly title?: string | null | undefined;
  /** Phụ đề / Ngày xuất dữ liệu ở Dòng 2, gộp ngang toàn bảng (VD: 'Ngày xuất dữ liệu: 15/10/2026 22:02:48') */
  readonly subtitle?: string | null | undefined;
  /** Ảnh Logo PNG tùy chọn (Buffer hoặc chuỗi Base64) neo ở góc trái tiêu đề; nếu không có thì để trống */
  readonly logoPng?: Buffer | string | null | undefined;
  /** Độ rộng từng cột tùy chỉnh (nếu không truyền sẽ tự động tính theo nội dung) */
  readonly columnWidths?: readonly number[] | undefined;
  /** Danh sách chỉ số cột (0-based) cần căn giữa ngang (VD: STT, Giới tính, Trạng thái, MFA) */
  readonly centerColumnIndices?: readonly number[] | undefined;
  /** Danh sách chỉ số cột (0-based) cần định dạng Text '@' để giữ số 0 ở đầu (VD: Mã nhân viên, SĐT) */
  readonly textColumnIndices?: readonly number[] | undefined;
  /** Cố định (Freeze) dòng tiêu đề bảng khi cuộn (mặc định: true) */
  readonly freezeHeader?: boolean | undefined;
}

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

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
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

/** Chuẩn hóa dữ liệu ảnh PNG tùy chọn (trả về null nếu không hợp lệ hoặc để trống) */
function resolveValidPngBuffer(logoPng?: Buffer | string | null): Buffer | null {
  if (!logoPng) return null;
  const buf =
    typeof logoPng === 'string'
      ? Buffer.from(logoPng.replace(/^data:image\/[^;]+;base64,/i, '').trim(), 'base64')
      : logoPng;
  // Kiểm tra chữ ký PNG chuẩn: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return buf;
  }
  return null;
}

const DEFAULT_XLSX_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xml:space="preserve" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="4"><font><b val="0"/><i val="0"/><strike val="0"/><u val="none"/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font><font><b val="1"/><i val="0"/><strike val="0"/><u val="none"/><sz val="16"/><color rgb="FF1E4488"/><name val="Calibri"/></font><font><b val="0"/><i val="1"/><strike val="0"/><u val="none"/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font><font><b val="1"/><i val="0"/><strike val="0"/><u val="none"/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E4488"/><bgColor rgb="FF000000"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF9CA3AF"/></left><right style="thin"><color rgb="FF9CA3AF"/></right><top style="thin"><color rgb="FF9CA3AF"/></top><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf xfId="0" fontId="0" numFmtId="0" fillId="0" borderId="0" applyFont="0" applyNumberFormat="0" applyFill="0" applyBorder="0" applyAlignment="0"/><xf xfId="0" fontId="1" numFmtId="0" fillId="0" borderId="0" applyFont="1" applyNumberFormat="0" applyFill="0" applyBorder="0" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf><xf xfId="0" fontId="2" numFmtId="0" fillId="0" borderId="0" applyFont="1" applyNumberFormat="0" applyFill="0" applyBorder="0" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf><xf xfId="0" fontId="3" numFmtId="0" fillId="2" borderId="1" applyFont="1" applyNumberFormat="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="0" wrapText="true" shrinkToFit="false"/></xf><xf xfId="0" fontId="0" numFmtId="0" fillId="0" borderId="2" applyFont="0" applyNumberFormat="0" applyFill="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf><xf xfId="0" fontId="0" numFmtId="0" fillId="0" borderId="2" applyFont="0" applyNumberFormat="0" applyFill="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf><xf xfId="0" fontId="0" numFmtId="49" fillId="0" borderId="2" applyFont="0" applyNumberFormat="1" applyFill="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf><xf xfId="0" fontId="0" numFmtId="49" fillId="0" borderId="2" applyFont="0" applyNumberFormat="1" applyFill="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" textRotation="0" wrapText="false" shrinkToFit="false"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotTableStyle1"/></styleSheet>`;

function buildXlsxColsXml(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  customWidths?: readonly number[],
): string {
  const colCount = Math.max(1, headers.length);
  const computedWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const customW = customWidths?.[c];
    if (customW && customW > 0) {
      computedWidths.push(customW);
      continue;
    }
    const headerLen = String(headers[c] ?? '').length;
    let maxCellLen = headerLen;
    const sampleLimit = Math.min(rows.length, 200);
    for (let r = 0; r < sampleLimit; r++) {
      const cellStr = String(rows[r]?.[c] ?? '');
      if (cellStr.length > maxCellLen) maxCellLen = cellStr.length;
    }
    computedWidths.push(Math.min(42, Math.max(10, Math.ceil(maxCellLen * 1.25) + 4)));
  }

  return `<cols>${computedWidths
    .map(
      (w, idx) =>
        `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="true" style="0"/>`,
    )
    .join('')}</cols>`;
}

function buildXlsxArchiveEntries(params: {
  safeSheetName: string;
  sheetXml: string;
  logoBuffer: Buffer | null;
}): Array<{ name: string; content: Buffer }> {
  const { safeSheetName, sheetXml, logoBuffer } = params;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${logoBuffer ? '<Default Extension="png" ContentType="image/png"/>' : ''}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${
    logoBuffer
      ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      : ''
  }
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

  const archiveEntries: Array<{ name: string; content: Buffer }> = [
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'xl/workbook.xml', content: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', content: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/styles.xml', content: Buffer.from(DEFAULT_XLSX_STYLES_XML, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', content: Buffer.from(sheetXml, 'utf8') },
  ];

  if (logoBuffer) {
    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`;
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="1028700" cy="381000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo" descr=""/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm rot="0"/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;

    archiveEntries.push(
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', content: Buffer.from(sheetRelsXml, 'utf8') },
      { name: 'xl/drawings/drawing1.xml', content: Buffer.from(drawingXml, 'utf8') },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', content: Buffer.from(drawingRelsXml, 'utf8') },
      { name: 'xl/media/logo.png', content: logoBuffer },
    );
  }

  return archiveEntries;
}

/**
 * Tạo file Excel `.xlsx` chuẩn OpenXML có định dạng bảng biểu chuyên nghiệp
 * (tương thích thiết kế `danh_sach_nhan_vien.xlsx` và `mau_import_nguoi_dung.xlsx`).
 */
export function buildXlsxBuffer(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  sheetNameOrOptions: string | XlsxBuildOptions = 'Users',
): Buffer {
  const opts: XlsxBuildOptions =
    typeof sheetNameOrOptions === 'string' ? { sheetName: sheetNameOrOptions } : sheetNameOrOptions;

  const safeSheetName = escapeXml((opts.sheetName ?? 'Sheet1').slice(0, 31) || 'Sheet1');
  const titleText = opts.title?.trim() || null;
  const subtitleText = opts.subtitle?.trim() || null;
  const logoBuffer = resolveValidPngBuffer(opts.logoPng);
  const colCount = Math.max(1, headers.length);
  const lastColLetter = columnIndexToLetter(colCount - 1);

  const centerCols = new Set(opts.centerColumnIndices ?? []);
  const textCols = new Set(opts.textColumnIndices ?? []);
  const colsXml = buildXlsxColsXml(headers, rows, opts.columnWidths);

  const xmlRows: string[] = [];
  const mergeCellRefs: string[] = [];
  let currentRowNumber = 1;

  if (titleText) {
    xmlRows.push(
      `<row r="${currentRowNumber}" spans="1:${colCount}" customHeight="1" ht="48"><c r="A${currentRowNumber}" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(titleText)}</t></is></c></row>`,
    );
    if (colCount > 1) {
      mergeCellRefs.push(`A${currentRowNumber}:${lastColLetter}${currentRowNumber}`);
    }
    currentRowNumber++;
  }

  if (subtitleText) {
    xmlRows.push(
      `<row r="${currentRowNumber}" spans="1:${colCount}" customHeight="1" ht="24"><c r="A${currentRowNumber}" s="2" t="inlineStr"><is><t xml:space="preserve">${escapeXml(subtitleText)}</t></is></c></row>`,
    );
    if (colCount > 1) {
      mergeCellRefs.push(`A${currentRowNumber}:${lastColLetter}${currentRowNumber}`);
    }
    currentRowNumber++;
  }

  const headerRowNumber = currentRowNumber;
  const headerXmlCells: string[] = [];
  for (let cIdx = 0; cIdx < headers.length; cIdx++) {
    const ref = `${columnIndexToLetter(cIdx)}${headerRowNumber}`;
    const text = escapeXml(headers[cIdx] ?? '');
    headerXmlCells.push(
      `<c r="${ref}" s="3" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`,
    );
  }
  xmlRows.push(
    `<row r="${headerRowNumber}" spans="1:${colCount}" customHeight="1" ht="32">${headerXmlCells.join('')}</row>`,
  );
  currentRowNumber++;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const rowNumber = currentRowNumber++;
    const rowCells = rows[rIdx]!;
    const xmlCells: string[] = [];

    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const ref = `${columnIndexToLetter(cIdx)}${rowNumber}`;
      const val = rowCells[cIdx];
      const isCenter = centerCols.has(cIdx);
      const isText = textCols.has(cIdx);
      const styleIdx = isText ? (isCenter ? 7 : 6) : isCenter ? 5 : 4;

      if (!isText && typeof val === 'number' && Number.isFinite(val)) {
        xmlCells.push(`<c r="${ref}" s="${styleIdx}"><v>${val}</v></c>`);
      } else {
        const text = escapeXml(val ?? '');
        xmlCells.push(
          `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`,
        );
      }
    }
    xmlRows.push(`<row r="${rowNumber}" spans="1:${colCount}">${xmlCells.join('')}</row>`);
  }

  const lastRowNumber = Math.max(headerRowNumber, currentRowNumber - 1);
  const dimensionRef = `A1:${lastColLetter}${lastRowNumber}`;
  const freezeHeader = opts.freezeHeader ?? true;
  const sheetViewInner = freezeHeader
    ? `<pane ySplit="${headerRowNumber}" topLeftCell="A${headerRowNumber + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRowNumber}" sqref="A${headerRowNumber}:${lastColLetter}${headerRowNumber}"/>`
    : `<selection activeCell="A1" sqref="A1"/>`;

  const mergeCellsXml =
    mergeCellRefs.length > 0
      ? `<mergeCells count="${mergeCellRefs.length}">${mergeCellRefs
          .map((ref) => `<mergeCell ref="${ref}"/>`)
          .join('')}</mergeCells>`
      : '';
  const drawingTagXml = logoBuffer ? '<drawing r:id="rId1"/>' : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xml:space="preserve" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">
  <dimension ref="${dimensionRef}"/>
  <sheetViews><sheetView tabSelected="1" workbookViewId="0" showGridLines="true" showRowColHeaders="1">${sheetViewInner}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18" outlineLevelRow="0" outlineLevelCol="0"/>
  ${colsXml}
  <sheetData>${xmlRows.join('')}</sheetData>
  ${mergeCellsXml}
  ${drawingTagXml}
</worksheet>`;

  return createZipArchive(
    buildXlsxArchiveEntries({
      safeSheetName,
      sheetXml,
      logoBuffer,
    }),
  );
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

/** Thoát chuỗi an toàn khi ghi ra ô CSV */
export function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Tạo nội dung CSV có UTF-8 BOM từ danh sách tiêu đề cột và các dòng dữ liệu */
export function buildCsvContent(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const lines: string[] = [
    headers.map((h) => escapeCsvCell(h)).join(','),
    ...rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Phân tích một dòng CSV có hỗ trợ dấu ngoặc kép */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Phân tích nội dung chuỗi CSV thành ma trận 2 chiều `string[][]` */
export function parseCsvToMatrix(csvContent: string): string[][] {
  const normalized = csvContent.replace(/^\uFEFF/, '').trim();
  if (!normalized) return [];
  const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => parseCsvLine(line));
}

/** Chuẩn hóa nhãn tiêu đề cột Excel/CSV (bỏ dấu *, bỏ chú thích trong ngoặc, bỏ xuống dòng) */
export function normalizeSpreadsheetHeader(raw: string): string {
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Làm sạch giá trị ô trong bảng tính (bỏ khoảng trắng thừa và dấu gạch ngang rỗng) */
export function cleanSpreadsheetCell(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'n/a') {
    return '';
  }
  return trimmed;
}

/**
 * Tự động dò tìm chỉ số dòng Header trong ma trận Excel/CSV
 * (Hỗ trợ cả file có dòng Tiêu đề lớn + Ngày xuất dữ liệu ở dòng 1-2 lẫn file có Header ngay tại dòng 1).
 */
export function detectSpreadsheetHeaderRowIndex(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  knownHeaders: Iterable<string>,
  maxScanRows = 10,
): number {
  const knownSet = new Set(Array.from(knownHeaders, (h) => normalizeSpreadsheetHeader(h)));
  const limit = Math.min(matrix.length, maxScanRows);
  let bestRowIdx = 0;
  let bestMatches = 0;

  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? [];
    let matches = 0;
    for (const cell of row) {
      if (knownSet.has(normalizeSpreadsheetHeader(cell))) {
        matches++;
      }
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestRowIdx = r;
    }
  }

  return bestRowIdx;
}

/** Tạo bộ tra cứu chỉ số cột theo danh sách tên cột đồng nghĩa đã chuẩn hóa */
export function createSpreadsheetColumnFinder(
  headerRow: readonly string[],
): (candidateNames: readonly string[]) => number {
  const normalizedHeaders = headerRow.map((h) => normalizeSpreadsheetHeader(h));
  return (candidateNames: readonly string[]): number => {
    for (const name of candidateNames) {
      const idx = normalizedHeaders.indexOf(normalizeSpreadsheetHeader(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };
}
