import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ExportRegistryService,
  ImportRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultCustomFieldRegistry,
  defaultExportRegistry,
  defaultImportRegistry,
  defaultSettingRegistry,
  parseCustomFieldFiltersParam,
  pickSelectedFields,
  resolveExportFormat,
  resolveImportDuplicateStrategy,
} from '@packages/kernel/index.js';
import { AuditLogService, DataScopeService, type UserIdentity } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORG_UNIT_STATUS,
  type OrganizationUnitSummary,
  type UnitManagerResolverDelegate,
} from '../contracts/index.js';
import {
  DEFAULT_INCLUDE_INACTIVE_IN_SCOPE,
  DEFAULT_MAX_HIERARCHY_DEPTH,
  ORGANIZATION_CODE_TYPE_KEYS,
  ORGANIZATION_SETTING_KEYS,
} from '../enum/organizations.enum.js';
import {
  ensureActiveOrganizationUnitsExist,
  executeCreateOrganizationUnit,
  executeRemoveOrganizationUnit,
  executeUpdateOrganizationUnit,
  resolveUnitManagerNamesMap,
  validateUnitManagerIdOrThrow,
} from '../helpers/organization-crud.helper.js';
import {
  buildOrganizationTree,
  collectDescendantUnitIds,
  computeOrganizationStats,
  validateAndComputeMoveImpact,
} from '../helpers/organization-hierarchy.helper.js';
import {
  buildOrganizationsExportPayload,
  buildOrganizationsImportTemplatePayload,
  executeBulkImportOrganizations,
  registerOrganizationImportExportAdapters,
} from '../helpers/organization-import-export.helper.js';
import { OrganizationsMapper } from '../mappers/organizations.mapper.js';
import { OrganizationUnitRepository } from '../repositories/organization-unit.repository.js';
import type {
  BulkImportOrganizationsRequest,
  CreateOrganizationUnitRequest,
  ExportOrganizationUnitsQuery,
  ListOrganizationUnitsQuery,
  LockOrganizationUnitRequest,
  MoveOrganizationUnitRequest,
  UpdateOrganizationUnitRequest,
} from '../requests/organizations.requests.js';
import type {
  BulkImportOrganizationsResultResponse,
  ExportOrganizationsResponse,
  MoveOrganizationUnitResponse,
  OrganizationMoveImpactResponse,
  OrganizationStatsResponse,
  OrganizationTreeNodeResponse,
  OrganizationUnitResponse,
} from '../responses/organizations.response.js';
import type {
  UnitBatchUsageCountDelegate,
  UnitUsageCountDelegate,
} from '../types/organizations.types.js';

@Injectable()
export class OrganizationsService implements IOrganizationsPublicService {
  private unitUsageCountDelegate?: UnitUsageCountDelegate;
  private unitBatchUsageCountDelegate?: UnitBatchUsageCountDelegate;
  private unitManagerResolverDelegate?: UnitManagerResolverDelegate;
  private readonly settingRegistry: SettingRegistryService;
  private readonly importRegistry: ImportRegistryService;
  private readonly exportRegistry: ExportRegistryService;

