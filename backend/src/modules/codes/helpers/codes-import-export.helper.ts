import {
  BadRequestAppException,
  CODE_ITEM_STATUS,
  type CodeRegistryService,
  type ResolvedCodeValueView,
  buildCsvContent,
  buildXlsxBuffer,
  cleanSpreadsheetCell,
  createSpreadsheetColumnFinder,
  defaultExportRegistry,
  defaultSettingRegistry,
  detectSpreadsheetHeaderRowIndex,
  parseCsvToMatrix,
  parseXlsxToMatrix,
  resolveExportMaxRows,
  sanitizeExportFilters,
} from '@packages/kernel/index.js';
import {
  LocaleContext,
  LocaleFormatter,
  resolveSystemDefaultLocale,
} from '@packages/i18n/index.js';
import { CODES_EXPORT_HEADERS, CODES_SETTING_KEYS } from '../enum/codes.enum.js';
import {
  type BulkImportCodeValueRowInput,
  type BulkImportCodesRequest,
  bulkImportCodeValueRowSchema,
} from '../requests/codes.requests.js';
import type {
  BulkImportCodesResultResponse,
  ExportCodesResponse,
} from '../responses/codes.response.js';
import type {
  BuildCodesExportPayloadParams,
  ExecuteBulkImportCodesParams,
} from '../types/codes.types.js';

export { CODES_EXPORT_HEADERS };

export function formatCodeExportRow(
  registry: CodeRegistryService,
  stt: number,
  typeCode: string,
  typeName: string,
  val: ResolvedCodeValueView,
): Array<string | number> {
  return [
    stt,
    typeCode,
    typeName,
    val.numericCode,
    val.code,
    val.behaviorCode ?? val.code,
    val.labels.vi || val.name,
    val.labels.en || registry.getLabel(typeCode, val.numericCode, 'en'),
    val.aliases.join('|'),
    val.sortOrder,
    val.status === CODE_ITEM_STATUS.INACTIVE ? 'Khóa (INACTIVE)' : 'Hoạt động (ACTIVE)',
    val.isSystem ? 'Hệ thống' : 'Tùy chỉnh',
  ];
}

export function mapMatrixToImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  fallbackTypeCode = '',
): BulkImportCodeValueRowInput[] {
  if (matrix.length < 2) return [];

  const headerRowIdx = detectSpreadsheetHeaderRowIndex(matrix, [
    'mã mục',
    'ma muc',
    'code',
    'value_code',
    'mã nhóm danh mục',
    'ma nhom danh muc',
    'type_code',
    'typecode',
    'tên hiển thị',
    'ten hien thi',
    'name',
  ]);

  if (headerRowIdx >= matrix.length - 1) return [];
  const idxOf = createSpreadsheetColumnFinder(matrix[headerRowIdx]!);

  const typeCodeIdx = idxOf([
    'mã nhóm danh mục',
    'ma nhom danh muc',
    'typecode',
    'type_code',
    'nhóm danh mục',
  ]);
  const typeNameIdx = idxOf(['tên nhóm danh mục', 'ten nhom danh muc', 'typename', 'type_name']);
  const numericIdx = idxOf(['mã số', 'ma so', 'numericcode', 'numeric_code']);
  const codeIdx = idxOf(['mã mục', 'ma muc', 'code', 'value_code', 'mã danh mục']);
  const behaviorIdx = idxOf(['mã hành vi', 'ma hanh vi', 'behaviorcode', 'behavior_code']);
  const nameViIdx = idxOf(['tên hiển thị', 'ten hien thi', 'name', 'tên mục', 'label_vi', 'vi']);
  const nameEnIdx = idxOf(['tên tiếng anh', 'ten tieng anh', 'label_en', 'en', 'english']);
  const aliasesIdx = idxOf(['từ đồng nghĩa', 'tu dong nghia', 'aliases', 'alias']);
  const sortOrderIdx = idxOf(['thứ tự', 'thu tu', 'sortorder', 'sort_order']);
  const statusIdx = idxOf(['trạng thái', 'trang thai', 'status']);

  const rows: BulkImportCodeValueRowInput[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i]!;
    const getCell = (idx: number): string =>
      idx >= 0 ? cleanSpreadsheetCell(cells[idx] ?? '') : '';

    const code = getCell(codeIdx).toUpperCase();
    const nameVi = getCell(nameViIdx);
    if (!code && !nameVi) continue;

    const typeCode = (getCell(typeCodeIdx) || fallbackTypeCode).toLowerCase();
    const typeName = getCell(typeNameIdx) || undefined;
    const rawNumeric = getCell(numericIdx);
    const numericCode =
      rawNumeric && Number.isInteger(Number(rawNumeric)) && Number(rawNumeric) > 0
        ? Number(rawNumeric)
        : undefined;
    const behaviorCode = getCell(behaviorIdx) ? getCell(behaviorIdx).toUpperCase() : undefined;
    const nameEn = getCell(nameEnIdx);
    const labels: Record<string, string> = {};
    if (nameVi) labels.vi = nameVi;
    if (nameEn) labels.en = nameEn;

    const aliases = getCell(aliasesIdx)
      .split(/[|;,]/)
      .map((s) => cleanSpreadsheetCell(s))
      .filter(Boolean);

    const rawSort = getCell(sortOrderIdx);
    const sortOrder =
      rawSort && Number.isInteger(Number(rawSort)) && Number(rawSort) >= 0
        ? Number(rawSort)
        : undefined;

    const rawStatus = getCell(statusIdx).toUpperCase();
    const status =
      rawStatus === '2' || rawStatus.includes('INACTIVE') || rawStatus.includes('KHÓA')
        ? CODE_ITEM_STATUS.INACTIVE
        : CODE_ITEM_STATUS.ACTIVE;

    rows.push({
      typeCode,
      ...(typeName ? { typeName } : {}),
      ...(numericCode !== undefined ? { numericCode } : {}),
      code,
      ...(behaviorCode ? { behaviorCode } : {}),
      name: nameVi || code,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      status,
    });
  }

  return rows;
}

