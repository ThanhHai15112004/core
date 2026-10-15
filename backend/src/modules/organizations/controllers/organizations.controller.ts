import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { ORGANIZATIONS_ROUTES } from '../routes/organizations.routes.js';
import { OrganizationsService } from '../services/organizations.service.js';
import {
  type CreateOrganizationUnitRequest,
  type ListOrganizationUnitsQuery,
  type UpdateOrganizationUnitRequest,
  createOrganizationUnitSchema,
  listOrganizationUnitsQuerySchema,
  updateOrganizationUnitSchema,
} from '../requests/organizations.requests.js';
import {
  type OrganizationUnitResponse,
  organizationUnitResponseSchema,
} from '../responses/organizations.response.js';

@ApiGroup('Organizations', 'Quản lý danh mục đơn vị, chi nhánh và phòng ban')
@Controller(ORGANIZATIONS_ROUTES.PREFIX)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /** Lấy danh sách đơn vị/chi nhánh */
  @Get()
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Danh sách đơn vị, chi nhánh và phòng ban',
    response: z.array(organizationUnitResponseSchema),
  })
  public async list(
    @ValidatedQuery(listOrganizationUnitsQuerySchema) query: ListOrganizationUnitsQuery,
  ): Promise<OrganizationUnitResponse[]> {
    return this.organizationsService.list(query);
  }

  /** Xem chi tiết một đơn vị/chi nhánh */
  @Get(ORGANIZATIONS_ROUTES.BY_ID)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Xem chi tiết đơn vị hoặc chi nhánh theo ID',
    response: organizationUnitResponseSchema,
  })
  public async getById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<OrganizationUnitResponse> {
    return this.organizationsService.getById(id);
  }

  /** Tạo mới đơn vị hoặc chi nhánh */
  @Post()
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Tạo mới đơn vị hoặc chi nhánh',
    status: HTTP_STATUS_CODE.CREATED,
    response: organizationUnitResponseSchema,
  })
  public async create(
    @ValidatedBody(createOrganizationUnitSchema) body: CreateOrganizationUnitRequest,
  ): Promise<OrganizationUnitResponse> {
    return this.organizationsService.create(body);
  }

  /** Cập nhật đơn vị hoặc chi nhánh */
  @Patch(ORGANIZATIONS_ROUTES.BY_ID)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Cập nhật thông tin đơn vị hoặc chi nhánh',
    response: organizationUnitResponseSchema,
  })
  public async update(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateOrganizationUnitSchema) body: UpdateOrganizationUnitRequest,
  ): Promise<OrganizationUnitResponse> {
    return this.organizationsService.update(id, body);
  }

  /** Xóa mềm đơn vị hoặc chi nhánh */
  @Delete(ORGANIZATIONS_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Xóa mềm đơn vị hoặc chi nhánh',
    response: z.object({ deleted: z.literal(true), id: z.number().int().min(1) }),
  })
  public async remove(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<{ deleted: true; id: number }> {
    return this.organizationsService.remove(id);
  }
}
