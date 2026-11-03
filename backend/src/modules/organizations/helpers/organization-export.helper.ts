import {
  type DeclarativeExportColumn,
  type ExportRegistryService,
  type ImportRegistryService,
  buildDeclarativeSpreadsheetExport,
  buildImportTemplateFile,
  defaultExportRegistry,
  defaultImportRegistry,
} from '@packages/kernel/index.js';
import { LocaleContext, LocaleFormatter } from '@packages/i18n/index.js';
import {
  ORGANIZATION_EXPORT_LIST_HEADERS,
  ORGANIZATION_EXPORT_TREE_HEADERS,
} from '../enum/organizations.enum.js';
import {
  type BulkImportOrganizationRowInput,
  type BulkImportOrganizationsRequest,
  type ExportOrganizationUnitsQuery,
  bulkImportOrganizationRowSchema,
} from '../requests/organizations.requests.js';
import type {
  BulkImportOrganizationsResultResponse,
  ExportOrganizationsResponse,
  OrganizationTreeNodeResponse,
  OrganizationUnitResponse,
} from '../responses/organizations.response.js';
import { ORGANIZATION_IMPORT_COLUMNS } from './organization-import-export.helper.js';

interface OrganizationTreeExportItem {
  readonly node: OrganizationTreeNodeResponse;
  readonly treeLabel: string;
  readonly parentCode: string;
  readonly managerDisplay: string;
}

/**
 * Khai báo cột Xuất dữ liệu Tổ chức dạng Cây (`tree`) tập trung 1 chỗ duy nhất (Declarative Export Schema — Mục 8.3).
 */
export const ORGANIZATION_EXPORT_TREE_COLUMNS: readonly DeclarativeExportColumn<OrganizationTreeExportItem>[] =
  [
    {
      field: 'stt',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[0],
      width: 8,
      isCenter: true,
      value: (_item, idx) => idx + 1,
    },
    {
      field: 'depth',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[1],
      width: 16,
      isCenter: true,
      value: (item) => item.node.depth,
    },
    {
      field: 'treeLabel',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[2],
      width: 38,
      value: (item) => item.treeLabel,
    },
    {
      field: 'code',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[3],
      width: 18,
      isText: true,
      value: (item) => item.node.code,
    },
    {
      field: 'name',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[4],
      width: 30,
      value: (item) => item.node.name,
    },
    {
      field: 'typeName',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[5],
      width: 18,
      value: (item) => item.node.typeName,
    },
    {
      field: 'parentCode',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[6],
      width: 20,
      isText: true,
      value: (item) => item.parentCode,
    },
    {
      field: 'path',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[7],
      width: 24,
      isText: true,
      value: (item) => item.node.path,
    },
    {
      field: 'childrenCount',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[8],
      width: 20,
      isCenter: true,
      value: (item) => item.node.childrenCount,
    },
    {
      field: 'descendantCount',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[9],
      width: 22,
      isCenter: true,
      value: (item) => item.node.descendantCount,
    },
    {
      field: 'managerDisplay',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[10],
      width: 24,
      value: (item) => item.managerDisplay,
    },
    {
      field: 'statusName',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[11],
      width: 18,
      isCenter: true,
      value: (item) => item.node.statusName,
    },
    {
      field: 'description',
      header: ORGANIZATION_EXPORT_TREE_HEADERS[12],
      width: 32,
      value: (item) => item.node.description ?? '',
    },
  ] as const;

/**
 * Khai báo cột Xuất dữ liệu Tổ chức dạng Danh sách phẳng (`list`) tập trung 1 chỗ duy nhất (Declarative Export Schema — Mục 8.3).
 */
export const ORGANIZATION_EXPORT_LIST_COLUMNS: readonly DeclarativeExportColumn<
  OrganizationUnitResponse,
  { readonly unitById: ReadonlyMap<number, OrganizationUnitResponse> }
>[] = [
  {
    field: 'stt',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[0],
    width: 8,
    isCenter: true,
    value: (_u, idx) => idx + 1,
  },
  {
    field: 'id',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[1],
    width: 10,
    isCenter: true,
    value: (u) => u.id,
  },
  {
    field: 'code',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[2],
    width: 18,
    isText: true,
    value: (u) => u.code,
  },
  { field: 'name', header: ORGANIZATION_EXPORT_LIST_HEADERS[3], width: 30, value: (u) => u.name },
  {
    field: 'typeName',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[4],
    width: 18,
    value: (u) => u.typeName,
  },
  {
    field: 'parentCode',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[5],
    width: 20,
    isText: true,
    value: (u, _idx, ctx) => (u.parentId ? (ctx.unitById.get(u.parentId)?.code ?? '') : ''),
  },
  {
    field: 'parentName',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[6],
    width: 26,
    value: (u, _idx, ctx) => (u.parentId ? (ctx.unitById.get(u.parentId)?.name ?? '') : ''),
  },
  {
    field: 'managerId',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[7],
    width: 18,
    isCenter: true,
    value: (u) => u.managerId ?? '',
  },
  {
    field: 'managerName',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[8],
    width: 24,
    value: (u) => u.managerName ?? '',
  },
  {
    field: 'statusName',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[9],
    width: 18,
    isCenter: true,
    value: (u) => u.statusName,
  },
  {
    field: 'description',
    header: ORGANIZATION_EXPORT_LIST_HEADERS[10],
    width: 32,
    value: (u) => u.description ?? '',
  },
] as const;

