import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intIdParamSchema,
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  CreateProviderEntryRequestSchema,
  ListProviderConfigHistoriesQuerySchema,
  ListProviderEntriesQuerySchema,
  ListProviderHealthChecksQuerySchema,
  ListProviderUnitAssignmentsQuerySchema,
  PauseProviderRequestSchema,
  ProviderDashboardQuerySchema,
  RecordProviderObservationRequestSchema,
  ResolveProviderPreviewRequestSchema,
  ResumeProviderRequestSchema,
  RunHealthCheckAllRequestSchema,
  SetPrimaryProviderRequestSchema,
  UpdateProviderEntryRequestSchema,
  UpsertProviderUnitAssignmentRequestSchema,
  type CreateProviderEntryRequest,
  type ListProviderConfigHistoriesQuery,
  type ListProviderEntriesQuery,
  type ListProviderHealthChecksQuery,
  type ListProviderUnitAssignmentsQuery,
  type PauseProviderRequest,
  type ProviderDashboardQuery,
  type RecordProviderObservationRequest,
  type ResolveProviderPreviewRequest,
  type ResumeProviderRequest,
  type RunHealthCheckAllRequest,
  type SetPrimaryProviderRequest,
  type UpdateProviderEntryRequest,
  type UpsertProviderUnitAssignmentRequest,
} from '../requests/provider-registry.requests.js';
import { PROVIDER_REGISTRY_ROUTES } from '../routes/provider-registry.routes.js';
import { ProviderRegistryService } from '../services/provider-registry.service.js';
import type {
  ProviderCatalogView,
  ProviderConfigHistoryView,
  ProviderDashboardView,
  ProviderHealthCheckView,
  ProviderRegistryEntryView,
  ProviderResolvePreviewView,
  ProviderUnitAssignmentView,
} from '../types/provider-registry.types.js';

