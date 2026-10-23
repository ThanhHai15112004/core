import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { AuditLogService, DataScopeService } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORG_UNIT_STATUS,
  type OrganizationUnitSummary,
  parseOrgUnitStatus,
  parseOrgUnitType,
} from '../contracts/index.js';
import {
  DEFAULT_INCLUDE_INACTIVE_IN_SCOPE,
  DEFAULT_MAX_HIERARCHY_DEPTH,
  ORGANIZATION_CODE_TYPE_KEYS,
  ORGANIZATION_SETTING_KEYS,
} from '../enum/organizations.enum.js';
import {
  buildOrganizationTree,
  calculateSubtreeDepthBelow,
  collectDescendantUnitIds,
  computeOrganizationStats,
  ensureHierarchyDepthAllowed,
} from '../helpers/organization-hierarchy.helper.js';
import { OrganizationsMapper } from '../mappers/organizations.mapper.js';
import { OrganizationUnitRepository } from '../repositories/organization-unit.repository.js';
import type {
  CreateOrganizationUnitRequest,
  ListOrganizationUnitsQuery,
  UpdateOrganizationUnitRequest,
} from '../requests/organizations.requests.js';
import type {
  OrganizationStatsResponse,
  OrganizationTreeNodeResponse,
  OrganizationUnitResponse,
} from '../responses/organizations.response.js';
import type { UnitUsageCountDelegate } from '../types/organizations.types.js';

@Injectable()
export class OrganizationsService implements IOrganizationsPublicService {
  private unitUsageCountDelegate?: UnitUsageCountDelegate;
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

  /** Lấy danh sách đơn vị/chi nhánh có lọc */
  public async list(query: ListOrganizationUnitsQuery = {}): Promise<OrganizationUnitResponse[]> {
    const units = await this.repository.findFiltered(query);
    return this.mapper.toResponseList(units);
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
    return this.mapper.toResponse(entity);
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
      const allUnits = await this.repository.findFiltered({});
      ensureHierarchyDepthAllowed({
        allUnits,
        parentId: Number(dto.parentId),
        subtreeDepthBelowNode: 0,
        maxDepth: this.maxHierarchyDepth,
      });
    }

    const saved = await this.repository.saveEntity({
      code: normalizedCode,
      name: dto.name.trim(),
      type: parseOrgUnitType(dto.type),
      parentId: dto.parentId ?? null,
      status: parseOrgUnitStatus(dto.status),
      description: dto.description ?? null,
    });

    const response = this.mapper.toResponse(saved);
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
        status: response.status,
      },
      reason: 'Created organization unit',
    });
    return response;
  }

  /** Cập nhật thông tin đơn vị hoặc chi nhánh */
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
      status: entity.status,
      description: entity.description,
    };

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestAppException('organizations.cannotBeOwnParent');
      }
      const parent = await this.repository.findById(dto.parentId);
      if (!parent) {
        throw new BadRequestAppException('organizations.parentNotFound', [
          { parentId: dto.parentId },
        ]);
      }
      const descendants = await this.resolveDescendantUnitIds([Number(id)]);
      if (descendants.includes(Number(dto.parentId))) {
        throw new BadRequestAppException('organizations.circularParentHierarchy', [
          { id, parentId: dto.parentId },
        ]);
      }
      const allUnits = await this.repository.findFiltered({});
      const subtreeDepthBelow = calculateSubtreeDepthBelow(allUnits, Number(id));
      ensureHierarchyDepthAllowed({
        allUnits,
        parentId: Number(dto.parentId),
        subtreeDepthBelowNode: subtreeDepthBelow,
        maxDepth: this.maxHierarchyDepth,
      });
    }

    if (dto.name !== undefined) entity.name = dto.name.trim();
    if (dto.type !== undefined) entity.type = dto.type;
    if (dto.parentId !== undefined) entity.parentId = dto.parentId;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.description !== undefined) entity.description = dto.description;

    const saved = await this.repository.saveEntity(entity);
    const response = this.mapper.toResponse(saved);
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
        status: response.status,
        description: response.description,
      },
      reason: 'Updated organization unit',
    });
    return response;
  }

  /** Đăng ký delegate đếm số người dùng đang gắn với một đơn vị tổ chức */
  public registerUnitUsageCountDelegate(delegate: UnitUsageCountDelegate): void {
    this.unitUsageCountDelegate = delegate;
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
