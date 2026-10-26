import {
  BadRequestAppException,
  buildCsvContent,
  buildXlsxBuffer,
  cleanSpreadsheetCell,
  createSpreadsheetColumnFinder,
  detectSpreadsheetHeaderRowIndex,
  parseCsvToMatrix,
  parseXlsxToMatrix,
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
 * Chuyển ma trận bảng tính (Excel/CSV) thành danh sách dòng nhập đơn vị tổ chức.
 */
export function mapMatrixToOrganizationImportRows(
  matrix: ReadonlyArray<ReadonlyArray<string>>,
): BulkImportOrganizationRowInput[] {
  if (matrix.length < 2) return [];

  const headerRowIdx = detectSpreadsheetHeaderRowIndex(matrix, [
    'mã đơn vị',
    'ma don vi',
    'code',
    'unit_code',
    'tên đơn vị',
    'ten don vi',
    'name',
    'mã đơn vị cấp trên',
    'parent_code',
    'parentcode',
  ]);

  if (headerRowIdx >= matrix.length - 1) return [];
  const idxOf = createSpreadsheetColumnFinder(matrix[headerRowIdx]!);

  const codeIdx = idxOf(['mã đơn vị', 'ma don vi', 'code', 'unit_code', 'unitcode']);
  const nameIdx = idxOf([
    'tên đơn vị / phòng ban',
    'tên đơn vị',
    'ten don vi',
    'name',
    'unit_name',
    'unitname',
    'tên hiển thị',
  ]);
  const typeIdx = idxOf(['loại đơn vị', 'loai don vi', 'type', 'unit_type', 'unittype', 'cấp bậc']);
  const parentCodeIdx = idxOf([
    'mã đơn vị cấp trên',
    'ma don vi cap tren',
    'mã đơn vị cha',
    'ma don vi cha',
    'parent_code',
    'parentcode',
    'parent',
  ]);
  const managerIdx = idxOf([
    'người phụ trách',
    'nguoi phu trach',
    'id người phụ trách',
    'manager_id',
    'managerid',
    'manager',
    'trưởng đơn vị',
  ]);
  const statusIdx = idxOf(['trạng thái', 'trang thai', 'status']);
  const descIdx = idxOf([
    'mô tả chức năng / địa chỉ',
    'mô tả',
    'mo ta',
    'description',
    'ghi chú',
    'địa chỉ',
  ]);

  const rows: BulkImportOrganizationRowInput[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i]!;
    const getCell = (idx: number): string =>
      idx >= 0 ? cleanSpreadsheetCell(cells[idx] ?? '') : '';

    const rawCode = getCell(codeIdx).toUpperCase();
    const rawName = getCell(nameIdx);
    if (!rawCode && !rawName) continue;

    const rawType = getCell(typeIdx);
    const type = rawType ? parseOrgUnitType(rawType) : ORG_UNIT_TYPE.BRANCH;

    const rawParentCode = getCell(parentCodeIdx).toUpperCase();
    const parentCode =
      rawParentCode && rawParentCode !== 'ROOT' && rawParentCode !== 'NULL' ? rawParentCode : null;

    const rawManager = getCell(managerIdx);
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

    const rawStatus = getCell(statusIdx);
    const status = rawStatus ? parseOrgUnitStatus(rawStatus) : ORG_UNIT_STATUS.ACTIVE;
    const description = getCell(descIdx) || null;

    rows.push({
      code: rawCode,
      name: rawName,
      type,
      parentCode,
      managerId,
      managerIdentifier,
      status,
      description,
    });
  }

  return rows;
}

/**
 * Phân tích đầu vào Import (`.xlsx` Base64, `.csv` hoặc mảng JSON).
 */
