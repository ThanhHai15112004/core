import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultSettingRegistry,
  pickSelectedFields,
} from '@packages/kernel/index.js';
import { AuditLogService, DataScopeService } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORG_UNIT_STATUS,
  type OrganizationUnitSummary,
  type UnitManagerResolverDelegate,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';
import type { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import {
  DEFAULT_INCLUDE_INACTIVE_IN_SCOPE,
  DEFAULT_MAX_HIERARCHY_DEPTH,
  ORGANIZATION_CODE_TYPE_KEYS,
  ORGANIZATION_SETTING_KEYS,
} from '../enum/organizations.enum.js';
import {
  buildOrganizationTree,
  collectDescendantUnitIds,
  computeOrganizationStats,
  ensureHierarchyDepthAllowed,
  validateAndComputeMoveImpact,
} from '../helpers/organization-hierarchy.helper.js';
import {
  buildOrganizationsExportPayload,
  buildOrganizationsImportTemplatePayload,
  executeBulkImportOrganizations,
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
import type { UnitUsageCountDelegate } from '../types/organizations.types.js';

@Injectable()
export class OrganizationsService implements IOrganizationsPublicService {
  private unitUsageCountDelegate?: UnitUsageCountDelegate;
  private unitManagerResolverDelegate?: UnitManagerResolverDelegate;
  private readonly settingRegistry: SettingRegistryService;

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
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.dataScopeService?.registerOrgHierarchyResolver((unitIds) =>
      this.resolveDescendantUnitIds(unitIds),
    );
    defaultCodeRegistry.registerUsageChecker(
      ORGANIZATION_CODE_TYPE_KEYS.UNIT_TYPE,
      'organization_units.type',
      async ({ numericCode }) => {
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.type) === Number(numericCode)).length;
      },
    );
    defaultCodeRegistry.registerUsageChecker(
      ORGANIZATION_CODE_TYPE_KEYS.STATUS,
      'organization_units.status',
      async ({ numericCode }) => {
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.status) === Number(numericCode)).length;
      },
    );
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

  /** Đăng ký delegate tra cứu thông tin người phụ trách đơn vị từ module Users */
  public registerUnitManagerResolverDelegate(delegate: UnitManagerResolverDelegate): void {
    this.unitManagerResolverDelegate = delegate;
  }

  private async resolveManagerNamesMap(
    units: readonly OrganizationUnitEntity[],
  ): Promise<ReadonlyMap<number, string>> {
    const map = new Map<number, string>();
    if (!this.unitManagerResolverDelegate) return map;

    const managerIds = [
      ...new Set(
        units
          .map((u) => (u.managerId !== undefined && u.managerId !== null ? Number(u.managerId) : 0))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (managerIds.length === 0) return map;

    const managers = await this.unitManagerResolverDelegate({ userIds: managerIds });
    for (const m of managers) {
      map.set(Number(m.id), m.fullName || m.username);
    }
    return map;
  }

  private async validateManagerIdOrThrow(
    managerId: number | null | undefined,
  ): Promise<string | null> {
    if (managerId === undefined || managerId === null) return null;
    if (!this.unitManagerResolverDelegate) return null;

    const found = await this.unitManagerResolverDelegate({ userIds: [Number(managerId)] });
    const manager = found.find((m) => Number(m.id) === Number(managerId));
    if (!manager) {
      throw new BadRequestAppException('organizations.invalidManagerId', [{ managerId }]);
    }
    return manager.fullName || manager.username;
  }

  /** Lấy danh sách đơn vị/chi nhánh có lọc */
  public async list(query: ListOrganizationUnitsQuery = {}): Promise<OrganizationUnitResponse[]> {
    const units = await this.repository.findFiltered(query);
    const managerNameById = await this.resolveManagerNamesMap(units);
    const items = this.mapper.toResponseList(units, managerNameById);
    if (query.fields && query.fields.length > 0) {
      return pickSelectedFields(items, query.fields) as unknown as OrganizationUnitResponse[];
    }
    return items;
  }

  /** Lấy sơ đồ cây đơn vị phân cấp kèm depth, path và số lượng đơn vị con */
  public async getTree(
    query: ListOrganizationUnitsQuery = {},
  ): Promise<OrganizationTreeNodeResponse[]> {
    const list = await this.list(query);
    return buildOrganizationTree(list);
  }

  /** Lấy thống kê KPI tổng quan của sơ đồ tổ chức */
  public async getStats(): Promise<OrganizationStatsResponse> {
    const list = await this.list({});
    return computeOrganizationStats(list, this.maxHierarchyDepth);
  }

  /** Lấy thông tin chi tiết đơn vị/chi nhánh theo ID */
  public async getById(id: number): Promise<OrganizationUnitResponse> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }
    const managerNameById = await this.resolveManagerNamesMap([entity]);
    const mId =
      entity.managerId !== undefined && entity.managerId !== null ? Number(entity.managerId) : null;
    return this.mapper.toResponse(entity, mId !== null ? (managerNameById.get(mId) ?? null) : null);
  }

  /** Tạo mới đơn vị hoặc chi nhánh */
  public async create(dto: CreateOrganizationUnitRequest): Promise<OrganizationUnitResponse> {
    const normalizedCode = dto.code.trim().toUpperCase();
    const existing = await this.repository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'organizations.duplicateCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    if (dto.parentId) {
      const parent = await this.repository.findById(dto.parentId);
      if (!parent) {
        throw new BadRequestAppException('organizations.parentNotFound', [
          { parentId: dto.parentId },
        ]);
      }
      if (Number(parent.status) !== ORG_UNIT_STATUS.ACTIVE) {
        throw new BadRequestAppException('organizations.parentUnitLocked', [
          { parentId: dto.parentId, status: parent.status },
        ]);
      }
      const allUnits = await this.repository.findFiltered({});
      ensureHierarchyDepthAllowed({
        allUnits,
        parentId: Number(dto.parentId),
        subtreeDepthBelowNode: 0,
        maxDepth: this.maxHierarchyDepth,
      });
    }

    const managerName = await this.validateManagerIdOrThrow(dto.managerId);

    const saved = await this.repository.saveEntity({
      code: normalizedCode,
      name: dto.name.trim(),
      type: parseOrgUnitType(dto.type),
      parentId: dto.parentId ?? null,
      managerId: dto.managerId ?? null,
      status: parseOrgUnitStatus(dto.status),
      description: dto.description ?? null,
    });

    const response = this.mapper.toResponse(saved, managerName);
    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.create',
      resourceType: 'organization_unit',
      resourceId: response.id,
      beforeData: null,
      afterData: {
        id: response.id,
        code: response.code,
        name: response.name,
        type: response.type,
        parentId: response.parentId,
        managerId: response.managerId,
        status: response.status,
      },
      reason: 'Created organization unit',
    });
    return response;
  }

  /** Cập nhật thông tin đơn vị (Mã, tên, loại, đơn vị cha, trạng thái và người phụ trách) */
  public async update(
    id: number,
    dto: UpdateOrganizationUnitRequest,
  ): Promise<OrganizationUnitResponse> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }
    const beforeSnapshot = {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId,
      managerId: entity.managerId ?? null,
      status: entity.status,
      description: entity.description,
    };

    if (dto.code !== undefined) {
      const normalizedCode = dto.code.trim().toUpperCase();
      if (normalizedCode !== entity.code) {
        const duplicate = await this.repository.findByCode(normalizedCode);
        if (duplicate && Number(duplicate.id) !== Number(id)) {
          throw new ConflictAppException(
            'organizations.duplicateCode',
            [{ code: normalizedCode }],
            { code: normalizedCode },
            HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          );
        }
        entity.code = normalizedCode;
      }
    }

    if (dto.parentId !== undefined) {
      const allUnits = await this.repository.findFiltered({});
      validateAndComputeMoveImpact({
        allUnits,
        unitId: Number(id),
        newParentId: dto.parentId,
        maxDepth: this.maxHierarchyDepth,
        affectedUserCount: 0,
      });
    }

    let resolvedManagerName: string | null = null;
    if (dto.managerId !== undefined) {
      resolvedManagerName = await this.validateManagerIdOrThrow(dto.managerId);
      entity.managerId = dto.managerId;
    } else if (entity.managerId) {
      const managerMap = await this.resolveManagerNamesMap([entity]);
      resolvedManagerName = managerMap.get(Number(entity.managerId)) ?? null;
    }

    if (dto.name !== undefined) entity.name = dto.name.trim();
    if (dto.type !== undefined) entity.type = dto.type;
    if (dto.parentId !== undefined) entity.parentId = dto.parentId;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.description !== undefined) entity.description = dto.description;

    const saved = await this.repository.saveEntity(entity);
    const response = this.mapper.toResponse(saved, resolvedManagerName);
    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.update',
      resourceType: 'organization_unit',
      resourceId: id,
      beforeData: beforeSnapshot,
      afterData: {
        id: response.id,
        code: response.code,
        name: response.name,
        type: response.type,
        parentId: response.parentId,
        managerId: response.managerId,
        status: response.status,
        description: response.description,
      },
      reason: 'Updated organization unit',
    });
    return response;
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
    if (this.unitUsageCountDelegate) {
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
  ): Promise<BulkImportOrganizationsResultResponse> {
    const result = await executeBulkImportOrganizations({
      dto,
      findAllUnits: () => this.repository.findFiltered({}),
      resolveManagerId: async ({ managerId, managerIdentifier }) => {
        if (managerId !== undefined && managerId !== null) {
          await this.validateManagerIdOrThrow(managerId);
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
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }

    const children = await this.repository.findFiltered({ parentId: Number(id) });
    const activeChildren = children.filter((c) => !c.deletedAt && Number(c.id) !== Number(id));
    if (activeChildren.length > 0) {
      throw new ConflictAppException(
        'organizations.hasChildUnits',
        [{ id, childCount: activeChildren.length }],
        { id, childCount: activeChildren.length },
      );
    }

    if (this.unitUsageCountDelegate) {
      const userCount = await this.unitUsageCountDelegate(Number(id));
      if (userCount > 0) {
        throw new ConflictAppException('organizations.hasAssignedUsers', [{ id, userCount }], {
          id,
          userCount,
        });
      }
    }
    const beforeSnapshot = {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId,
      managerId: entity.managerId ?? null,
      status: entity.status,
    };
    await this.repository.repository.softDelete(id);
    await this.auditLogService?.record({
      module: 'organizations',
      feature: 'organization-unit-management',
      action: 'organization_unit.delete',
      resourceType: 'organization_unit',
      resourceId: id,
      beforeData: beforeSnapshot,
      afterData: { deleted: true },
      reason: 'Soft-deleted organization unit',
    });
    return { deleted: true, id };
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
    const uniqueIds = [...new Set(ids.map(Number))];
    if (uniqueIds.length === 0) return [];

    const entities = await this.repository.findByIds(uniqueIds);
    const foundMap = new Map(entities.map((e) => [Number(e.id), e]));

    const missingIds = uniqueIds.filter((id) => !foundMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestAppException('organizations.invalidOrMissingUnits', [{ missingIds }]);
    }

    const inactiveIds = entities
      .filter((e) => Number(e.status) !== ORG_UNIT_STATUS.ACTIVE)
      .map((e) => Number(e.id));
    if (inactiveIds.length > 0) {
      throw new BadRequestAppException('organizations.inactiveUnitsNotAllowed', [{ inactiveIds }]);
    }

    return entities.map((item) => this.mapper.toSummary(item));
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
