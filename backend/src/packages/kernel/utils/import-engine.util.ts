import type { z } from 'zod';
import { BadRequestAppException } from '../errors/http-exceptions.js';
import type {
  ExistingDuplicateMatch,
  ExtractedImportMatrixRow,
  ImportCellIssue,
  ImportColumnDefinition,
  ImportColumnMappingInput,
  ImportDuplicateStrategy,
  ImportPreviewResult,
  ImportPreviewRowItem,
  ImportTemplateFileResult,
  ResolvedImportColumnMappingResult,
  ResolvedImportColumnMatch,
} from '../contracts/import.contract.js';
import { IMPORT_DUPLICATE_STRATEGY } from '../contracts/import.contract.js';
import {
  type XlsxBuildOptions,
  buildXlsxBuffer,
  cellRefToColumnIndex,
  cleanSpreadsheetCell,
  columnIndexToLetter,
  detectSpreadsheetHeaderRowIndex,
  escapeCsvCell,
  normalizeSpreadsheetHeader,
  parseCsvToMatrix,
  parseXlsxToMatrix,
} from './spreadsheet.util.js';

/**
 * Tạo file Mẫu Import (`.xlsx` hoặc `.csv`) dùng chung cho mọi module
 * (Mục 8.2.1 & 8.2.2 — Nhập dữ liệu từ Excel & CSV: Hỗ trợ file mẫu).
 */
export function buildImportTemplateFile(params: {
  readonly fileBaseName: string;
  readonly format?: 'csv' | 'xlsx' | undefined;
  readonly sheetName?: string | undefined;
  readonly title?: string | null | undefined;
  readonly subtitle?: string | null | undefined;
  readonly headers?: readonly string[] | undefined;
  readonly columns?: readonly ImportColumnDefinition[] | undefined;
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string | number>>;
  readonly columnWidths?: readonly number[] | undefined;
  readonly centerColumnIndices?: readonly number[] | undefined;
  readonly textColumnIndices?: readonly number[] | undefined;
}): ImportTemplateFileResult {
  const format: 'csv' | 'xlsx' = params.format === 'csv' ? 'csv' : 'xlsx';
  const headers = params.headers ?? (params.columns ?? []).map((c) => c.header);
  const columnWidths = params.columnWidths ?? (params.columns ?? []).map((c) => c.width ?? 20);

  const centerColumnIndices: number[] = params.centerColumnIndices
    ? [...params.centerColumnIndices]
    : [];
  const textColumnIndices: number[] = params.textColumnIndices ? [...params.textColumnIndices] : [];

  if (!params.centerColumnIndices && params.columns) {
    params.columns.forEach((col, idx) => {
      if (col.isCenter) centerColumnIndices.push(idx);
    });
  }
  if (!params.textColumnIndices && params.columns) {
    params.columns.forEach((col, idx) => {
      if (col.isText) textColumnIndices.push(idx);
    });
  }

  const lines: string[] = [
    headers.join(','),
    ...params.sampleRows.map((row) => row.map((v) => escapeCsvCell(v)).join(',')),
  ];
  const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;

  const xlsxOpts: XlsxBuildOptions = {
    sheetName: params.sheetName ?? 'Sheet1',
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
    columnWidths,
    centerColumnIndices,
    textColumnIndices,
    freezeHeader: true,
  };
  const xlsxBase64 = buildXlsxBuffer(headers, params.sampleRows, xlsxOpts).toString('base64');
  const cleanBase = params.fileBaseName.replace(/\.(xlsx|csv)$/i, '');

  return {
    fileName: `${cleanBase}.${format}`,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    totalExported: params.sampleRows.length,
    csvContent,
    xlsxBase64,
  };
}

/**
 * Giải mã dữ liệu đầu vào (`xlsxBase64` hoặc `csvContent`) thành ma trận 2 chiều `string[][]`.
 */
export function parseImportSpreadsheetToMatrix(input: {
  readonly xlsxBase64?: string | undefined;
  readonly csvContent?: string | undefined;
}): string[][] {
  if (input.xlsxBase64) {
    try {
      return parseXlsxToMatrix(input.xlsxBase64);
    } catch (err: unknown) {
      throw new BadRequestAppException('import.invalidXlsxFile', [
        err instanceof Error ? err.message : 'Unable to parse .xlsx file',
      ]);
    }
  }
  if (input.csvContent) {
    return parseCsvToMatrix(input.csvContent);
  }
  return [];
}