export function parseImportPayloadToRows(
  dto: BulkImportCodesRequest,
  fallbackTypeCode: string,
): BulkImportCodeValueRowInput[] {
  if (dto.xlsxBase64) {
    try {
      const matrix = parseXlsxToMatrix(dto.xlsxBase64);
      return mapMatrixToImportRows(matrix, fallbackTypeCode);
    } catch (err: unknown) {
      throw new BadRequestAppException('codes.invalidXlsxFile', [
        err instanceof Error ? err.message : 'Unable to parse .xlsx file',
      ]);
    }
  }
  if (dto.csvContent) {
    const matrix = parseCsvToMatrix(dto.csvContent);
    return mapMatrixToImportRows(matrix, fallbackTypeCode);
  }
  return (dto.items ?? []).map((item) => ({
    ...item,
    typeCode: item.typeCode ?? (fallbackTypeCode || undefined),
  }));
}

export async function executeBulkImportCodeValues(
  params: ExecuteBulkImportCodesParams,
): Promise<BulkImportCodesResultResponse> {
  const {
    dto,
    fallbackTypeCode,
    codeTypeRepository,
    codeValueRepository,
    manifestCodeTypes,
    registry,
    settingRegistry = defaultSettingRegistry,
    syncManifests,
    createCodeValue,
  } = params;

  const rawRows = parseImportPayloadToRows(dto, fallbackTypeCode);
  const maxImportRows = settingRegistry.getNumber(
    CODES_SETTING_KEYS.IMPORT_MAX_ROWS,
    undefined,
    5000,
  );
  if (rawRows.length > maxImportRows) {
    throw new BadRequestAppException('codes.importMaxRowsExceeded', [
      { totalRows: rawRows.length, maxRows: maxImportRows },
    ]);
  }
  const autoCreateMissingType = settingRegistry.getBoolean(
    CODES_SETTING_KEYS.IMPORT_AUTO_CREATE_MISSING_TYPE,
    undefined,
    true,
  );

  const errors: Array<{ row: number; identifier: string; message: string }> = [];
  const importedCodes: string[] = [];
  let skippedCount = 0;

  const seenCodesInBatch = new Set<string>();
  const seenNumericsInBatch = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 1;
    const raw = rawRows[i]!;
    const resolvedTypeCode = (raw.typeCode || fallbackTypeCode).trim().toLowerCase();
    const rawCode = (raw.code ?? '').trim().toUpperCase();
    const identifier = resolvedTypeCode
      ? `${resolvedTypeCode}:${rawCode || rowNumber}`
      : rawCode || `row-${rowNumber}`;

    if (!resolvedTypeCode) {
      errors.push({
        row: rowNumber,
        identifier,
        message: 'Missing typeCode for master data row',
      });
      continue;
    }

    const parsed = bulkImportCodeValueRowSchema.safeParse({
      ...raw,
      typeCode: resolvedTypeCode,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues.map((iss) => iss.message).join('; ');
      errors.push({ row: rowNumber, identifier, message: msg });
      continue;
    }

    const validRow = parsed.data;
    const normalizedValueCode = validRow.code.trim().toUpperCase();
    const batchCodeKey = `${resolvedTypeCode}:${normalizedValueCode}`;

    if (seenCodesInBatch.has(batchCodeKey)) {
      if (dto.skipDuplicates) {
        skippedCount++;
        continue;
      }
      errors.push({
        row: rowNumber,
        identifier,
        message: `Duplicate value code in import payload: ${normalizedValueCode} (${resolvedTypeCode})`,
      });
      continue;
    }

    if (validRow.numericCode !== undefined) {
      const batchNumKey = `${resolvedTypeCode}:${validRow.numericCode}`;
      if (seenNumericsInBatch.has(batchNumKey)) {
        if (dto.skipDuplicates) {
          skippedCount++;
          continue;
        }
        errors.push({
          row: rowNumber,
          identifier,
          message: `Duplicate numericCode in import payload: ${validRow.numericCode} (${resolvedTypeCode})`,
        });
        continue;
      }
    }

    let codeType = await codeTypeRepository.findByCode(resolvedTypeCode);
    if (!codeType && manifestCodeTypes.has(resolvedTypeCode)) {
      await syncManifests();
      codeType = await codeTypeRepository.findByCode(resolvedTypeCode);
    }
    if (!codeType) {
      if (!autoCreateMissingType) {
        errors.push({
          row: rowNumber,
          identifier,
          message: `Code type '${resolvedTypeCode}' does not exist and auto-creation is disabled`,
        });
        continue;
      }
      const inferredMod = resolvedTypeCode.includes('.')
        ? resolvedTypeCode.split('.')[0]!
        : 'common';
      codeType = await codeTypeRepository.saveEntity({
        code: resolvedTypeCode,
        module: inferredMod,
        name: validRow.typeName?.trim() || resolvedTypeCode,
        description: null,
        isSystem: false,
        allowCustomValues: true,
        status: CODE_ITEM_STATUS.ACTIVE,
      });
      registry.registerCodeType({
        id: Number(codeType.id),
        code: codeType.code,
        module: codeType.module,
        name: codeType.name,
        isSystem: false,
        allowCustomValues: true,
        status: CODE_ITEM_STATUS.ACTIVE,
      });
    }

    if (!codeType.allowCustomValues) {
      errors.push({
        row: rowNumber,
        identifier,
        message: `Code type '${resolvedTypeCode}' does not allow custom values`,
      });
      continue;
    }

    const existingValues = await codeValueRepository.findByTypeCode(resolvedTypeCode, true);
    const dupByCode = existingValues.find(
      (v) => v.code.trim().toUpperCase() === normalizedValueCode,
    );
    const dupByNumeric =
      validRow.numericCode !== undefined
        ? existingValues.find((v) => Number(v.numericCode) === Number(validRow.numericCode))
        : undefined;

    if (dupByCode || dupByNumeric) {
      if (dto.skipDuplicates) {
        skippedCount++;
        continue;
      }
      errors.push({
        row: rowNumber,
        identifier,
        message: dupByCode
          ? `Duplicate value code in database: ${normalizedValueCode} (${resolvedTypeCode})`
          : `Duplicate numericCode in database: ${validRow.numericCode} (${resolvedTypeCode})`,
      });
      continue;
    }

    seenCodesInBatch.add(batchCodeKey);
    if (validRow.numericCode !== undefined) {
      seenNumericsInBatch.add(`${resolvedTypeCode}:${validRow.numericCode}`);
    }

    try {
      const created = await createCodeValue(resolvedTypeCode, {
        numericCode: validRow.numericCode,
        code: normalizedValueCode,
        behaviorCode: validRow.behaviorCode ?? normalizedValueCode,
        name: validRow.name,
        description: validRow.description ?? null,
        labels: validRow.labels ?? { vi: validRow.name },
        aliases: validRow.aliases,
        color: validRow.color ?? null,
        icon: validRow.icon ?? null,
        sortOrder: validRow.sortOrder,
        isDefault: validRow.isDefault,
        status: validRow.status ?? CODE_ITEM_STATUS.ACTIVE,
      });
      importedCodes.push(`${resolvedTypeCode}:${created.code}`);
    } catch (err: unknown) {
      errors.push({
        row: rowNumber,
        identifier,
        message: err instanceof Error ? err.message : 'Failed to import code value',
      });
    }
  }

  return {
    totalRows: rawRows.length,
    importedCount: importedCodes.length,
    skippedCount,
    failedCount: errors.length,
    importedCodes,
    errors,
  };
}

