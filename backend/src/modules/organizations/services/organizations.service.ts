import { Injectable } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
} from '@packages/kernel/index.js';
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
  constructor(
    private readonly repository: OrganizationUnitRepository,
    private readonly mapper: OrganizationsMapper,
  ) {}

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

    return this.mapper.toResponse(saved);
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
    }

    if (dto.name !== undefined) entity.name = dto.name.trim();
    if (dto.type !== undefined) entity.type = dto.type;
    if (dto.parentId !== undefined) entity.parentId = dto.parentId;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.description !== undefined) entity.description = dto.description;

    const saved = await this.repository.saveEntity(entity);
    return this.mapper.toResponse(saved);
  }

  /** Xóa mềm đơn vị hoặc chi nhánh */
  public async remove(id: number): Promise<{ deleted: true; id: number }> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundAppException('organizations.notFound', { id });
    }
    await this.repository.repository.softDelete(id);
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
}
