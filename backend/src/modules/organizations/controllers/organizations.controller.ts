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
  type BulkImportOrganizationsRequest,
  type CreateOrganizationUnitRequest,
  type ExportOrganizationTemplateQuery,
  type ExportOrganizationUnitsQuery,
  type ListOrganizationUnitsQuery,
  type LockOrganizationUnitRequest,
  type MoveOrganizationUnitQuery,
  type MoveOrganizationUnitRequest,
  type UpdateOrganizationUnitRequest,
  bulkImportOrganizationsSchema,
  createOrganizationUnitSchema,
  exportOrganizationTemplateQuerySchema,
  exportOrganizationUnitsQuerySchema,
  listOrganizationUnitsQuerySchema,
  lockOrganizationUnitSchema,
  moveOrganizationUnitQuerySchema,
  moveOrganizationUnitSchema,
  updateOrganizationUnitSchema,
} from '../requests/organizations.requests.js';
import {
  type BulkImportOrganizationsResultResponse,
  type ExportOrganizationsResponse,
  type MoveOrganizationUnitResponse,
  type OrganizationMoveImpactResponse,
  type OrganizationStatsResponse,
  type OrganizationTreeNodeResponse,
  type OrganizationUnitResponse,
  bulkImportOrganizationsResultResponseSchema,
  exportOrganizationsResponseSchema,
  moveOrganizationUnitResponseSchema,
  organizationMoveImpactResponseSchema,
  organizationStatsResponseSchema,
  organizationTreeNodeResponseSchema,
  organizationUnitResponseSchema,
} from '../responses/organizations.response.js';

@ApiGroup('Organizations', 'Quản lý danh mục đơn vị, chi nhánh và phòng ban (Mục 9.1)')
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

  /** Lấy sơ đồ cây đơn vị/chi nhánh phân cấp */
  @Get(ORGANIZATIONS_ROUTES.TREE)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Sơ đồ cây đơn vị, chi nhánh và phòng ban phân cấp (kèm depth, path, children)',
    response: z.array(organizationTreeNodeResponseSchema),
  })
  public async getTree(
    @ValidatedQuery(listOrganizationUnitsQuerySchema) query: ListOrganizationUnitsQuery,
  ): Promise<OrganizationTreeNodeResponse[]> {
    return this.organizationsService.getTree(query);
  }

  /** Lấy thống kê KPI tổng quan của sơ đồ tổ chức */
  @Get(ORGANIZATIONS_ROUTES.STATS)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Thống kê số lượng đơn vị theo cấp bậc, trạng thái và độ sâu cây',
    response: organizationStatsResponseSchema,
  })
  public async getStats(): Promise<OrganizationStatsResponse> {
    return this.organizationsService.getStats();
  }

  /** Xuất danh sách tổ chức theo dạng cây (tree) hoặc danh sách phẳng (list) ra Excel/CSV */
  @Get(ORGANIZATIONS_ROUTES.EXPORT)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Xuất danh sách tổ chức theo dạng cây (tree) hoặc danh sách phẳng (list) ra XLSX/CSV',
    response: exportOrganizationsResponseSchema,
  })
  public async exportUnits(
    @ValidatedQuery(exportOrganizationUnitsQuerySchema) query: ExportOrganizationUnitsQuery,
  ): Promise<ExportOrganizationsResponse> {
    return this.organizationsService.exportUnits(query);
  }

  /** Tải file mẫu (Template) Excel/CSV để nhập cây tổ chức */
  @Get(ORGANIZATIONS_ROUTES.IMPORT_TEMPLATE)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary: 'Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) để nhập cây tổ chức',
    response: exportOrganizationsResponseSchema,
  })
  public exportImportTemplate(
    @ValidatedQuery(exportOrganizationTemplateQuerySchema) query: ExportOrganizationTemplateQuery,
  ): ExportOrganizationsResponse {
    return this.organizationsService.exportImportTemplate(query.format === 'csv' ? 'csv' : 'xlsx');
  }

  /** Nhập cây tổ chức hàng loạt từ Excel (.xlsx), CSV hoặc JSON */
  @Post(ORGANIZATIONS_ROUTES.IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Nhập cây tổ chức hàng loạt (kiểm tra đơn vị cha, mã trùng và quan hệ vòng)',
    response: bulkImportOrganizationsResultResponseSchema,
  })
  public async bulkImportUnits(
    @ValidatedBody(bulkImportOrganizationsSchema) body: BulkImportOrganizationsRequest,
  ): Promise<BulkImportOrganizationsResultResponse> {
    return this.organizationsService.bulkImportUnits(body);
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

  /** Kiểm tra ảnh hưởng đến quyền và dữ liệu trước khi di chuyển đơn vị trong cây */
  @Get(ORGANIZATIONS_ROUTES.MOVE_IMPACT_BY_ID)
  @RequirePermissions('organizations.read')
  @ApiDoc({
    summary:
      'Kiểm tra ảnh hưởng đến quyền và dữ liệu trước khi di chuyển đơn vị sang nhánh cha mới',
    response: organizationMoveImpactResponseSchema,
  })
  public async assessMoveImpact(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedQuery(moveOrganizationUnitQuerySchema) query: MoveOrganizationUnitQuery,
  ): Promise<OrganizationMoveImpactResponse> {
    return this.organizationsService.assessMoveImpact(id, query.newParentId);
  }

  /** Di chuyển đơn vị sang đơn vị cha mới kèm báo cáo ảnh hưởng */
  @Post(ORGANIZATIONS_ROUTES.MOVE_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Di chuyển đơn vị trong cây phân cấp kèm kiểm tra ảnh hưởng đến quyền và dữ liệu',
    response: moveOrganizationUnitResponseSchema,
  })
  public async moveUnit(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(moveOrganizationUnitSchema) body: MoveOrganizationUnitRequest,
  ): Promise<MoveOrganizationUnitResponse> {
    return this.organizationsService.moveUnit(id, body);
  }

  /** Khóa đơn vị (không cho dùng mới nhưng giữ nguyên lịch sử) */
  @Post(ORGANIZATIONS_ROUTES.LOCK_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Khóa đơn vị (chuyển sang INACTIVE, không cho dùng mới nhưng giữ nguyên lịch sử)',
    response: organizationUnitResponseSchema,
  })
  public async lockUnit(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(lockOrganizationUnitSchema) body: LockOrganizationUnitRequest,
  ): Promise<OrganizationUnitResponse> {
    return this.organizationsService.lockUnit(id, body);
  }

  /** Mở khóa đơn vị (chuyển lại sang ACTIVE) */
  @Post(ORGANIZATIONS_ROUTES.UNLOCK_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('organizations.manage')
  @ApiDoc({
    summary: 'Mở khóa đơn vị (chuyển trạng thái sang ACTIVE)',
    response: organizationUnitResponseSchema,
  })
  public async unlockUnit(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(lockOrganizationUnitSchema) body: LockOrganizationUnitRequest,
  ): Promise<OrganizationUnitResponse> {
    return this.organizationsService.unlockUnit(id, body);
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
    summary: 'Cập nhật thông tin đơn vị hoặc chi nhánh (Mã, tên, trạng thái và người phụ trách)',
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