  constructor(
    private readonly repository: OrganizationUnitRepository,
    private readonly mapper: OrganizationsMapper,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    settingRegistry?: SettingRegistryService,
    @Optional()
    importRegistry?: ImportRegistryService,
    @Optional()
    exportRegistry?: ExportRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.importRegistry = importRegistry ?? defaultImportRegistry;
    this.exportRegistry = exportRegistry ?? defaultExportRegistry;
    this.registerImportExportAdapters();
    this.dataScopeService?.registerOrgHierarchyResolver((unitIds) =>
      this.resolveDescendantUnitIds(unitIds),
    );
    defaultCodeRegistry.registerUsageChecker(
      ORGANIZATION_CODE_TYPE_KEYS.UNIT_TYPE,
      'organization_units.type',
      async ({ numericCode }) => {
        if (typeof this.repository.countByType === 'function') {
          return this.repository.countByType(Number(numericCode));
        }
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.type) === Number(numericCode)).length;
      },
    );
    defaultCodeRegistry.registerUsageChecker(
      ORGANIZATION_CODE_TYPE_KEYS.STATUS,
      'organization_units.status',
      async ({ numericCode }) => {
        if (typeof this.repository.countByStatus === 'function') {
          return this.repository.countByStatus(Number(numericCode));
        }
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.status) === Number(numericCode)).length;
      },
    );
  }

  /** Đăng ký profile Import & Worker Executor của module `organizations` vào Registry dùng chung (Mục 8.2 & 8.3) */
  private registerImportExportAdapters(): void {
    registerOrganizationImportExportAdapters({
      importRegistry: this.importRegistry,
      exportRegistry: this.exportRegistry,
      exportImportTemplate: (f) => this.exportImportTemplate(f),
      bulkImportUnits: (dto, aid, opts) => this.bulkImportUnits(dto, aid, opts),
      exportUnits: (q, aid, opts) => this.exportUnits(q, aid, opts),
    });
  }

  private get maxHierarchyDepth(): number {
    return this.settingRegistry.getNumber(
      ORGANIZATION_SETTING_KEYS.MAX_DEPTH,
      undefined,
      DEFAULT_MAX_HIERARCHY_DEPTH,
    );
  }

  private get includeInactiveInScope(): boolean {
    return this.settingRegistry.getBoolean(
      ORGANIZATION_SETTING_KEYS.INCLUDE_INACTIVE_IN_SCOPE,
      undefined,
      DEFAULT_INCLUDE_INACTIVE_IN_SCOPE,
    );
  }

  /** Đăng ký delegate đếm số người dùng đang gắn với một đơn vị tổ chức */
  public registerUnitUsageCountDelegate(delegate: UnitUsageCountDelegate): void {
    this.unitUsageCountDelegate = delegate;
  }

  /** Đăng ký delegate đếm tổng số người dùng đang gắn với danh sách đơn vị tổ chức (Batch 1 query) */
  public registerUnitBatchUsageCountDelegate(delegate: UnitBatchUsageCountDelegate): void {
    this.unitBatchUsageCountDelegate = delegate;
  }

  /** Đăng ký delegate tra cứu thông tin người phụ trách đơn vị từ module Users */
  public registerUnitManagerResolverDelegate(delegate: UnitManagerResolverDelegate): void {
    this.unitManagerResolverDelegate = delegate;
  }

  /** Lấy danh sách đơn vị/chi nhánh có lọc */
  public async list(
    query: ListOrganizationUnitsQuery = {},
    actor?: UserIdentity,
  ): Promise<OrganizationUnitResponse[]> {
    const cfActor = actor
      ? {
          id: actor.id,
          roles: actor.roles,
          permissions: actor.permissions,
          bypassPermissionCheck: actor.roles?.includes('super_admin'),
        }
      : { bypassPermissionCheck: true };

    let allowedUnitIds: Set<number> | null = null;
    if (query.customFieldFilters) {
      const cfFilters = parseCustomFieldFiltersParam(query.customFieldFilters);
      if (cfFilters.length > 0) {
        const matchedIds = defaultCustomFieldRegistry.filterRecordIdsByCustomFields({
          entityCode: 'organizations.organization_unit',
          filters: cfFilters,
          actor: cfActor,
        });
        allowedUnitIds = new Set(
          matchedIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
        );
      }
    }

    let units = await this.repository.findFiltered(query);
    if (allowedUnitIds !== null) {
      units = units.filter((u) => allowedUnitIds!.has(Number(u.id)));
    }

    const managerNameById = await resolveUnitManagerNamesMap(
      units,
      this.unitManagerResolverDelegate,
    );
    const customFieldsById = defaultCustomFieldRegistry.resolveBatchRecordsCustomFieldsForApi({
      entityCode: 'organizations.organization_unit',
      recordIds: units.map((u) => Number(u.id)),
      viewMode: 'list',
      actor: cfActor,
    });
    const items = this.mapper.toResponseList(units, managerNameById, customFieldsById);
    if (query.fields && query.fields.length > 0) {
      return pickSelectedFields(items, query.fields) as unknown as OrganizationUnitResponse[];
    }
    return items;
  }

  /** Lấy sơ đồ cây đơn vị phân cấp kèm depth, path và số lượng đơn vị con */
  public async getTree(
    query: ListOrganizationUnitsQuery = {},
    actor?: UserIdentity,
  ): Promise<OrganizationTreeNodeResponse[]> {
    const list = await this.list(query, actor);
    return buildOrganizationTree(list);
  }

  /** Lấy thống kê KPI tổng quan của sơ đồ tổ chức */
  public async getStats(): Promise<OrganizationStatsResponse> {
    const list = await this.list({});
    return computeOrganizationStats(list, this.maxHierarchyDepth);
  }

  /** Lấy thông tin chi tiết đơn vị/chi nhánh theo ID */
  public async getById(id: number, actor?: UserIdentity): Promise<OrganizationUnitResponse> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }
    const managerNameById = await resolveUnitManagerNamesMap(
      [entity],
      this.unitManagerResolverDelegate,
    );
    const mId =
      entity.managerId !== undefined && entity.managerId !== null ? Number(entity.managerId) : null;
    const cfActor = actor
      ? {
          id: actor.id,
          roles: actor.roles,
          permissions: actor.permissions,
          bypassPermissionCheck: actor.roles?.includes('super_admin'),
        }
      : { bypassPermissionCheck: true };
    const customFields = defaultCustomFieldRegistry.resolveRecordCustomFieldsForApi({
      entityCode: 'organizations.organization_unit',
      recordId: Number(entity.id),
      viewMode: 'detail',
      actor: cfActor,
    });
    return this.mapper.toResponse(
      entity,
      mId !== null ? (managerNameById.get(mId) ?? null) : null,
      customFields,
    );
  }

  /** Tạo mới đơn vị hoặc chi nhánh */
  public async create(
    dto: CreateOrganizationUnitRequest,
    actor?: UserIdentity,
  ): Promise<OrganizationUnitResponse> {
    return executeCreateOrganizationUnit({
      dto,
      repository: this.repository,
      mapper: this.mapper,
      maxHierarchyDepth: this.maxHierarchyDepth,
      unitManagerResolverDelegate: this.unitManagerResolverDelegate,
      auditLogService: this.auditLogService,
      actor,
    });
  }

  /** Cập nhật thông tin đơn vị (Mã, tên, loại, đơn vị cha, trạng thái và người phụ trách) */
  public async update(
    id: number,
    dto: UpdateOrganizationUnitRequest,
    actor?: UserIdentity,
  ): Promise<OrganizationUnitResponse> {
    return executeUpdateOrganizationUnit({
      id,
      dto,
      repository: this.repository,
      mapper: this.mapper,
      maxHierarchyDepth: this.maxHierarchyDepth,
      unitManagerResolverDelegate: this.unitManagerResolverDelegate,
      auditLogService: this.auditLogService,
      actor,
    });
  }

  /**
   * Kiểm tra ảnh hưởng đến quyền và dữ liệu trước khi di chuyển đơn vị trong cây
   * (tính đường dẫn mới, độ sâu nhánh con, số đơn vị con và số nhân sự chịu tác động Data Scope).
   */
  public async assessMoveImpact(
    id: number,
    newParentId: number | null,
  ): Promise<OrganizationMoveImpactResponse> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }
    const allUnits = await this.repository.findFiltered({});
    const descendantIds = collectDescendantUnitIds(allUnits, [Number(id)], true);

    let affectedUserCount = 0;
    if (this.unitBatchUsageCountDelegate && !this.unitUsageCountDelegate) {
      affectedUserCount = await this.unitBatchUsageCountDelegate(descendantIds);
    } else if (this.unitUsageCountDelegate) {
      const counts = await Promise.all(
        descendantIds.map((uId) => this.unitUsageCountDelegate!(Number(uId))),
      );
      affectedUserCount = counts.reduce((sum, c) => sum + c, 0);
    }

    return validateAndComputeMoveImpact({
      allUnits,
      unitId: Number(id),
      newParentId,
      maxDepth: this.maxHierarchyDepth,
      affectedUserCount,
    });
  }

  /** Di chuyển đơn vị sang đơn vị cha mới kèm kiểm tra và ghi nhận ảnh hưởng đến quyền & dữ liệu */
  public async moveUnit(
    id: number,
    dto: MoveOrganizationUnitRequest,
  ): Promise<MoveOrganizationUnitResponse> {
    const targetParentId = dto.newParentId ?? null;
    const impact = await this.assessMoveImpact(id, targetParentId);
    const unit = await this.update(id, { parentId: targetParentId });

    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.move',
      resourceType: 'organization_unit',
      resourceId: id,
      beforeData: {
        parentId: impact.oldParentId,
        path: impact.oldPath,
        depth: impact.oldDepth,
      },
      afterData: {
        parentId: impact.newParentId,
        path: impact.newPath,
        depth: impact.newDepth,
        affectedUnitCount: impact.affectedUnitCount,
        affectedUserCount: impact.affectedUserCount,
      },
      reason: dto.reason ?? `Moved organization unit ${impact.unitCode} to ${impact.newPath}`,
    });

    return { unit, impact };
  }

  /** Khóa đơn vị (chuyển sang INACTIVE: không cho dùng mới nhưng giữ nguyên lịch sử và nhân sự cũ) */
  public async lockUnit(
    id: number,
    dto: LockOrganizationUnitRequest = {},
  ): Promise<OrganizationUnitResponse> {
    const updated = await this.update(id, { status: ORG_UNIT_STATUS.INACTIVE });
    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.lock',
      resourceType: 'organization_unit',
      resourceId: id,
      beforeData: { status: ORG_UNIT_STATUS.ACTIVE },
      afterData: { status: ORG_UNIT_STATUS.INACTIVE },
      reason: dto.reason ?? 'Locked organization unit (prevent new assignments, preserve history)',
    });
    return updated;
  }

  /** Mở khóa đơn vị (chuyển lại sang ACTIVE) */
  public async unlockUnit(
    id: number,
    dto: LockOrganizationUnitRequest = {},
  ): Promise<OrganizationUnitResponse> {
    const updated = await this.update(id, { status: ORG_UNIT_STATUS.ACTIVE });
    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.unlock',
      resourceType: 'organization_unit',
      resourceId: id,
      beforeData: { status: ORG_UNIT_STATUS.INACTIVE },
      afterData: { status: ORG_UNIT_STATUS.ACTIVE },
      reason: dto.reason ?? 'Unlocked organization unit',
    });
    return updated;
  }

  /** Xuất danh sách tổ chức theo dạng cây (`tree`) hoặc danh sách phẳng (`list`) ra CSV/XLSX */
  public async exportUnits(
    query: ExportOrganizationUnitsQuery = {},
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean | undefined },
  ): Promise<ExportOrganizationsResponse> {
    const [units, allUnits, treeNodes] = await Promise.all([
      this.list({
        search: query.search,
        type: query.type,
        status: query.status,
        parentId: query.parentId,
        managerId: query.managerId,
      }),
      this.list({}),
      this.getTree({
        search: query.search,
        type: query.type,
        status: query.status,
      }),
    ]);

    const response = buildOrganizationsExportPayload({
      units,
      allUnits,
      treeNodes,
      query,
    });

    if (options?.skipHistoryRecord !== true) {
      const resolvedFormat = resolveExportFormat(response.format, 'xlsx');
      const history = this.exportRegistry.startExportHistory({
        profileCode: 'organizations',
        module: 'organizations',
        fileName: response.fileName,
        format: resolvedFormat,
        actorId: actorId ?? null,
        filters: query as Readonly<Record<string, unknown>>,
        totalExported: response.totalExported,
        processedRows: response.totalExported,
        status: 'COMPLETED',
      });
      const buffer =
        resolvedFormat === 'csv'
          ? Buffer.from(response.csvContent ?? '', 'utf8')
          : Buffer.from(response.xlsxBase64 ?? '', 'base64');
      this.exportRegistry.storeTemporaryArtifact({
        historyId: history.id,
        profileCode: 'organizations',
        module: 'organizations',
        actorId: actorId ?? null,
        fileName: response.fileName,
        contentType: response.contentType,
        format: resolvedFormat,
        totalExported: response.totalExported,
        buffer,
      });
    }

    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.export',
      resourceType: 'organization_export',
      resourceId: response.fileName,
      beforeData: null,
      afterData: {
        fileName: response.fileName,
        format: response.format,
        mode: response.mode,
        totalExported: response.totalExported,
      },
      reason: `Exported ${response.totalExported} organization units (${response.mode}, ${response.format.toUpperCase()})`,
    });

    return response;
  }

  /** Tải file mẫu (Template) Excel/CSV để nhập cây tổ chức */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportOrganizationsResponse {
    return buildOrganizationsImportTemplatePayload(format);
  }

  /** Nhập cây tổ chức hàng loạt từ Excel (.xlsx), CSV hoặc JSON (kiểm tra đơn vị cha, mã trùng & vòng lặp) */
  public async bulkImportUnits(
    dto: BulkImportOrganizationsRequest,
    actorId?: number,
    options?: { readonly skipHistoryRecord?: boolean | undefined },
  ): Promise<BulkImportOrganizationsResultResponse> {
    const result = await executeBulkImportOrganizations({
      dto,
      findAllUnits: () => this.repository.findFiltered({}),
      resolveManagerId: async ({ managerId, managerIdentifier }) => {
        if (managerId !== undefined && managerId !== null) {
          await validateUnitManagerIdOrThrow(managerId, this.unitManagerResolverDelegate);
          return Number(managerId);
        }
        if (managerIdentifier && managerIdentifier.trim()) {
          if (!this.unitManagerResolverDelegate) {
            return null;
          }
          const found = await this.unitManagerResolverDelegate({
            identifiers: [managerIdentifier.trim()],
          });
          const first = found[0];
          if (!first) {
            throw new BadRequestAppException('organizations.invalidManagerId', [
              { managerIdentifier },
            ]);
          }
          return Number(first.id);
        }
        return null;
      },
      createUnit: (payload) => this.create(payload),
      updateUnit: (unitId, payload) => this.update(unitId, payload),
    });

    if (options?.skipHistoryRecord !== true) {
      const format: 'xlsx' | 'csv' | 'json' = dto.xlsxBase64
        ? 'xlsx'
        : dto.csvContent
          ? 'csv'
          : 'json';
      const duplicateStrategy = resolveImportDuplicateStrategy(
        dto.duplicateStrategy,
        dto.skipDuplicates,
      );
      const history = this.importRegistry.startImportHistory({
        profileCode: 'organizations',
        module: 'organizations',
        fileName: `organizations_import.${format}`,
        format,
        duplicateStrategy,
        columnMapping: dto.columnMapping ?? null,
        totalRows: result.totalRows,
        actorId: actorId ?? null,
        status: 'PROCESSING',
      });
      this.importRegistry.updateImportHistory(history.id, {
        status: result.failedCount > 0 && result.importedCount === 0 ? 'FAILED' : 'COMPLETED',
        totalRows: result.totalRows,
        processedRows: result.totalRows,
        createdCount: result.importedCount,
        updatedCount: result.updatedCount ?? 0,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        completedAt: new Date().toISOString(),
      });
    }

    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.import',
      resourceType: 'organization_unit',
      resourceId: 'BULK_IMPORT',
      beforeData: null,
      afterData: {
        totalRows: result.totalRows,
        importedCount: result.importedCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
      },
      reason: `Imported ${result.importedCount}/${result.totalRows} organization units`,
    });

    return result;
  }

  /** Xóa mềm đơn vị hoặc chi nhánh (chặn xóa khi còn đơn vị con trực thuộc hoặc nhân sự) */
  public async remove(id: number): Promise<{ deleted: true; id: number }> {
    return executeRemoveOrganizationUnit({
      id,
      repository: this.repository,
      unitUsageCountDelegate: this.unitUsageCountDelegate,
      auditLogService: this.auditLogService,
    });
  }

  /** Hợp đồng công khai: Tìm danh sách tóm tắt đơn vị theo mảng ID số nguyên */
  public async findByIds(ids: readonly number[]): Promise<OrganizationUnitSummary[]> {
    const entities = await this.repository.findByIds(ids);
    return entities.map((item) => this.mapper.toSummary(item));
  }

  /** Hợp đồng công khai: Tìm danh sách tóm tắt đơn vị theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<OrganizationUnitSummary[]> {
    const entities = await this.repository.findByCodes(codes);
    return entities.map((item) => this.mapper.toSummary(item));
  }

  /** Hợp đồng công khai: Đảm bảo tất cả đơn vị/chi nhánh đều tồn tại và đang ACTIVE (status = 1) */
  public async ensureActiveUnitsExist(ids: readonly number[]): Promise<OrganizationUnitSummary[]> {
    return ensureActiveOrganizationUnitsExist({
      ids,
      repository: this.repository,
      mapper: this.mapper,
    });
  }

  /**
   * Hợp đồng công khai: Giải quyết danh sách toàn bộ ID đơn vị (bao gồm các đơn vị gốc `rootUnitIds`
   * và toàn bộ đơn vị/phòng ban/nhóm con trực thuộc theo cây `parentId` — Mục 4.3.2).
   */
  public async resolveDescendantUnitIds(rootUnitIds: readonly number[]): Promise<number[]> {
    const allUnits = await this.repository.findFiltered({});
    return collectDescendantUnitIds(allUnits, rootUnitIds, this.includeInactiveInScope);
  }
}