/**
 * Giải quyết ánh xạ cột giữa ma trận Excel/CSV và các trường hệ thống
 * (Mục 8.2.3 — Cho phép ánh xạ cột: hỗ trợ cả tự động dò theo alias lẫn `columnMapping` tùy chỉnh từ người dùng).
 */
export function resolveImportColumnMapping<TField extends string = string>(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  columns: readonly ImportColumnDefinition<TField>[],
  customMapping?: ImportColumnMappingInput | null,
): ResolvedImportColumnMappingResult<TField> {
  const knownHeaders: string[] = [];
  for (const col of columns) {
    knownHeaders.push(col.header, col.field, ...(col.aliases ?? []));
  }
  if (customMapping) {
    for (const val of Object.values(customMapping)) {
      if (typeof val === 'string' && val.trim()) {
        knownHeaders.push(val.trim());
      }
    }
  }

  const headerRowIndex =
    matrix.length > 0 ? detectSpreadsheetHeaderRowIndex(matrix, knownHeaders) : 0;
  const headerRow = (matrix[headerRowIndex] ?? []).map((h) => cleanSpreadsheetCell(h));
  const normalizedHeaders = headerRow.map((h) => normalizeSpreadsheetHeader(h));

  const matches: ResolvedImportColumnMatch<TField>[] = [];
  const unmappedRequiredFields: TField[] = [];

  const resolveColumnIndexFromCustomTarget = (target: string | number): number => {
    if (typeof target === 'number' && Number.isInteger(target)) {
      return target >= 0 && target < headerRow.length ? target : -1;
    }
    const str = String(target).trim();
    if (!str) return -1;

    // 1. Khớp theo tên cột trên file
    const normalizedTarget = normalizeSpreadsheetHeader(str);
    const exactHeaderIdx = normalizedHeaders.indexOf(normalizedTarget);
    if (exactHeaderIdx >= 0) return exactHeaderIdx;

    // 2. Nếu truyền chỉ số cột 0-based dưới dạng chuỗi ("0", "1")
    if (/^\d+$/.test(str)) {
      const asNum = Number.parseInt(str, 10);
      if (asNum >= 0 && asNum < headerRow.length) return asNum;
    }

    // 3. Nếu truyền chữ cái cột Excel ("A", "B", "AA")
    if (/^[A-Za-z]{1,3}$/.test(str)) {
      const colIdx = cellRefToColumnIndex(`${str.toUpperCase()}1`);
      if (colIdx >= 0 && colIdx < headerRow.length) return colIdx;
    }

    return -1;
  };

  for (const colDef of columns) {
    let matchedIdx = -1;
    let mappedBy: 'custom' | 'alias' | 'unmapped' = 'unmapped';

    const customTarget = customMapping?.[colDef.field];
    if (customTarget !== undefined && customTarget !== null && String(customTarget).trim() !== '') {
      matchedIdx = resolveColumnIndexFromCustomTarget(customTarget);
      if (matchedIdx >= 0) {
        mappedBy = 'custom';
      }
    }

    if (matchedIdx < 0) {
      const candidates = [colDef.header, colDef.field, ...(colDef.aliases ?? [])];
      for (const candidate of candidates) {
        const targetNorm = normalizeSpreadsheetHeader(candidate);
        const idx = normalizedHeaders.indexOf(targetNorm);
        if (idx >= 0) {
          matchedIdx = idx;
          mappedBy = 'alias';
          break;
        }
      }
    }

    if (matchedIdx < 0 && colDef.required) {
      unmappedRequiredFields.push(colDef.field);
    }

    matches.push({
      field: colDef.field,
      header: colDef.header,
      required: Boolean(colDef.required),
      matchedIndex: matchedIdx,
      matchedHeader: matchedIdx >= 0 ? (headerRow[matchedIdx] ?? null) : null,
      matchedColumnLetter: matchedIdx >= 0 ? columnIndexToLetter(matchedIdx) : null,
      mappedBy,
    });
  }

  return {
    headerRowIndex,
    detectedHeaders: headerRow,
    matches,
    unmappedRequiredFields,
  };
}

/**
 * Trích xuất các dòng dữ liệu từ ma trận Excel/CSV theo bảng ánh xạ cột `mapping`.
 */
export function extractMappedRowsFromMatrix(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  mapping: ResolvedImportColumnMappingResult,
): ExtractedImportMatrixRow[] {
  if (matrix.length < 2 || mapping.headerRowIndex >= matrix.length - 1) {
    return [];
  }

  const results: ExtractedImportMatrixRow[] = [];
  for (let i = mapping.headerRowIndex + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const hasAnyValue = cells.some((c) => cleanSpreadsheetCell(c).length > 0);
    if (!hasAnyValue) continue;

    const rawByField: Record<string, string> = {};
    for (const match of mapping.matches) {
      rawByField[match.field] =
        match.matchedIndex >= 0 ? cleanSpreadsheetCell(cells[match.matchedIndex] ?? '') : '';
    }

    results.push({
      row: results.length + 1,
      sheetRowNumber: i + 1,
      rawByField,
    });
  }

  return results;
}

