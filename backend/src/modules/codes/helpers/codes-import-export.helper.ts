import {
  BadRequestAppException,
  CODE_ITEM_STATUS,
  type CodeRegistryService,
  type DeclarativeExportColumn,
  type ImportColumnDefinition,
  type ResolvedCodeValueView,
  buildDeclarativeSpreadsheetExport,
  buildImportTemplateFile,
  cleanSpreadsheetCell,
  compileDeclarativeExportColumns,
  defaultExportRegistry,
  defaultSettingRegistry,
  extractDeclarativeImportMatrixData,
  parseDeclarativeImportPayload,
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

export interface CodeExportRowItem {
  readonly typeCode: string;
  readonly typeName: string;
  readonly val: ResolvedCodeValueView;
}

/**
 * Khai báo cột Xuất dữ liệu Danh mục dùng chung (Master Data) tập trung 1 chỗ duy nhất (Declarative Export Schema — Mục 8.3).
 */
export const CODES_EXPORT_COLUMNS: readonly DeclarativeExportColumn<
  CodeExportRowItem,
  { readonly registry: CodeRegistryService }
>[] = [
  {
    field: 'stt',
    header: CODES_EXPORT_HEADERS[0],
    width: 8,
    isCenter: true,
    value: (_item, idx) => idx + 1,
  },
  {
    field: 'typeCode',
    header: CODES_EXPORT_HEADERS[1],
    width: 22,
    isText: true,
    value: (item) => item.typeCode,
  },
  { field: 'typeName', header: CODES_EXPORT_HEADERS[2], width: 26, value: (item) => item.typeName },
  {
    field: 'numericCode',
    header: CODES_EXPORT_HEADERS[3],
    width: 12,
    isCenter: true,
    value: (item) => item.val.numericCode,
  },
  {
    field: 'code',
    header: CODES_EXPORT_HEADERS[4],
    width: 18,
    isText: true,
    value: (item) => item.val.code,
  },
  {
    field: 'behaviorCode',
    header: CODES_EXPORT_HEADERS[5],
    width: 18,
    isText: true,
    value: (item) => item.val.behaviorCode ?? item.val.code,
  },
  {
    field: 'labelVi',
    header: CODES_EXPORT_HEADERS[6],
    width: 24,
    value: (item) => item.val.labels.vi || item.val.name,
  },
  {
    field: 'labelEn',
    header: CODES_EXPORT_HEADERS[7],
    width: 24,
    value: (item, _idx, ctx) =>
      item.val.labels.en || ctx.registry.getLabel(item.typeCode, item.val.numericCode, 'en'),
  },
  {
    field: 'aliases',
    header: CODES_EXPORT_HEADERS[8],
    width: 22,
    value: (item) => item.val.aliases.join('|'),
  },
  {
    field: 'sortOrder',
    header: CODES_EXPORT_HEADERS[9],
    width: 12,
    isCenter: true,
    value: (item) => item.val.sortOrder,
  },
  {
    field: 'status',
    header: CODES_EXPORT_HEADERS[10],
    width: 18,
    isCenter: true,
    value: (item) =>
      item.val.status === CODE_ITEM_STATUS.INACTIVE ? 'Khóa (INACTIVE)' : 'Hoạt động (ACTIVE)',
  },
  {
    field: 'isSystem',
    header: CODES_EXPORT_HEADERS[11],
    width: 16,
    isCenter: true,
    value: (item) => (item.val.isSystem ? 'Hệ thống' : 'Tùy chỉnh'),
  },
] as const;

const COMPILED_CODES_EXPORT_SCHEMA = compileDeclarativeExportColumns(CODES_EXPORT_COLUMNS);

/**
 * Khai báo cột Import Danh mục dùng chung (Master Data) tập trung 1 chỗ duy nhất (Declarative Import Schema — Mục 8.2).
 */
export const CODES_IMPORT_COLUMNS: readonly ImportColumnDefinition[] = [
  { field: 'stt', header: CODES_EXPORT_HEADERS[0], width: 8, isCenter: true },
  {
    field: 'typeCode',
    header: CODES_EXPORT_HEADERS[1],
    width: 22,
    isText: true,
    aliases: ['mã nhóm danh mục', 'ma nhom danh muc', 'typecode', 'type_code', 'nhóm danh mục'],
  },
  {
    field: 'typeName',
    header: CODES_EXPORT_HEADERS[2],
    width: 26,
    aliases: ['tên nhóm danh mục', 'ten nhom danh muc', 'typename', 'type_name'],
  },
  {
    field: 'numericCode',
    header: CODES_EXPORT_HEADERS[3],
    width: 12,
    isCenter: true,
    aliases: ['mã số', 'ma so', 'numericcode', 'numeric_code'],
  },
  {
    field: 'code',
    header: CODES_EXPORT_HEADERS[4],
    required: true,
    width: 18,
    isText: true,
    aliases: ['mã mục', 'ma muc', 'code', 'value_code', 'mã danh mục'],
  },
  {
    field: 'behaviorCode',
    header: CODES_EXPORT_HEADERS[5],
    width: 18,
    isText: true,
    aliases: ['mã hành vi', 'ma hanh vi', 'behaviorcode', 'behavior_code'],
  },
  {
    field: 'nameVi',
    header: CODES_EXPORT_HEADERS[6],
    required: true,
    width: 24,
    aliases: ['tên hiển thị', 'ten hien thi', 'name', 'tên mục', 'label_vi', 'vi'],
  },
  {
    field: 'nameEn',
    header: CODES_EXPORT_HEADERS[7],
    width: 24,
    aliases: ['tên tiếng anh', 'ten tieng anh', 'label_en', 'en', 'english'],
  },
  {
    field: 'aliases',
    header: CODES_EXPORT_HEADERS[8],
    width: 22,
    aliases: ['từ đồng nghĩa', 'tu dong nghia', 'aliases', 'alias'],
  },
  {
    field: 'sortOrder',
    header: CODES_EXPORT_HEADERS[9],
    width: 12,
    isCenter: true,
    aliases: ['thứ tự', 'thu tu', 'sortorder', 'sort_order'],
  },
  {
    field: 'status',
    header: CODES_EXPORT_HEADERS[10],
    width: 18,
    isCenter: true,
    aliases: ['trạng thái', 'trang thai', 'status'],
  },
  {
    field: 'source',
    header: CODES_EXPORT_HEADERS[11],
    width: 16,
    isCenter: true,
  },
] as const;

export function formatCodeExportRow(
  registry: CodeRegistryService,
  stt: number,
  typeCode: string,
  typeName: string,
  val: ResolvedCodeValueView,
): Array<string | number> {
  return COMPILED_CODES_EXPORT_SCHEMA.mapItemToRow({ typeCode, typeName, val }, stt - 1, {
    registry,
  });
}

export function mapExtractedCodeImportRow(
  rawByField: Readonly<Record<string, string>>,
  fallbackTypeCode = '',
): BulkImportCodeValueRowInput | null {
  const code = cleanSpreadsheetCell(rawByField['code'] ?? '').toUpperCase();
  const nameVi = cleanSpreadsheetCell(rawByField['nameVi'] ?? '');
  if (!code && !nameVi) return null;

  const typeCode = (
    cleanSpreadsheetCell(rawByField['typeCode'] ?? '') || fallbackTypeCode
  ).toLowerCase();
  const typeName = cleanSpreadsheetCell(rawByField['typeName'] ?? '') || undefined;
  const rawNumeric = cleanSpreadsheetCell(rawByField['numericCode'] ?? '');
  const numericCode =
    rawNumeric && Number.isInteger(Number(rawNumeric)) && Number(rawNumeric) > 0
      ? Number(rawNumeric)
      : undefined;
  const rawBehavior = cleanSpreadsheetCell(rawByField['behaviorCode'] ?? '');
  const behaviorCode = rawBehavior ? rawBehavior.toUpperCase() : undefined;
  const nameEn = cleanSpreadsheetCell(rawByField['nameEn'] ?? '');
  const labels: Record<string, string> = {};
  if (nameVi) labels.vi = nameVi;
  if (nameEn) labels.en = nameEn;

  const aliases = cleanSpreadsheetCell(rawByField['aliases'] ?? '')
    .split(/[|;,]/)
    .map((s) => cleanSpreadsheetCell(s))
    .filter(Boolean);

  const rawSort = cleanSpreadsheetCell(rawByField['sortOrder'] ?? '');
  const sortOrder =
    rawSort && Number.isInteger(Number(rawSort)) && Number(rawSort) >= 0
      ? Number(rawSort)
      : undefined;

  const rawStatus = cleanSpreadsheetCell(rawByField['status'] ?? '').toUpperCase();
  const status =
    rawStatus === '2' || rawStatus.includes('INACTIVE') || rawStatus.includes('KHÓA')
      ? CODE_ITEM_STATUS.INACTIVE
      : CODE_ITEM_STATUS.ACTIVE;

  return {
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
  };
}

export function mapMatrixToImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
  fallbackTypeCode = '',
): BulkImportCodeValueRowInput[] {
  return extractDeclarativeImportMatrixData({
    matrix,
    columns: CODES_IMPORT_COLUMNS,
    mapRawRow: (rawByField) => mapExtractedCodeImportRow(rawByField, fallbackTypeCode),
  }).rows;
}