@ApiGroup(
  'Provider Registry (10.6)',
  'Quản lý nhà cung cấp theo loại (Email, SMS, Payment, Storage, Identity), định tuyến Primary/Fallback/Đơn vị, kiểm tra sức khỏe (Healthy/Degraded/Down), theo dõi độ trễ & tỷ lệ lỗi, tạm dừng runtime và audit thay đổi.',
)
@Controller(PROVIDER_REGISTRY_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class ProviderRegistryController {
  constructor(private readonly providerRegistryService: ProviderRegistryService) {}

  @Get(PROVIDER_REGISTRY_ROUTES.CATALOG)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Danh sách loại Provider và Driver tham khảo theo từng loại' })
  public getCatalog(): ProviderCatalogView {
    return this.providerRegistryService.getCatalog();
  }

  @Get(PROVIDER_REGISTRY_ROUTES.DASHBOARD)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Dashboard sức khỏe, độ trễ và tỷ lệ lỗi của các nhà cung cấp' })
  public async getDashboard(
    @ValidatedQuery(ProviderDashboardQuerySchema) query: ProviderDashboardQuery,
  ): Promise<ProviderDashboardView> {
    return this.providerRegistryService.getDashboard(query);
  }

  @Get(PROVIDER_REGISTRY_ROUTES.PROVIDERS)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Danh sách nhà cung cấp đã đăng ký (phân trang & lọc)' })
  public async listProviders(
    @ValidatedQuery(ListProviderEntriesQuerySchema) query: ListProviderEntriesQuery,
  ): Promise<PaginatedResult<ProviderRegistryEntryView>> {
    return this.providerRegistryService.listProviders(query);
  }

  @Get(PROVIDER_REGISTRY_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Chi tiết một nhà cung cấp trong Registry' })
  public async getProviderById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.getProviderById(params.id);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDERS)
  @RequirePermissions('provider-registry.manage')
  @ApiDoc({ summary: 'Đăng ký nhà cung cấp mới theo loại (Email/SMS/Payment/Storage/Identity)' })
  public async createProvider(
    @ValidatedBody(CreateProviderEntryRequestSchema) body: CreateProviderEntryRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.createProvider(body, actor);
  }

  @Patch(PROVIDER_REGISTRY_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('provider-registry.manage')
  @ApiDoc({ summary: 'Cập nhật cấu hình nhà cung cấp và ghi lịch sử audit' })
  public async updateProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateProviderEntryRequestSchema) body: UpdateProviderEntryRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.updateProvider(params.id, body, actor);
  }

  @Delete(PROVIDER_REGISTRY_ROUTES.PROVIDER_BY_ID)
  @RequirePermissions('provider-registry.manage')
  @ApiDoc({ summary: 'Xóa mềm nhà cung cấp khỏi Registry' })
  public async deleteProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.providerRegistryService.deleteProvider(params.id, undefined, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDER_SET_PRIMARY)
  @RequirePermissions('provider-registry.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Đặt nhà cung cấp làm Primary mặc định cho loại tương ứng' })
  public async setPrimary(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(SetPrimaryProviderRequestSchema) body: SetPrimaryProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.setPrimary(params.id, body, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDER_PAUSE)
  @RequirePermissions('provider-registry.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Tạm dừng nhà cung cấp ngay tại runtime không cần sửa code' })
  public async pauseProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(PauseProviderRequestSchema) body: PauseProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.pauseProvider(params.id, body, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDER_RESUME)
  @RequirePermissions('provider-registry.manage')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Khôi phục hoạt động nhà cung cấp đang tạm dừng' })
  public async resumeProvider(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(ResumeProviderRequestSchema) body: ResumeProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    return this.providerRegistryService.resumeProvider(params.id, body.reason, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.RESOLVE)
  @RequirePermissions('provider-registry.read')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Kiểm thử phân giải Provider chính/dự phòng theo loại và đơn vị' })
  public async resolvePreview(
    @ValidatedBody(ResolveProviderPreviewRequestSchema) body: ResolveProviderPreviewRequest,
  ): Promise<ProviderResolvePreviewView> {
    return this.providerRegistryService.resolveProviderPreview(body);
  }

  @Get(PROVIDER_REGISTRY_ROUTES.UNIT_ASSIGNMENTS)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Danh sách cấu hình chọn nhà cung cấp theo đơn vị' })
  public async listUnitAssignments(
    @ValidatedQuery(ListProviderUnitAssignmentsQuerySchema) query: ListProviderUnitAssignmentsQuery,
  ): Promise<PaginatedResult<ProviderUnitAssignmentView>> {
    return this.providerRegistryService.listUnitAssignments(query);
  }

  @Put(PROVIDER_REGISTRY_ROUTES.UNIT_ASSIGNMENTS)
  @RequirePermissions('provider-registry.manage')
  @ApiDoc({ summary: 'Tạo hoặc cập nhật cấu hình chọn nhà cung cấp cho đơn vị' })
  public async upsertUnitAssignment(
    @ValidatedBody(UpsertProviderUnitAssignmentRequestSchema)
    body: UpsertProviderUnitAssignmentRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderUnitAssignmentView> {
    return this.providerRegistryService.upsertUnitAssignment(body, actor);
  }

  @Delete(PROVIDER_REGISTRY_ROUTES.UNIT_ASSIGNMENT_BY_ID)
  @RequirePermissions('provider-registry.manage')
  @ApiDoc({ summary: 'Gỡ bỏ cấu hình nhà cung cấp riêng của đơn vị' })
  public async deleteUnitAssignment(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.providerRegistryService.deleteUnitAssignment(params.id, undefined, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDER_HEALTH_CHECK)
  @RequirePermissions('provider-registry.health')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Chạy kiểm tra sức khỏe cho một nhà cung cấp (Healthy/Degraded/Down)' })
  public async checkProviderHealth(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ProviderHealthCheckView> {
    return this.providerRegistryService.checkProviderHealth(params.id, actor);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.HEALTH_CHECK_ALL)
  @RequirePermissions('provider-registry.health')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Chạy kiểm tra sức khỏe toàn bộ nhà cung cấp đang kích hoạt' })
  public async checkAllProvidersHealth(
    @ValidatedBody(RunHealthCheckAllRequestSchema) body: RunHealthCheckAllRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<readonly ProviderHealthCheckView[]> {
    return this.providerRegistryService.checkAllProvidersHealth(body, actor);
  }

  @Get(PROVIDER_REGISTRY_ROUTES.PROVIDER_HEALTH_CHECKS)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Lịch sử kiểm tra sức khỏe của một nhà cung cấp' })
  public async listHealthChecks(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedQuery(ListProviderHealthChecksQuerySchema) query: ListProviderHealthChecksQuery,
  ): Promise<PaginatedResult<ProviderHealthCheckView>> {
    return this.providerRegistryService.listHealthChecks(params.id, query);
  }

  @Post(PROVIDER_REGISTRY_ROUTES.PROVIDER_OBSERVATIONS)
  @RequirePermissions('provider-registry.health')
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Ghi nhận mẫu đo độ trễ/lỗi vận hành cho nhà cung cấp' })
  public async recordManualObservation(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(RecordProviderObservationRequestSchema) body: RecordProviderObservationRequest,
  ): Promise<{ readonly recorded: true; readonly providerId: number }> {
    return this.providerRegistryService.recordManualObservation(params.id, body);
  }

  @Get(PROVIDER_REGISTRY_ROUTES.HISTORIES)
  @RequirePermissions('provider-registry.read')
  @ApiDoc({ summary: 'Lịch sử audit thay đổi cấu hình nhà cung cấp' })
  public async listHistories(
    @ValidatedQuery(ListProviderConfigHistoriesQuerySchema) query: ListProviderConfigHistoriesQuery,
  ): Promise<PaginatedResult<ProviderConfigHistoryView>> {
    return this.providerRegistryService.listHistories(query);
  }
}
