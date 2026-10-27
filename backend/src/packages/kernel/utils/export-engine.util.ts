import {
  type CompiledDeclarativeExportSchema,
  type DeclarativeExportColumn,
  type ExportFormat,
  type ExportLimitPolicyInput,
  type IPdfExportAdapter,
  type PdfExportBuildOptions,
  type ResolvedExportLimit,
  EXPORT_FORMAT,
  resolveExportContentType,
  resolveExportFormat,
} from '../contracts/export.contract.js';
import type { SettingResolveContext } from '../contracts/setting-lookup.contract.js';
import { BadRequestAppException, ForbiddenAppException } from '../errors/http-exceptions.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
} from '../registries/setting-registry.service.js';
import { safeJsonParseObject } from './json.util.js';
import {
  type XlsxBuildOptions,
  buildCsvContent,
  buildXlsxBuffer,
  escapeCsvCell,
} from './spreadsheet.util.js';

const DEFAULT_EXPORT_MAX_ROWS = 5_000;
const DEFAULT_PRIVILEGED_EXPORT_MAX_ROWS = 50_000;

const DEFAULT_PRIVILEGED_ROLES = ['super_admin', 'system_admin', 'admin', 'root'] as const;
const DEFAULT_NON_FILTER_QUERY_KEYS = new Set<string>([
  'page',
  'limit',
  'countMode',
  'format',
  'title',
  'logoBase64',
  'stepUpToken',
  'requireStepUp',
  'async',
  'notifyOnComplete',
  'ttlSeconds',
  'enforceStrictLimit',
  'onlyRequestedFormat',
]);

/** Chuẩn hóa chuỗi sang ASCII an toàn cho font Type1 chuẩn trong tài liệu PDF 1.4 cơ bản */
function normalizePdfTextLine(text: string): string {
  const ascii = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ' ');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Tạo nội dung PDF 1.4 chuẩn dạng bảng văn bản nhẹ (Zero-dependency fallback).
 * Dùng cho `SimpleTabularPdfAdapter` hoặc kiểm thử nhanh khi dự án chưa cài thư viện PDF bên ngoài.
 */
