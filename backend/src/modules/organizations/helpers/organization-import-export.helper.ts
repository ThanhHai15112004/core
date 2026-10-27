import {
  type DeclarativeExportColumn,
  type ImportColumnDefinition,
  buildDeclarativeSpreadsheetExport,
  buildImportTemplateFile,
  cleanSpreadsheetCell,
  extractDeclarativeImportMatrixData,
  parseDeclarativeImportPayload,
} from '@packages/kernel/index.js';
import { LocaleContext, LocaleFormatter } from '@packages/i18n/index.js';
import {
  ORG_UNIT_STATUS,
  ORG_UNIT_TYPE,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';
import {
  ORGANIZATION_EXPORT_LIST_HEADERS,
  ORGANIZATION_EXPORT_TREE_HEADERS,
  ORGANIZATION_IMPORT_TEMPLATE_HEADERS,
} from '../enum/organizations.enum.js';
import {
  type BulkImportOrganizationRowInput,
  type BulkImportOrganizationsRequest,
  type CreateOrganizationUnitRequest,
  type ExportOrganizationUnitsQuery,
  type UpdateOrganizationUnitRequest,
  bulkImportOrganizationRowSchema,
} from '../requests/organizations.requests.js';
import type { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type {
  BulkImportOrganizationsErrorItem,
  BulkImportOrganizationsResultResponse,
  ExportOrganizationsResponse,
  OrganizationTreeNodeResponse,
  OrganizationUnitResponse,
} from '../responses/organizations.response.js';

/**
 * Khai báo cột Import Cây tổ chức tập trung 1 chỗ duy nhất (Declarative Import Schema — Mục 8.2).
 */
export const ORGANIZATION_IMPORT_COLUMNS: readonly ImportColumnDefinition[] = [
  {
    field: 'code',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[0],
    required: true,
    width: 18,
    isText: true,
    aliases: ['mã đơn vị', 'ma don vi', 'code', 'unit_code', 'unitcode'],
    sampleValues: ['HQ_VN', 'BRANCH_DANANG', 'DEPT_RND_DN', 'TEAM_AI_DN'],
  },
  {
    field: 'name',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[1],
    required: true,
    width: 30,
    aliases: [
      'tên đơn vị / phòng ban',
      'tên đơn vị',
      'ten don vi',
      'name',
      'unit_name',
      'unitname',
      'tên hiển thị',
    ],
    sampleValues: [
      'Trụ sở chính Việt Nam',
      'Chi nhánh Đà Nẵng',
      'Phòng Nghiên cứu & Phát triển Đà Nẵng',
      'Nhóm Trí tuệ Nhân tạo (AI Lab)',
    ],
  },
  {
    field: 'type',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[2],
    width: 22,
    isCenter: true,
    aliases: ['loại đơn vị', 'loai don vi', 'type', 'unit_type', 'unittype', 'cấp bậc'],
    sampleValues: ['HEADQUARTERS', 'BRANCH', 'DEPARTMENT', 'TEAM'],
  },
  {
    field: 'parentCode',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[3],
    width: 24,
    isText: true,
    aliases: [
      'mã đơn vị cấp trên',
      'ma don vi cap tren',
      'mã đơn vị cha',
      'ma don vi cha',
      'parent_code',
      'parentcode',
      'parent',
    ],
    sampleValues: ['', 'HQ_VN', 'BRANCH_DANANG', 'DEPT_RND_DN'],
  },
  {
    field: 'manager',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[4],
    width: 28,
    isText: true,
    aliases: [
      'người phụ trách',
      'nguoi phu trach',
      'id người phụ trách',
      'manager_id',
      'managerid',
      'manager',
      'trưởng đơn vị',
    ],
    sampleValues: ['superadmin', 'director_hcm', 'manager_eng', 'manager_eng'],
  },
  {
    field: 'status',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[5],
    width: 24,
    isCenter: true,
    aliases: ['trạng thái', 'trang thai', 'status'],
    sampleValues: ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE'],
  },
  {
    field: 'description',
    header: ORGANIZATION_IMPORT_TEMPLATE_HEADERS[6],
    width: 34,
    aliases: ['mô tả chức năng / địa chỉ', 'mô tả', 'mo ta', 'description', 'ghi chú', 'địa chỉ'],
    sampleValues: [
      'Trụ sở điều hành trung tâm',
      'Chi nhánh khu vực Miền Trung',
      'Phòng R&D trực thuộc Chi nhánh Đà Nẵng',
      'Đội chuyên môn AI trực thuộc Phòng R&D',
    ],
  },
] as const;

export function mapExtractedOrganizationImportRow(
  rawByField: Readonly<Record<string, string>>,
): BulkImportOrganizationRowInput | null {
  const rawCode = cleanSpreadsheetCell(rawByField['code'] ?? '').toUpperCase();
  const rawName = cleanSpreadsheetCell(rawByField['name'] ?? '');
  if (!rawCode && !rawName) return null;

  const rawType = cleanSpreadsheetCell(rawByField['type'] ?? '');
  const type = rawType ? parseOrgUnitType(rawType) : ORG_UNIT_TYPE.BRANCH;

  const rawParentCode = cleanSpreadsheetCell(rawByField['parentCode'] ?? '').toUpperCase();
  const parentCode =
    rawParentCode && rawParentCode !== 'ROOT' && rawParentCode !== 'NULL' ? rawParentCode : null;

  const rawManager = cleanSpreadsheetCell(rawByField['manager'] ?? '');
  let managerId: number | null = null;
  let managerIdentifier: string | null = null;
  if (rawManager) {
    const numericManager = Number(rawManager);
    if (Number.isInteger(numericManager) && numericManager > 0) {
      managerId = numericManager;
    } else {
      managerIdentifier = rawManager;
    }
  }

  const rawStatus = cleanSpreadsheetCell(rawByField['status'] ?? '');
  const status = rawStatus ? parseOrgUnitStatus(rawStatus) : ORG_UNIT_STATUS.ACTIVE;
  const description = cleanSpreadsheetCell(rawByField['description'] ?? '') || null;

  return {
    code: rawCode,
    name: rawName,
    type,
    parentCode,
    managerId,
    managerIdentifier,
    status,
    description,
  };
}

/**
 * Chuyển ma trận bảng tính (Excel/CSV) thành danh sách dòng nhập đơn vị tổ chức qua Declarative Import Engine.
 */
export function mapMatrixToOrganizationImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
): BulkImportOrganizationRowInput[] {
  return extractDeclarativeImportMatrixData({
    matrix,
    columns: ORGANIZATION_IMPORT_COLUMNS,
    mapRawRow: mapExtractedOrganizationImportRow,
  }).rows;
}

/**
 * Phân tích đầu vào Import (`.xlsx` Base64, `.csv` hoặc mảng JSON) qua Declarative Import Engine.
 */
export function parseOrganizationImportPayload(
  dto: BulkImportOrganizationsRequest,
): BulkImportOrganizationRowInput[] {
  return parseDeclarativeImportPayload({
    dto,
    columns: ORGANIZATION_IMPORT_COLUMNS,
    mapRawRow: mapExtractedOrganizationImportRow,
    invalidXlsxErrorKey: 'organizations.invalidXlsxFile',
  }).rows;
}

/**
 * Sắp xếp Tô-pô (Topological Sort) các dòng import theo quan hệ `code` <- `parentCode`
 * và phát hiện chu trình vòng lặp ngay trong file import.
 */
export function sortAndDetectCyclesInImportBatch<
  T extends { readonly row: number; readonly code: string; readonly parentCode: string | null },
>(
  validRows: readonly T[],
): {
  readonly orderedRows: T[];
  readonly cycleRows: T[];
} {
  const rowByCode = new Map<string, T>();
  for (const item of validRows) {
    rowByCode.set(item.code, item);
  }

  const stateByCode = new Map<string, 'visiting' | 'visited' | 'cycle'>();
  const orderedRows: T[] = [];
  const cycleRowSet = new Set<number>();

  const dfs = (item: T, stack: Set<string>): boolean => {
    const currentState = stateByCode.get(item.code);
    if (currentState === 'visited') return false;
    if (currentState === 'cycle' || stack.has(item.code)) {
      stateByCode.set(item.code, 'cycle');
      cycleRowSet.add(item.row);
      return true;
    }

    if (item.parentCode && item.parentCode === item.code) {
      stateByCode.set(item.code, 'cycle');
      cycleRowSet.add(item.row);
      return true;
    }

    stateByCode.set(item.code, 'visiting');
    stack.add(item.code);

    const parentInBatch = item.parentCode ? rowByCode.get(item.parentCode) : undefined;
    if (parentInBatch) {
      const parentHasCycle = dfs(parentInBatch, stack);
      if (parentHasCycle) {
        stateByCode.set(item.code, 'cycle');
        cycleRowSet.add(item.row);
        stack.delete(item.code);
        return true;
      }
    }

    stack.delete(item.code);
    stateByCode.set(item.code, 'visited');
    orderedRows.push(item);
    return false;
  };

  for (const item of validRows) {
    if (!stateByCode.has(item.code)) {
      dfs(item, new Set<string>());
    }
  }

  const cycleRows = validRows.filter((r) => cycleRowSet.has(r.row));
  return { orderedRows, cycleRows };
}

/**
 * Thực thi nhập cây tổ chức hàng loạt (CSV / XLSX / JSON):
 * - Kiểm tra mã trùng trong file và trong DB (`skipDuplicates` / `updateExisting`)
 * - Kiểm tra đơn vị cha (`parentCode`) tồn tại trong DB hoặc trong cùng file import
 * - Ngăn chặn quan hệ vòng ngay trong file import và sắp xếp thứ tự Cha -> Con (Topological Sort)
 */
export async function executeBulkImportOrganizations(params: {
  dto: BulkImportOrganizationsRequest;
  findAllUnits: () => Promise<OrganizationUnitEntity[]>;
  resolveManagerId: (input: {
    readonly managerId?: number | null | undefined;
    readonly managerIdentifier?: string | null | undefined;
  }) => Promise<number | null>;
  createUnit: (dto: CreateOrganizationUnitRequest) => Promise<OrganizationUnitResponse>;
  updateUnit: (id: number, dto: UpdateOrganizationUnitRequest) => Promise<OrganizationUnitResponse>;
}): Promise<BulkImportOrganizationsResultResponse> {
  const { dto, findAllUnits, resolveManagerId, createUnit, updateUnit } = params;
  const rawRows = parseOrganizationImportPayload(dto);
  const skipDuplicates = dto.skipDuplicates ?? true;
  const updateExisting = dto.updateExisting ?? false;

  const errors: BulkImportOrganizationsErrorItem[] = [];
  const importedCodes: string[] = [];
  const updatedCodes: string[] = [];
  let skippedCount = 0;

  interface ValidatedImportCandidate {
    readonly row: number;
    readonly code: string;
    readonly parentCode: string | null;
    readonly data: BulkImportOrganizationRowInput;
  }

  const seenCodesInFile = new Set<string>();
  const candidates: ValidatedImportCandidate[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 1;
    const raw = rawRows[i]!;
    const rawCode = (raw.code ?? '').trim().toUpperCase();
    const identifier = rawCode || `row-${rowNumber}`;

    const parsed = bulkImportOrganizationRowSchema.safeParse({
      ...raw,
      code: rawCode,
    });
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        identifier,
        message: parsed.error.issues.map((iss) => iss.message).join('; '),
      });
      continue;
    }

    const valid = parsed.data;
    const normalizedCode = valid.code.trim().toUpperCase();
    if (seenCodesInFile.has(normalizedCode)) {
      if (skipDuplicates && !updateExisting) {
        skippedCount++;
        continue;
      }
      errors.push({
        row: rowNumber,
        identifier: normalizedCode,
        message: `Duplicate organization code in import file: ${normalizedCode}`,
      });
      continue;
    }

    seenCodesInFile.add(normalizedCode);
    candidates.push({
      row: rowNumber,
      code: normalizedCode,
      parentCode: valid.parentCode ? valid.parentCode.trim().toUpperCase() : null,
      data: valid,
    });
  }

  const existingUnits = await findAllUnits();
  const existingByCode = new Map<string, OrganizationUnitEntity>();
  const unitIdByCode = new Map<string, number>();
  for (const u of existingUnits) {
    if (!u.deletedAt) {
      const upper = u.code.trim().toUpperCase();
      existingByCode.set(upper, u);
      unitIdByCode.set(upper, Number(u.id));
    }
  }

  const candidateCodes = new Set<string>(candidates.map((c) => c.code));
  const parentVerifiedCandidates: ValidatedImportCandidate[] = [];

  for (const item of candidates) {
    if (item.parentCode) {
      const existsInDb = unitIdByCode.has(item.parentCode);
      const existsInBatch = candidateCodes.has(item.parentCode);
      if (!existsInDb && !existsInBatch) {
        errors.push({
          row: item.row,
          identifier: item.code,
          message: `Parent organization unit code '${item.parentCode}' does not exist in database or import file`,
        });
        continue;
      }
    }
    parentVerifiedCandidates.push(item);
  }

  const { orderedRows, cycleRows } = sortAndDetectCyclesInImportBatch(parentVerifiedCandidates);
  for (const cyc of cycleRows) {
    errors.push({
      row: cyc.row,
      identifier: cyc.code,
      message: `Circular parent hierarchy detected in import file for unit '${cyc.code}' (parentCode: '${cyc.parentCode ?? ''}')`,
    });
  }

  for (const item of orderedRows) {
    const valid = item.data;
    let resolvedParentId: number | null =
      valid.parentId !== undefined && valid.parentId !== null ? Number(valid.parentId) : null;

    if (resolvedParentId === null && item.parentCode) {
      const foundParentId = unitIdByCode.get(item.parentCode);
      if (!foundParentId) {
        errors.push({
          row: item.row,
          identifier: item.code,
          message: `Parent organization unit '${item.parentCode}' could not be resolved or failed to import`,
        });
        continue;
      }
      resolvedParentId = foundParentId;
    }

    let resolvedManagerId: number | null = null;
    try {
      resolvedManagerId = await resolveManagerId({
        managerId: valid.managerId,
        managerIdentifier: valid.managerIdentifier,
      });
    } catch (err: unknown) {
      errors.push({
        row: item.row,
        identifier: item.code,
        message: err instanceof Error ? err.message : 'Invalid manager identifier',
      });
      continue;
    }

    const existing = existingByCode.get(item.code);
    if (existing) {
      if (updateExisting) {
        try {
          const updated = await updateUnit(Number(existing.id), {
            name: valid.name,
            type: valid.type,
            parentId: resolvedParentId,
            ...(resolvedManagerId !== null ? { managerId: resolvedManagerId } : {}),
            status: valid.status,
            description: valid.description ?? existing.description ?? null,
          });
          unitIdByCode.set(item.code, updated.id);
          updatedCodes.push(item.code);
        } catch (err: unknown) {
          errors.push({
            row: item.row,
            identifier: item.code,
            message: err instanceof Error ? err.message : 'Failed to update organization unit',
          });
        }
        continue;
      }

      if (skipDuplicates) {
        skippedCount++;
        unitIdByCode.set(item.code, Number(existing.id));
        continue;
      }

      errors.push({
        row: item.row,
        identifier: item.code,
        message: `Duplicate organization code in database: ${item.code}`,
      });
      continue;
    }

    try {
      const created = await createUnit({
        code: item.code,
        name: valid.name,
        type: valid.type,
        parentId: resolvedParentId,
        managerId: resolvedManagerId,
        status: valid.status,
        description: valid.description ?? null,
      });
      unitIdByCode.set(item.code, created.id);
      importedCodes.push(created.code);
    } catch (err: unknown) {
      errors.push({
        row: item.row,
        identifier: item.code,
        message: err instanceof Error ? err.message : 'Failed to create organization unit',
      });
    }
  }

  return {
    totalRows: rawRows.length,
    importedCount: importedCodes.length,
    updatedCount: updatedCodes.length,
    skippedCount,
    failedCount: errors.length,
    importedCodes,
    updatedCodes,
    errors,
  };
}

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
 * qua Declarative Export Engine.
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