export function buildCodesExportPayload(
  params: BuildCodesExportPayloadParams,
): ExportCodesResponse {
  const {
    registry,
    settingRegistry = defaultSettingRegistry,
    allTypes,
    query,
    locale = resolveSystemDefaultLocale(),
  } = params;
  const format: 'csv' | 'xlsx' = query.format === 'xlsx' ? 'xlsx' : 'csv';
  const includeInactive = query.includeInactive ?? true;

  const filteredTypes = query.typeCode
    ? allTypes.filter((t) => t.code.toLowerCase() === query.typeCode!.trim().toLowerCase())
    : allTypes;

  const { maxRowsAllowed } = resolveExportMaxRows(
    {
      settingKey: 'codes.export.max_rows',
      defaultMaxRows: settingRegistry.getNumber(CODES_SETTING_KEYS.IMPORT_MAX_ROWS, undefined, 5000),
    },
    settingRegistry,
  );

  const matrixRows: Array<Array<string | number>> = [];
  let stt = 0;

  for (const ct of filteredTypes) {
    if (matrixRows.length >= maxRowsAllowed) break;
    const values = registry.listValues(ct.code, {
      includeInactive,
      locale,
    });
    for (const val of values) {
      if (matrixRows.length >= maxRowsAllowed) break;
      stt++;
      matrixRows.push(formatCodeExportRow(registry, stt, ct.code, ct.name, val));
    }
  }

  const effectiveTimezone = LocaleFormatter.resolveActiveTimezone(LocaleContext.getTimezone());
  const defaultReportTitle = settingRegistry.getString(
    CODES_SETTING_KEYS.EXPORT_DEFAULT_REPORT_TITLE,
    undefined,
    'DANH MỤC DÙNG CHUNG HỆ THỐNG (MASTER DATA)',
  );
  const reportTitle = query.title?.trim() || defaultReportTitle;
  const exportedAtSubtitle = `Ngày xuất dữ liệu: ${LocaleFormatter.formatReportDateTime(new Date(), effectiveTimezone)}`;

  const csvContent = buildCsvContent(CODES_EXPORT_HEADERS, matrixRows);
  const xlsxBuffer = buildXlsxBuffer(CODES_EXPORT_HEADERS, matrixRows, {
    sheetName: 'MasterData',
    title: reportTitle,
    subtitle: exportedAtSubtitle,
    logoPng: query.logoBase64 ?? null,
    centerColumnIndices: [0, 3, 9, 10, 11],
    textColumnIndices: [1, 4, 5],
    freezeHeader: true,
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = `danh_muc_dung_chung_${datePart}.${format}`;

  defaultExportRegistry.startExportHistory({
    profileCode: 'codes',
    module: 'codes',
    fileName,
    format,
    filters: sanitizeExportFilters(query),
    totalExported: matrixRows.length,
    processedRows: matrixRows.length,
    maxRowsApplied: maxRowsAllowed,
    status: 'COMPLETED',
  });

  return {
    fileName,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    totalExported: matrixRows.length,
    csvContent,
    xlsxBase64: xlsxBuffer.toString('base64'),
  };
}

export function buildCodesImportTemplatePayload(
  registry: CodeRegistryService,
  format: 'csv' | 'xlsx' = 'xlsx',
  locale: string = resolveSystemDefaultLocale(),
): ExportCodesResponse {
  const sampleType = registry.getType('codes.region') ?? registry.listTypes()[0] ?? null;
  const sampleValues = sampleType
    ? registry.listValues(sampleType.code, { includeInactive: true, locale }).slice(0, 2)
    : [];

  const sampleRows: Array<Array<string | number>> = sampleValues.map((val, idx) =>
    formatCodeExportRow(registry, idx + 1, sampleType!.code, sampleType!.name, val),
  );

  const csvContent = buildCsvContent(CODES_EXPORT_HEADERS, sampleRows);
  const xlsxBase64 = buildXlsxBuffer(CODES_EXPORT_HEADERS, sampleRows, {
    sheetName: 'MasterDataTemplate',
    centerColumnIndices: [0, 3, 9, 10, 11],
    textColumnIndices: [1, 4, 5],
    freezeHeader: true,
  }).toString('base64');

  return {
    fileName: `mau_import_danh_muc.${format}`,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    totalExported: sampleRows.length,
    csvContent,
    xlsxBase64,
  };
}