/**
 * Xây dựng dữ liệu Export danh sách tổ chức theo Dạng cây (`tree`) hoặc Danh sách phẳng (`list`)
 * qua Declarative Export Engine và ghi nhận vào `ExportRegistryService`.
 */
export function buildOrganizationsExportPayload(params: {
  units: readonly OrganizationUnitResponse[];
  allUnits: readonly OrganizationUnitResponse[];
  treeNodes: readonly OrganizationTreeNodeResponse[];
  query: ExportOrganizationUnitsQuery;
}): ExportOrganizationsResponse {
  const { units, allUnits, treeNodes, query } = params;
  const format: 'csv' | 'xlsx' = query.format === 'csv' ? 'csv' : 'xlsx';
  const mode: 'tree' | 'list' = query.mode === 'list' ? 'list' : 'tree';

  const unitById = new Map<number, OrganizationUnitResponse>(allUnits.map((u) => [u.id, u]));
  const effectiveTimezone = LocaleFormatter.resolveActiveTimezone(LocaleContext.getTimezone());
  const exportedAtSubtitle = `Ngày xuất dữ liệu: ${LocaleFormatter.formatReportDateTime(new Date(), effectiveTimezone)} · Chế độ: ${mode === 'tree' ? 'Sơ đồ cây phân cấp' : 'Danh sách phẳng'}`;
  const datePart = new Date().toISOString().slice(0, 10);

  if (mode === 'tree') {
    const flattenedTreeItems: OrganizationTreeExportItem[] = [];

    const walkTree = (nodes: readonly OrganizationTreeNodeResponse[], prefix = '') => {
      nodes.forEach((node, idx) => {
        const isLast = idx === nodes.length - 1;
        const branchConnector = node.depth === 1 ? '' : isLast ? '└── ' : '├── ';
        const treeLabel = `${prefix}${branchConnector}${node.name} (${node.code})`;
        const parentUnit = node.parentId ? unitById.get(node.parentId) : undefined;
        const managerDisplay = node.managerName
          ? `${node.managerName} (#${node.managerId})`
          : node.managerId
            ? `#${node.managerId}`
            : '';

        flattenedTreeItems.push({
          node,
          treeLabel,
          parentCode: parentUnit?.code ?? '',
          managerDisplay,
        });

        if (node.children.length > 0) {
          const nextPrefix = node.depth === 1 ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
          walkTree(node.children, nextPrefix);
        }
      });
    };

    walkTree(treeNodes);

    const built = buildDeclarativeSpreadsheetExport({
      fileBaseName: `so_do_cay_to_chuc_${datePart}`,
      format,
      columns: ORGANIZATION_EXPORT_TREE_COLUMNS,
      items: flattenedTreeItems,
      sheetName: 'OrganizationTree',
      title: query.title?.trim() || 'SƠ ĐỒ CÂY CƠ CẤU TỔ CHỨC, CHI NHÁNH & PHÒNG BAN',
      subtitle: exportedAtSubtitle,
    });

    return {
      fileName: built.fileName,
      contentType: built.contentType,
      format: built.format,
      mode: 'tree',
      totalExported: built.totalExported,
      csvContent: built.csvContent,
      xlsxBase64: built.xlsxBase64,
    };
  }

  const built = buildDeclarativeSpreadsheetExport({
    fileBaseName: `danh_sach_to_chuc_${datePart}`,
    format,
    columns: ORGANIZATION_EXPORT_LIST_COLUMNS,
    items: units,
    context: { unitById },
    sheetName: 'OrganizationList',
    title: query.title?.trim() || 'DANH SÁCH ĐƠN VỊ, CHI NHÁNH & PHÒNG BAN TRỰC THUỘC',
    subtitle: exportedAtSubtitle,
  });

  return {
    fileName: built.fileName,
    contentType: built.contentType,
    format: built.format,
    mode: 'list',
    totalExported: built.totalExported,
    csvContent: built.csvContent,
    xlsxBase64: built.xlsxBase64,
  };
}

/**
 * Xây dựng file mẫu (Template) Import cây tổ chức qua Declarative Import Template Engine.
 */
export function buildOrganizationsImportTemplatePayload(
  format: 'csv' | 'xlsx' = 'xlsx',
): ExportOrganizationsResponse {
  const built = buildImportTemplateFile({
    fileBaseName: 'mau_import_cay_to_chuc',
    format,
    sheetName: 'OrgImportTemplate',
    title: 'MẪU NHẬP CÂY SƠ ĐỒ TỔ CHỨC, CHI NHÁNH & PHÒNG BAN',
    subtitle:
      'Hỗ trợ nhập cây tổ chức nhiều cấp theo Mã đơn vị cấp trên (Parent Code), tự động kiểm tra mã trùng và quan hệ vòng',
    columns: ORGANIZATION_IMPORT_COLUMNS,
  });

  return {
    ...built,
    mode: 'tree',
  };
}