/**
 * Kiểm tra lỗi chi tiết theo từng dòng và từng cột (Mục 8.2.5 — Kiểm tra lỗi theo từng dòng và cột, báo rõ nguyên nhân),
 * đồng thời phát hiện trùng lặp nội bộ ngay trong file upload trên các trường `uniqueKeyFields`.
 */
export function validateImportRowsAndCells<TRow>(
  rows: readonly TRow[],
  extractedRows: readonly ExtractedImportMatrixRow[],
  mapping: ResolvedImportColumnMappingResult,
  rowSchema: z.ZodType<TRow>,
  uniqueKeyFields: readonly string[] = [],
): {
  readonly validRows: ReadonlyArray<{
    readonly row: number;
    readonly sheetRowNumber: number;
    readonly data: TRow;
  }>;
  readonly issues: readonly ImportCellIssue[];
} {
  const matchByField = new Map<string, ResolvedImportColumnMatch>(
    mapping.matches.map((m) => [m.field, m]),
  );
  const seenByUniqueField = new Map<string, Map<string, number>>();
  for (const uf of uniqueKeyFields) {
    seenByUniqueField.set(uf, new Map<string, number>());
  }

  const validRows: Array<{
    readonly row: number;
    readonly sheetRowNumber: number;
    readonly data: TRow;
  }> = [];
  const issues: ImportCellIssue[] = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const rawRow = rows[idx]!;
    const extracted = extractedRows[idx];
    const rowNumber = extracted?.row ?? idx + 1;
    const sheetRowNumber = extracted?.sheetRowNumber ?? idx + 2;

    const parsed = rowSchema.safeParse(rawRow);
    let hasRowError = false;

    if (!parsed.success) {
      hasRowError = true;
      for (const zIssue of parsed.error.issues) {
        const fieldName = zIssue.path[0] !== undefined ? String(zIssue.path[0]) : null;
        const colMatch = fieldName ? matchByField.get(fieldName) : undefined;
        const columnHeader = colMatch?.matchedHeader ?? colMatch?.header ?? fieldName;
        const columnLetter = colMatch?.matchedColumnLetter ?? null;
        const rawValue =
          fieldName !== null
            ? (extracted?.rawByField[fieldName] ?? (rawRow as Record<string, unknown>)[fieldName])
            : undefined;

        issues.push({
          row: rowNumber,
          sheetRowNumber,
          column: columnHeader ?? null,
          columnLetter,
          field: fieldName,
          code: 'VALIDATION_ERROR',
          value: rawValue,
          message: columnHeader
            ? `[Row ${rowNumber}, Col "${columnHeader}"${columnLetter ? ` (${columnLetter})` : ''}]: ${zIssue.message}`
            : zIssue.message,
        });
      }
    }

    const candidateRecord = (parsed.success ? parsed.data : rawRow) as Record<string, unknown>;

    for (const uniqueField of uniqueKeyFields) {
      const val = candidateRecord[uniqueField];
      const normalizedVal = typeof val === 'string' ? val.trim().toLowerCase() : '';
      if (!normalizedVal) continue;

      const seenMap = seenByUniqueField.get(uniqueField)!;
      const firstRow = seenMap.get(normalizedVal);
      if (firstRow !== undefined) {
        hasRowError = true;
        const colMatch = matchByField.get(uniqueField);
        const columnHeader = colMatch?.matchedHeader ?? colMatch?.header ?? uniqueField;
        const columnLetter = colMatch?.matchedColumnLetter ?? null;
        issues.push({
          row: rowNumber,
          sheetRowNumber,
          column: columnHeader,
          columnLetter,
          field: uniqueField,
          code: 'DUPLICATE_IN_FILE',
          value: val,
          message: `Duplicate ${uniqueField} "${String(val)}" in file (already appeared at row ${firstRow})`,
        });
      } else {
        seenMap.set(normalizedVal, rowNumber);
      }
    }

    if (!hasRowError && parsed.success) {
      validRows.push({
        row: rowNumber,
        sheetRowNumber,
        data: parsed.data,
      });
    }
  }

  return {
    validRows,
    issues,
  };
}

/**
 * Xây dựng kết quả Xem trước (Preview / Dry-run — Mục 8.2.4) trước khi thực thi Import chính thức.
 */