export function parseOrganizationImportPayload(
  dto: BulkImportOrganizationsRequest,
): BulkImportOrganizationRowInput[] {
  if (dto.xlsxBase64) {
    try {
      const matrix = parseXlsxToMatrix(dto.xlsxBase64);
      return mapMatrixToOrganizationImportRows(matrix);
    } catch (err: unknown) {
      throw new BadRequestAppException('organizations.invalidXlsxFile', [
        err instanceof Error ? err.message : 'Unable to parse .xlsx file',
      ]);
    }
  }
  if (dto.csvContent) {
    const matrix = parseCsvToMatrix(dto.csvContent);
    return mapMatrixToOrganizationImportRows(matrix);
  }
  return [...(dto.items ?? [])];
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

/**
 * Xây dựng dữ liệu Export danh sách tổ chức theo Dạng cây (`tree`) hoặc Danh sách phẳng (`list`).
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
    const matrixRows: Array<Array<string | number>> = [];
    let stt = 0;

    const walkTree = (nodes: readonly OrganizationTreeNodeResponse[], prefix = '') => {
      nodes.forEach((node, idx) => {
        stt++;
        const isLast = idx === nodes.length - 1;
        const branchConnector = node.depth === 1 ? '' : isLast ? '└── ' : '├── ';
        const treeLabel = `${prefix}${branchConnector}${node.name} (${node.code})`;
        const parentUnit = node.parentId ? unitById.get(node.parentId) : undefined;
        const managerDisplay = node.managerName
          ? `${node.managerName} (#${node.managerId})`
          : node.managerId
            ? `#${node.managerId}`
            : '';

        matrixRows.push([
          stt,
          node.depth,
          treeLabel,
          node.code,
          node.name,
          node.typeName,
          parentUnit?.code ?? '',
          node.path,
          node.childrenCount,
          node.descendantCount,
          managerDisplay,
          node.statusName,
          node.description ?? '',
        ]);

        if (node.children.length > 0) {
          const nextPrefix = node.depth === 1 ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
          walkTree(node.children, nextPrefix);
        }
      });
    };

    walkTree(treeNodes);

    const reportTitle = query.title?.trim() || 'SƠ ĐỒ CÂY CƠ CẤU TỔ CHỨC, CHI NHÁNH & PHÒNG BAN';
    const csvContent = buildCsvContent(ORGANIZATION_EXPORT_TREE_HEADERS, matrixRows);
    const xlsxBuffer = buildXlsxBuffer(ORGANIZATION_EXPORT_TREE_HEADERS, matrixRows, {
      sheetName: 'OrganizationTree',
      title: reportTitle,
      subtitle: exportedAtSubtitle,
      centerColumnIndices: [0, 1, 8, 9, 11],
      textColumnIndices: [3, 6, 7],
      freezeHeader: true,
    });

    return {
      fileName: `so_do_cay_to_chuc_${datePart}.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      mode: 'tree',
      totalExported: matrixRows.length,
      csvContent,
      xlsxBase64: xlsxBuffer.toString('base64'),
    };
  }

  // mode === 'list'
  const matrixRows: Array<Array<string | number>> = units.map((u, idx) => {
    const parentUnit = u.parentId ? unitById.get(u.parentId) : undefined;
    return [
      idx + 1,
      u.id,
      u.code,
      u.name,
      u.typeName,
      parentUnit?.code ?? '',
      parentUnit?.name ?? '',
      u.managerId ?? '',
      u.managerName ?? '',
      u.statusName,
      u.description ?? '',
    ];
  });

  const reportTitle = query.title?.trim() || 'DANH SÁCH ĐƠN VỊ, CHI NHÁNH & PHÒNG BAN TRỰC THUỘC';
  const csvContent = buildCsvContent(ORGANIZATION_EXPORT_LIST_HEADERS, matrixRows);
  const xlsxBuffer = buildXlsxBuffer(ORGANIZATION_EXPORT_LIST_HEADERS, matrixRows, {
    sheetName: 'OrganizationList',
    title: reportTitle,
    subtitle: exportedAtSubtitle,
    centerColumnIndices: [0, 1, 7, 9],
    textColumnIndices: [2, 5],
    freezeHeader: true,
  });

  return {
    fileName: `danh_sach_to_chuc_${datePart}.${format}`,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    mode: 'list',
    totalExported: matrixRows.length,
    csvContent,
    xlsxBase64: xlsxBuffer.toString('base64'),
  };
}

/**
 * Xây dựng file mẫu (Template) Import cây tổ chức.
 */
export function buildOrganizationsImportTemplatePayload(
  format: 'csv' | 'xlsx' = 'xlsx',
): ExportOrganizationsResponse {
  const sampleRows: Array<Array<string | number>> = [
    [
      'HQ_VN',
      'Trụ sở chính Việt Nam',
      'HEADQUARTERS',
      '',
      'superadmin',
      'ACTIVE',
      'Trụ sở điều hành trung tâm',
    ],
    [
      'BRANCH_DANANG',
      'Chi nhánh Đà Nẵng',
      'BRANCH',
      'HQ_VN',
      'director_hcm',
      'ACTIVE',
      'Chi nhánh khu vực Miền Trung',
    ],
    [
      'DEPT_RND_DN',
      'Phòng Nghiên cứu & Phát triển Đà Nẵng',
      'DEPARTMENT',
      'BRANCH_DANANG',
      'manager_eng',
      'ACTIVE',
      'Phòng R&D trực thuộc Chi nhánh Đà Nẵng',
    ],
    [
      'TEAM_AI_DN',
      'Nhóm Trí tuệ Nhân tạo (AI Lab)',
      'TEAM',
      'DEPT_RND_DN',
      'manager_eng',
      'ACTIVE',
      'Đội chuyên môn AI trực thuộc Phòng R&D',
    ],
  ];

  const csvContent = buildCsvContent(ORGANIZATION_IMPORT_TEMPLATE_HEADERS, sampleRows);
  const xlsxBuffer = buildXlsxBuffer(ORGANIZATION_IMPORT_TEMPLATE_HEADERS, sampleRows, {
    sheetName: 'OrgImportTemplate',
    title: 'MẪU NHẬP CÂY SƠ ĐỒ TỔ CHỨC, CHI NHÁNH & PHÒNG BAN',
    subtitle:
      'Hỗ trợ nhập cây tổ chức nhiều cấp theo Mã đơn vị cấp trên (Parent Code), tự động kiểm tra mã trùng và quan hệ vòng',
    centerColumnIndices: [2, 5],
    textColumnIndices: [0, 3, 4],
    freezeHeader: true,
  });

  return {
    fileName: `mau_import_cay_to_chuc.${format}`,
    contentType:
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
    format,
    mode: 'tree',
    totalExported: sampleRows.length,
    csvContent,
    xlsxBase64: xlsxBuffer.toString('base64'),
  };
}