export function registerOrganizationImportExportAdapters(params: {
  importRegistry: ImportRegistryService;
  exportRegistry: ExportRegistryService;
  exportImportTemplate: (format: 'csv' | 'xlsx') => ExportOrganizationsResponse;
  bulkImportUnits: (
    dto: BulkImportOrganizationsRequest,
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean | undefined },
  ) => Promise<BulkImportOrganizationsResultResponse>;
  exportUnits: (
    query: ExportOrganizationUnitsQuery,
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean | undefined },
  ) => Promise<ExportOrganizationsResponse>;
}): void {
  const { importRegistry, exportRegistry, exportImportTemplate, bulkImportUnits, exportUnits } =
    params;

  const profileHandler = {
    profileCode: 'organizations',
    module: 'organizations',
    columns: ORGANIZATION_IMPORT_COLUMNS,
    rowSchema: bulkImportOrganizationRowSchema,
    uniqueKeyFields: ['code'],
    requiredPermission: 'organizations.manage',
    exportTemplate: (format: 'csv' | 'xlsx') => exportImportTemplate(format),
    executeImport: async (dto: Readonly<Record<string, unknown>>, actorId?: number) =>
      (await bulkImportUnits(dto as unknown as BulkImportOrganizationsRequest, actorId, {
        skipHistoryRecord: true,
      })) as unknown as Readonly<Record<string, unknown>>,
  };
  importRegistry.registerProfile<BulkImportOrganizationRowInput>(profileHandler);
  if (importRegistry !== defaultImportRegistry) {
    defaultImportRegistry.registerProfile<BulkImportOrganizationRowInput>(profileHandler);
  }

  const importExecutor = {
    profileCode: 'organizations',
    module: 'organizations',
    topic: 'organizations.import',
    parseImportRows: (input: {
      readonly items?: readonly BulkImportOrganizationRowInput[] | undefined;
    }) => (Array.isArray(input.items) ? input.items : []),
    executeChunkImport: async (input: {
      readonly items?: readonly BulkImportOrganizationRowInput[] | undefined;
      readonly csvContent?: string | undefined;
      readonly xlsxBase64?: string | undefined;
      readonly columnMapping?: Readonly<Record<string, string | number | null>> | undefined;
      readonly duplicateStrategy?: 'SKIP' | 'UPDATE' | 'REJECT' | undefined;
      readonly skipDuplicates?: boolean | undefined;
      readonly actorId?: number | undefined;
    }) => {
      const res = await bulkImportUnits(
        {
          skipDuplicates: input.skipDuplicates ?? true,
          ...(input.duplicateStrategy ? { duplicateStrategy: input.duplicateStrategy } : {}),
          ...(input.items ? { items: [...input.items] } : {}),
          ...(input.csvContent ? { csvContent: input.csvContent } : {}),
          ...(input.xlsxBase64 ? { xlsxBase64: input.xlsxBase64 } : {}),
          ...(input.columnMapping
            ? {
                columnMapping: Object.fromEntries(
                  Object.entries(input.columnMapping).filter(
                    (entry): entry is [string, string | number] => entry[1] !== null,
                  ),
                ),
              }
            : {}),
        },
        input.actorId,
        { skipHistoryRecord: true },
      );
      return {
        importedCount: res.importedCount,
        updatedCount: res.updatedCount,
        skippedCount: res.skippedCount,
        failedCount: res.failedCount,
        errors: res.errors,
      };
    },
  };
  importRegistry.registerWorkerExecutor(importExecutor);
  if (importRegistry !== defaultImportRegistry) {
    defaultImportRegistry.registerWorkerExecutor(importExecutor);
  }

  const exportExecutor = {
    profileCode: 'organizations',
    module: 'organizations',
    topic: 'organizations.export',
    requiredPermission: 'organizations.read',
    executeExport: async (input: {
      readonly query?: Readonly<Record<string, unknown>> | undefined;
      readonly format?: string | undefined;
      readonly actorId?: number | undefined;
      readonly historyId?: number | undefined;
      readonly jobId: string;
    }) => {
      const res = await exportUnits(
        {
          ...((input.query ?? {}) as ExportOrganizationUnitsQuery),
          format: input.format === 'csv' ? 'csv' : 'xlsx',
        },
        input.actorId,
        { skipHistoryRecord: true },
      );
      return {
        fileName: res.fileName,
        contentType: res.contentType,
        format: res.format,
        totalExported: res.totalExported,
        csvContent: res.csvContent,
        xlsxBase64: res.xlsxBase64,
        ...(input.historyId !== undefined ? { historyId: input.historyId } : {}),
        jobId: input.jobId,
      };
    },
  };
  exportRegistry.registerWorkerExecutor(exportExecutor);
  if (exportRegistry !== defaultExportRegistry) {
    defaultExportRegistry.registerWorkerExecutor(exportExecutor);
  }
}