export function buildImportPreviewResult<TRow>(params: {
  readonly profileCode: string;
  readonly mapping: ResolvedImportColumnMappingResult;
  readonly extractedRows: readonly ExtractedImportMatrixRow[];
  readonly validRows: ReadonlyArray<{
    readonly row: number;
    readonly sheetRowNumber: number;
    readonly data: TRow;
  }>;
  readonly validationIssues: readonly ImportCellIssue[];
  readonly existingDuplicates: ReadonlyMap<number, ExistingDuplicateMatch>;
  readonly duplicateStrategy: ImportDuplicateStrategy;
  readonly previewLimit?: number | undefined;
}): ImportPreviewResult<TRow> {
  const previewLimit = Math.min(200, Math.max(1, params.previewLimit ?? 20));
  const validByRow = new Map<number, TRow>();
  for (const v of params.validRows) {
    validByRow.set(v.row, v.data);
  }

  const issuesByRow = new Map<number, ImportCellIssue[]>();
  for (const iss of params.validationIssues) {
    const list = issuesByRow.get(iss.row) ?? [];
    list.push(iss);
    issuesByRow.set(iss.row, list);
  }

  const matchByField = new Map<string, ResolvedImportColumnMatch>(
    params.mapping.matches.map((m) => [m.field, m]),
  );

  const allIssues: ImportCellIssue[] = [...params.validationIssues];
  const sampleRows: ImportPreviewRowItem<TRow>[] = [];

  let validRowsCount = 0;
  let invalidRowsCount = 0;
  let duplicateRowsCount = 0;
  let willCreateCount = 0;
  let willUpdateCount = 0;
  let willSkipCount = 0;
  let willRejectCount = 0;

  for (const extracted of params.extractedRows) {
    const rowNum = extracted.row;
    const sheetRowNumber = extracted.sheetRowNumber;
    const rowIssues = [...(issuesByRow.get(rowNum) ?? [])];
    const parsedRow = validByRow.get(rowNum) ?? null;
    const existingDup = params.existingDuplicates.get(rowNum);

    let status: ImportPreviewRowItem<TRow>['status'] = 'VALID';

    if (!parsedRow || rowIssues.length > 0) {
      invalidRowsCount++;
      willRejectCount++;
      status = 'INVALID';
    } else if (existingDup) {
      duplicateRowsCount++;
      if (params.duplicateStrategy === IMPORT_DUPLICATE_STRATEGY.SKIP) {
        validRowsCount++;
        willSkipCount++;
        status = 'DUPLICATE_SKIP';
      } else if (params.duplicateStrategy === IMPORT_DUPLICATE_STRATEGY.UPDATE) {
        validRowsCount++;
        willUpdateCount++;
        status = 'DUPLICATE_UPDATE';
      } else {
        invalidRowsCount++;
        willRejectCount++;
        status = 'DUPLICATE_REJECT';
        const colMatch = matchByField.get(existingDup.matchedField);
        const dupIssue: ImportCellIssue = {
          row: rowNum,
          sheetRowNumber,
          column: colMatch?.matchedHeader ?? colMatch?.header ?? existingDup.matchedField,
          columnLetter: colMatch?.matchedColumnLetter ?? null,
          field: existingDup.matchedField,
          code: 'DUPLICATE_IN_DB',
          value: existingDup.matchedValue,
          message: `Duplicate ${existingDup.matchedField} in database: ${existingDup.matchedValue}`,
        };
        rowIssues.push(dupIssue);
        allIssues.push(dupIssue);
      }
    } else {
      validRowsCount++;
      willCreateCount++;
      status = 'VALID';
    }

    if (sampleRows.length < previewLimit) {
      sampleRows.push({
        row: rowNum,
        sheetRowNumber,
        rawValues: extracted.rawByField,
        parsedRow,
        status,
        existingRecordId: existingDup?.existingId ?? null,
        issues: rowIssues,
      });
    }
  }

  return {
    profileCode: params.profileCode,
    detectedHeaders: params.mapping.detectedHeaders,
    headerRowIndex: params.mapping.headerRowIndex,
    columnMatches: params.mapping.matches,
    unmappedRequiredFields: params.mapping.unmappedRequiredFields,
    totalRows: params.extractedRows.length,
    validRowsCount,
    invalidRowsCount,
    duplicateRowsCount,
    willCreateCount,
    willUpdateCount,
    willSkipCount,
    willRejectCount,
    duplicateStrategy: params.duplicateStrategy,
    sampleRows,
    issues: allIssues,
  };
}