export function parseImportPayloadToRows(
  dto: BulkImportCodesRequest,
  fallbackTypeCode: string,
): BulkImportCodeValueRowInput[] {
  if (!dto.xlsxBase64 && !dto.csvContent) {
    return (dto.items ?? []).map((item) => ({
      ...item,
      typeCode: item.typeCode ?? (fallbackTypeCode || undefined),
    }));
  }
  return parseDeclarativeImportPayload({
    dto,
    columns: CODES_IMPORT_COLUMNS,
    mapRawRow: (rawByField) => mapExtractedCodeImportRow(rawByField, fallbackTypeCode),
    invalidXlsxErrorKey: 'codes.invalidXlsxFile',
  }).rows;
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
      defaultMaxRows: settingRegistry.getNumber(
        CODES_SETTING_KEYS.IMPORT_MAX_ROWS,
        undefined,
        5000,
      ),
    },
    settingRegistry,
  );

  const exportItems: CodeExportRowItem[] = [];

  for (const ct of filteredTypes) {
    if (exportItems.length >= maxRowsAllowed) break;
    const values = registry.listValues(ct.code, {
      includeInactive,
      locale,
    });
    for (const val of values) {
      if (exportItems.length >= maxRowsAllowed) break;
      exportItems.push({ typeCode: ct.code, typeName: ct.name, val });
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
  const datePart = new Date().toISOString().slice(0, 10);

  const built = buildDeclarativeSpreadsheetExport({
    fileBaseName: `danh_muc_dung_chung_${datePart}`,
    format,
    columns: CODES_EXPORT_COLUMNS,
    items: exportItems,
    context: { registry },
    sheetName: 'MasterData',
    title: reportTitle,
    subtitle: exportedAtSubtitle,
    logoPng: query.logoBase64 ?? null,
  });

  defaultExportRegistry.startExportHistory({
    profileCode: 'codes',
    module: 'codes',
    fileName: built.fileName,
    format,
    filters: sanitizeExportFilters(query),
    totalExported: built.totalExported,
    processedRows: built.totalExported,
    maxRowsApplied: maxRowsAllowed,
    status: 'COMPLETED',
  });

  return {
    fileName: built.fileName,
    contentType: built.contentType,
    format: built.format,
    totalExported: built.totalExported,
    csvContent: built.csvContent,
    xlsxBase64: built.xlsxBase64,
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

  return buildImportTemplateFile({
    fileBaseName: 'mau_import_danh_muc',
    format,
    sheetName: 'MasterDataTemplate',
    columns: CODES_IMPORT_COLUMNS,
    sampleRows,
  });
}
