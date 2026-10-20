import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  defaultCodeRegistry,
} from '@packages/kernel/index.js';
import { AuditLogService, DataScopeService } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORG_UNIT_STATUS,
  ORG_UNIT_TYPE,
  type OrganizationUnitSummary,
} from '../contracts/index.js';
import { OrganizationUnitRepository } from '../repositories/organization-unit.repository.js';
import { OrganizationsMapper } from '../mappers/organizations.mapper.js';
import type {
  CreateOrganizationUnitRequest,
  ListOrganizationUnitsQuery,
  UpdateOrganizationUnitRequest,
} from '../requests/organizations.requests.js';
import type { OrganizationUnitResponse } from '../responses/organizations.response.js';

@Injectable()
export class OrganizationsService implements IOrganizationsPublicService {
  private unitUsageCountDelegate?: (unitId: number) => Promise<number>;

  constructor(
    private readonly repository: OrganizationUnitRepository,
    private readonly mapper: OrganizationsMapper,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
  ) {
    this.dataScopeService?.registerOrgHierarchyResolver((unitIds) =>
      this.resolveDescendantUnitIds(unitIds),
    );
    defaultCodeRegistry.registerUsageChecker(
      'organizations.unit_type',
      'organization_units.type',
      async ({ numericCode }) => {
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.type) === Number(numericCode)).length;
      },
    );
    defaultCodeRegistry.registerUsageChecker(
      'organizations.unit_status',
      'organization_units.status',
      async ({ numericCode }) => {
        const units = await this.repository.findFiltered({});
        return units.filter((u) => !u.deletedAt && Number(u.status) === Number(numericCode)).length;
      },
    );
  }

  /** Lấy danh sách đơn vị/chi nhánh có lọc */
  public async list(query: ListOrganizationUnitsQuery = {}): Promise<OrganizationUnitResponse[]> {
    const units = await this.repository.findFiltered(query);
    return this.mapper.toResponseList(units);
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
    }

    const saved = await this.repository.saveEntity({
      code: normalizedCode,
      name: dto.name.trim(),
      type: dto.type ?? ORG_UNIT_TYPE.BRANCH,
      parentId: dto.parentId ?? null,
      status: dto.status ?? ORG_UNIT_STATUS.ACTIVE,
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
  public registerUnitUsageCountDelegate(delegate: (unitId: number) => Promise<number>): void {
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
    const seeds = [
      ...new Set(rootUnitIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (seeds.length === 0) return [];

    const allUnits = await this.repository.findFiltered({});
    const childrenByParent = new Map<number, number[]>();
    for (const unit of allUnits) {
      if (Number(unit.status) === ORG_UNIT_STATUS.ARCHIVED) continue;
      if (unit.parentId !== undefined && unit.parentId !== null) {
        const pId = Number(unit.parentId);
        const list = childrenByParent.get(pId) ?? [];
        list.push(Number(unit.id));
        childrenByParent.set(pId, list);
      }
    }

    const visited = new Set<number>(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenByParent.get(current) ?? [];
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }

    return [...visited].sort((a, b) => a - b);
  }
}