export function buildMinimalTabularPdfBuffer(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
  options: PdfExportBuildOptions = {},
): Buffer {
  const lines: string[] = [];
  if (options.title?.trim()) {
    lines.push(options.title.trim());
  }
  if (options.subtitle?.trim()) {
    lines.push(options.subtitle.trim());
  }
  if (lines.length > 0) {
    lines.push('-'.repeat(90));
  }
  lines.push(headers.join(' | '));
  lines.push('-'.repeat(90));

  const maxPdfRows = Math.min(rows.length, 500);
  for (let i = 0; i < maxPdfRows; i++) {
    const row = rows[i] ?? [];
    lines.push(row.map((cell) => String(cell ?? '')).join(' | '));
  }
  if (rows.length > maxPdfRows) {
    lines.push(`... (${rows.length - maxPdfRows} more rows omitted in preview PDF)`);
  }
  if (options.footerText?.trim()) {
    lines.push('-'.repeat(90));
    lines.push(options.footerText.trim());
  }

  const streamOps: string[] = ['BT', '/F1 9 Tf', '36 560 Td', '12 TL'];
  for (const line of lines) {
    streamOps.push(`(${normalizePdfTextLine(line)}) Tj`, 'T*');
  }
  streamOps.push('ET');
  const contentStream = streamOps.join('\n');
  const contentByteLength = Buffer.byteLength(contentStream, 'utf8');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${contentByteLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

/**
 * Adapter xuất PDF nhẹ tích hợp sẵn (Mục 8.3.3 — Hỗ trợ xuất PDF qua adapter).
 * Dự án có thể thay thế bằng adapter riêng (PDFKit, Puppeteer, Gotenberg...) qua `ExportRegistryService.registerPdfAdapter(...)`.
 */
export class SimpleTabularPdfAdapter implements IPdfExportAdapter {
  public readonly name = 'builtin-tabular-pdf';

  public buildPdfBuffer(
    headers: readonly string[],
    rows: ReadonlyArray<ReadonlyArray<string | number>>,
    options?: PdfExportBuildOptions,
  ): Buffer {
    return buildMinimalTabularPdfBuffer(headers, rows, options);
  }
}

/**
 * Giải quyết giới hạn số lượng bản ghi được phép xuất theo cả **Quyền/Vai trò** và **Cấu hình động**
 * (Mục 8.3.6 — Giới hạn số lượng bản ghi được xuất: Theo quyền và cấu hình).
 */
export function resolveExportMaxRows(
  input: ExportLimitPolicyInput,
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): ResolvedExportLimit {
  const defaultMaxRows = Math.max(1, input.defaultMaxRows ?? DEFAULT_EXPORT_MAX_ROWS);
  const defaultPrivilegedMax = Math.max(
    defaultMaxRows,
    input.privilegedMaxRows ?? DEFAULT_PRIVILEGED_EXPORT_MAX_ROWS,
  );

  const actor = input.actor ?? undefined;
  const orgUnitId = input.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? undefined;

  const lookupCtx: SettingResolveContext | undefined =
    orgUnitId !== undefined && orgUnitId !== null ? { organizationUnitId: orgUnitId } : undefined;

  const configuredBaseMax = settingRegistry.getNumber(input.settingKey, lookupCtx, defaultMaxRows);
  const baseMaxRows = Math.max(1, configuredBaseMax);

  const actorPermissions = new Set(
    (actor?.permissions ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  const actorRoles = (actor?.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);

  const modulePrefix = input.settingKey.split('.')[0] ?? 'system';
  const unlimitedPerms = (
    input.unlimitedPermissions ?? [
      `${modulePrefix}.export.unlimited`,
      'export.unlimited',
      'system.admin',
      '*',
    ]
  ).map((p) => p.trim().toLowerCase());

  const hasUnlimitedPermission = unlimitedPerms.some((perm) => actorPermissions.has(perm));

  const privilegedRoleSet = new Set(
    (input.privilegedRoles ?? DEFAULT_PRIVILEGED_ROLES).map((r) => r.trim().toLowerCase()),
  );
  const hasPrivilegedRole = actorRoles.some((r) => privilegedRoleSet.has(r));

  // Kiểm tra giới hạn cấu hình theo từng vai trò (nếu có truyền `roleLimits` hoặc `roleLimitsSettingKey`)
  let roleSpecificMax = 0;
  const roleLimitsMap: Record<string, number> = { ...(input.roleLimits ?? {}) };
  if (input.roleLimitsSettingKey) {
    const rawRoleConfig = settingRegistry.getString(input.roleLimitsSettingKey, lookupCtx, '');
    if (rawRoleConfig.trim()) {
      const parsed = safeJsonParseObject<Record<string, unknown>>(rawRoleConfig, {});
      for (const [k, v] of Object.entries(parsed)) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          roleLimitsMap[k.trim().toLowerCase()] = Math.floor(num);
        }
      }
    }
  }
  for (const roleCode of actorRoles) {
    const candidate = roleLimitsMap[roleCode] ?? roleLimitsMap[roleCode.toUpperCase()];
    if (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      candidate > roleSpecificMax
    ) {
      roleSpecificMax = Math.floor(candidate);
    }
  }

  let maxRowsAllowed = baseMaxRows;
  let isPrivileged = false;
  let appliedPolicy: ResolvedExportLimit['appliedPolicy'] =
    configuredBaseMax !== defaultMaxRows ? 'setting' : 'default';

  if (hasUnlimitedPermission) {
    const privKey = input.privilegedSettingKey ?? `${modulePrefix}.export.privileged_max_rows`;
    maxRowsAllowed = Math.max(
      baseMaxRows,
      settingRegistry.getNumber(privKey, lookupCtx, defaultPrivilegedMax),
    );
    isPrivileged = true;
    appliedPolicy = 'permission';
  } else if (roleSpecificMax > 0) {
    maxRowsAllowed = roleSpecificMax;
    isPrivileged = roleSpecificMax > baseMaxRows;
    appliedPolicy = 'role';
  } else if (hasPrivilegedRole) {
    const privKey = input.privilegedSettingKey ?? `${modulePrefix}.export.privileged_max_rows`;
    maxRowsAllowed = Math.max(
      baseMaxRows,
      settingRegistry.getNumber(privKey, lookupCtx, defaultPrivilegedMax),
    );
    isPrivileged = true;
    appliedPolicy = 'role';
  }

  if (
    input.enforceStrictLimit === true &&
    typeof input.requestedLimit === 'number' &&
    input.requestedLimit > maxRowsAllowed
  ) {
    throw new ForbiddenAppException('export.maxRowsExceeded', [
      {
        requestedLimit: input.requestedLimit,
        maxRowsAllowed,
        appliedPolicy,
      },
    ]);
  }

  const effectiveLimit =
    typeof input.requestedLimit === 'number' && input.requestedLimit > 0
      ? Math.min(Math.floor(input.requestedLimit), maxRowsAllowed)
      : maxRowsAllowed;

  return {
    maxRowsAllowed,
    effectiveLimit,
    isPrivileged,
    appliedPolicy,
  };
}

/**
 * Trích xuất và làm sạch bộ lọc đã áp dụng khi Xuất dữ liệu để ghi vào Lịch sử Export & Audit Log
 * (Mục 8.3.1 & 8.3.7 — Giữ đúng bộ lọc hiện tại & Ghi lịch sử Export kèm bộ lọc).
 */
export function sanitizeExportFilters(
  rawQuery?: Record<string, unknown> | object | null,
  extraExcludedKeys: readonly string[] = [],
): Record<string, unknown> {
  if (!rawQuery || typeof rawQuery !== 'object') {
    return {};
  }

  const excluded = new Set<string>(DEFAULT_NON_FILTER_QUERY_KEYS);
  for (const k of extraExcludedKeys) {
    excluded.add(k);
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawQuery as Record<string, unknown>)) {
    if (excluded.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Xây dựng nội dung file Xuất dữ liệu (`.xlsx`, `.csv`, hoặc `.pdf` qua adapter) dùng chung cho mọi module
 * (Mục 8.3.1, 8.3.2 & 8.3.3).
 */
export async function buildExportFileArtifact(params: {
  readonly fileBaseName: string;
  readonly format?: ExportFormat | string | null | undefined;
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
  readonly xlsxOptions?: XlsxBuildOptions | undefined;
  readonly pdfOptions?: PdfExportBuildOptions | undefined;
  readonly pdfAdapter?: IPdfExportAdapter | null | undefined;
  /** Nếu `true`, chỉ sinh đúng định dạng được yêu cầu để tối ưu bộ nhớ cho tập dữ liệu lớn (Mục 8.3.2) */
  readonly onlyRequestedFormat?: boolean | undefined;
}): Promise<{
  readonly fileName: string;
  readonly contentType: string;
  readonly format: ExportFormat;
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
  readonly pdfBase64?: string | undefined;
  readonly primaryBuffer: Buffer;
}> {
  const format = resolveExportFormat(params.format, EXPORT_FORMAT.CSV);
  const contentType = resolveExportContentType(format);
  const cleanBase = params.fileBaseName.replace(/\.(xlsx|csv|pdf)$/i, '');
  const fileName = `${cleanBase}.${format}`;
  const onlyRequested = params.onlyRequestedFormat === true;

  let csvContent = '';
  let xlsxBase64 = '';
  let pdfBase64: string | undefined;
  let primaryBuffer: Buffer;

  if (format === EXPORT_FORMAT.PDF) {
    if (!params.pdfAdapter) {
      throw new BadRequestAppException('export.pdfAdapterNotConfigured', [
        'PDF export adapter is not registered for this project',
      ]);
    }
    const pdfBuf = await params.pdfAdapter.buildPdfBuffer(params.headers, params.rows, {
      ...(params.xlsxOptions?.title !== undefined ? { title: params.xlsxOptions.title } : {}),
      ...(params.xlsxOptions?.subtitle !== undefined
        ? { subtitle: params.xlsxOptions.subtitle }
        : {}),
      ...(params.xlsxOptions?.columnWidths !== undefined
        ? { columnWidths: params.xlsxOptions.columnWidths }
        : {}),
      ...(params.xlsxOptions?.centerColumnIndices !== undefined
        ? { centerColumnIndices: params.xlsxOptions.centerColumnIndices }
        : {}),
      ...(params.pdfOptions ?? {}),
    });
    primaryBuffer = Buffer.isBuffer(pdfBuf) ? pdfBuf : Buffer.from(pdfBuf);
    pdfBase64 = primaryBuffer.toString('base64');

    if (!onlyRequested) {
      csvContent = buildCsvContent(params.headers, params.rows);
      xlsxBase64 = buildXlsxBuffer(params.headers, params.rows, params.xlsxOptions).toString(
        'base64',
      );
    }
  } else if (format === EXPORT_FORMAT.CSV) {
    const lines: string[] = [params.headers.join(',')];
    for (const row of params.rows) {
      lines.push(row.map((v) => escapeCsvCell(v)).join(','));
    }
    csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    primaryBuffer = Buffer.from(csvContent, 'utf8');

    if (!onlyRequested) {
      xlsxBase64 = buildXlsxBuffer(params.headers, params.rows, params.xlsxOptions).toString(
        'base64',
      );
    }
  } else {
    const xlsxBuffer = buildXlsxBuffer(params.headers, params.rows, params.xlsxOptions);
    primaryBuffer = xlsxBuffer;
    xlsxBase64 = xlsxBuffer.toString('base64');

    if (!onlyRequested) {
      const lines: string[] = [params.headers.join(',')];
      for (const row of params.rows) {
        lines.push(row.map((v) => escapeCsvCell(v)).join(','));
      }
      csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
    }
  }

  return {
    fileName,
    contentType,
    format,
    totalExported: params.rows.length,
    csvContent,
    xlsxBase64,
    ...(pdfBase64 !== undefined ? { pdfBase64 } : {}),
    primaryBuffer,
  };
}

/**
 * Biên dịch danh sách `DeclarativeExportColumn` thành bộ metadata cột chuẩn (`headers`, `columnWidths`,
 * `centerColumnIndices`, `textColumnIndices`) kèm hàm ánh xạ dòng tự động.
 * Giúp các module chỉ cần khai báo cột 1 chỗ duy nhất mà không cần tự đếm chỉ số cột thủ công.
 */
export function compileDeclarativeExportColumns<TItem = unknown, TContext = undefined>(
  columns: readonly DeclarativeExportColumn<TItem, TContext>[],
): CompiledDeclarativeExportSchema<TItem, TContext> {
  const headers: string[] = [];
  const columnWidths: number[] = [];
  const centerColumnIndices: number[] = [];
  const textColumnIndices: number[] = [];

  columns.forEach((col, idx) => {
    headers.push(col.header);
    columnWidths.push(col.width ?? 18);
    if (col.isCenter) {
      centerColumnIndices.push(idx);
    }
    if (col.isText) {
      textColumnIndices.push(idx);
    }
  });

  const mapItemToRow = (item: TItem, index: number, context: TContext): Array<string | number> =>
    columns.map((col) => {
      const val = col.value(item, index, context);
      return val === null || val === undefined ? '' : val;
    });

  const mapItemsToRows = (
    items: readonly TItem[],
    context: TContext,
  ): Array<Array<string | number>> => items.map((item, idx) => mapItemToRow(item, idx, context));

  return {
    columns,
    headers,
    columnWidths,
    centerColumnIndices,
    textColumnIndices,
    mapItemToRow,
    mapItemsToRows,
  };
}

/**
 * Kết xuất trực tiếp danh sách đối tượng `items` thành file Excel (`.xlsx`), CSV (`.csv`) hoặc PDF (`.pdf`)
 * chỉ từ 1 bảng cấu hình cột `columns` duy nhất (Declarative Export Engine — Mục 8.3).
 */
export async function buildDeclarativeExportArtifact<
  TItem = unknown,
  TContext = undefined,
>(params: {
  readonly fileBaseName: string;
  readonly format?: ExportFormat | string | null | undefined;
  readonly columns: readonly DeclarativeExportColumn<TItem, TContext>[];
  readonly items: readonly TItem[];
  readonly context?: TContext | undefined;
  readonly sheetName?: string | undefined;
  readonly title?: string | null | undefined;
  readonly subtitle?: string | null | undefined;
  readonly logoPng?: Buffer | string | null | undefined;
  readonly landscape?: boolean | undefined;
  readonly footerText?: string | null | undefined;
  readonly pdfAdapter?: IPdfExportAdapter | null | undefined;
  readonly onlyRequestedFormat?: boolean | undefined;
}): Promise<{
  readonly fileName: string;
  readonly contentType: string;
  readonly format: ExportFormat;
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
  readonly pdfBase64?: string | undefined;
  readonly primaryBuffer: Buffer;
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
}> {
  const compiled = compileDeclarativeExportColumns(params.columns);
  const rows = compiled.mapItemsToRows(params.items, params.context as TContext);

  const built = await buildExportFileArtifact({
    fileBaseName: params.fileBaseName,
    format: params.format,
    headers: compiled.headers,
    rows,
    xlsxOptions: {
      sheetName: params.sheetName ?? 'Sheet1',
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
      ...(params.logoPng !== undefined ? { logoPng: params.logoPng } : {}),
      columnWidths: compiled.columnWidths,
      centerColumnIndices: compiled.centerColumnIndices,
      textColumnIndices: compiled.textColumnIndices,
      freezeHeader: true,
    },
    pdfOptions: {
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
      columnWidths: compiled.columnWidths,
      centerColumnIndices: compiled.centerColumnIndices,
      landscape: params.landscape ?? true,
      ...(params.footerText !== undefined ? { footerText: params.footerText } : {}),
    },
    pdfAdapter: params.pdfAdapter,
    onlyRequestedFormat: params.onlyRequestedFormat,
  });

  return {
    ...built,
    rows,
  };
}

/**
 * Kết xuất đồng bộ (Synchronous) danh sách `items` thành gói dữ liệu `.xlsx` + `.csv`
 * chỉ từ 1 bảng cấu hình cột `columns` duy nhất.
 */
export function buildDeclarativeSpreadsheetExport<TItem = unknown, TContext = undefined>(params: {
  readonly fileBaseName: string;
  readonly format?: 'csv' | 'xlsx' | string | null | undefined;
  readonly columns: readonly DeclarativeExportColumn<TItem, TContext>[];
  readonly items: readonly TItem[];
  readonly context?: TContext | undefined;
  readonly sheetName?: string | undefined;
  readonly title?: string | null | undefined;
  readonly subtitle?: string | null | undefined;
  readonly logoPng?: Buffer | string | null | undefined;
}): {
  readonly fileName: string;
  readonly contentType: string;
  readonly format: 'csv' | 'xlsx';
  readonly totalExported: number;
  readonly csvContent: string;
  readonly xlsxBase64: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
} {
  const format: 'csv' | 'xlsx' = params.format === 'csv' ? 'csv' : 'xlsx';
  const compiled = compileDeclarativeExportColumns(params.columns);
  const rows = compiled.mapItemsToRows(params.items, params.context as TContext);

  const csvContent = buildCsvContent(compiled.headers, rows);
  const xlsxBuffer = buildXlsxBuffer(compiled.headers, rows, {
    sheetName: params.sheetName ?? 'Sheet1',
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
    ...(params.logoPng !== undefined ? { logoPng: params.logoPng } : {}),
    columnWidths: compiled.columnWidths,
    centerColumnIndices: compiled.centerColumnIndices,
    textColumnIndices: compiled.textColumnIndices,
    freezeHeader: true,
  });

  const cleanBase = params.fileBaseName.replace(/\.(xlsx|csv)$/i, '');
  return {
    fileName: `${cleanBase}.${format}`,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    totalExported: rows.length,
    csvContent,
    xlsxBase64: xlsxBuffer.toString('base64'),
    rows,
  };
}
