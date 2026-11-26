import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  type CreateScimClientRequest,
  CreateScimClientRequestSchema,
  type ListScimDirectoryQuery,
  ListScimDirectoryQuerySchema,
  type ListScimReconciliationsQuery,
  ListScimReconciliationsQuerySchema,
  type ListScimSyncLogsQuery,
  ListScimSyncLogsQuerySchema,
  type RunScimReconciliationRequest,
  RunScimReconciliationRequestSchema,
  type UpdateScimClientRequest,
  UpdateScimClientRequestSchema,
  clientIdParamSchema,
} from '../requests/identity-provisioning.requests.js';
import { IDENTITY_PROVISIONING_ADMIN_ROUTES } from '../routes/identity-provisioning.routes.js';
import { IdentityProvisioningService } from '../services/identity-provisioning.service.js';
import type {
  ScimClientCreatedView,
  ScimClientView,
  ScimGroupSummaryView,
  ScimReconciliationRunView,
  ScimSyncLogView,
  ScimUserLinkView,
} from '../types/identity-provisioning.types.js';

@ApiGroup(
  'Identity Provisioning — Admin SCIM Management',
  'Quản trị SCIM Clients (token riêng, IP allowlist, group-to-role mapping), tra cứu liên kết User/Group, nhật ký đồng bộ và đối soát với Identity Provider.',
)
@Controller(IDENTITY_PROVISIONING_ADMIN_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class IdentityProvisioningAdminController {
  constructor(private readonly provisioningService: IdentityProvisioningService) {}

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENTS)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Danh sách cấu hình SCIM Clients' })
  public async listClients(): Promise<ScimClientView[]> {
    return this.provisioningService.listClients();
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENT_BY_ID)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Chi tiết một SCIM Client' })
  public async getClientById(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
  ): Promise<ScimClientView> {
    return this.provisioningService.getClientById(params.id);
  }

  @Post(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('identity-provisioning.manage')
  @ApiDoc({ summary: 'Tạo SCIM Client mới và cấp Bearer Token (hiển thị 1 lần)' })
  public async createClient(
    @ValidatedBody(CreateScimClientRequestSchema) body: CreateScimClientRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    return this.provisioningService.createClient(body, actor);
  }

  @Put(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENT_BY_ID)
  @RequirePermissions('identity-provisioning.manage')
  @ApiDoc({ summary: 'Cập nhật cấu hình SCIM Client (IP allowlist, role mapping, deprovision mode)' })
  public async updateClient(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
    @ValidatedBody(UpdateScimClientRequestSchema) body: UpdateScimClientRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ScimClientView> {
    return this.provisioningService.updateClient(params.id, body, actor);
  }

  @Post(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENT_ROTATE_TOKEN)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('identity-provisioning.manage')
  @ApiDoc({ summary: 'Xoay vòng Bearer Token mới cho SCIM Client' })
  public async rotateClientToken(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    return this.provisioningService.rotateClientToken(params.id, actor);
  }

  @Delete(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENT_BY_ID)
  @RequirePermissions('identity-provisioning.manage')
  @ApiDoc({ summary: 'Xóa mềm cấu hình SCIM Client' })
  public async deleteClient(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.provisioningService.deleteClient(params.id, actor);
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.USER_LINKS)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Danh sách liên kết SCIM User Links theo client' })
  public async listUserLinks(
    @ValidatedQuery(ListScimDirectoryQuerySchema) query: ListScimDirectoryQuery,
  ): Promise<PaginatedResult<ScimUserLinkView>> {
    return this.provisioningService.listUserLinks(query);
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.GROUPS)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Danh sách nhóm SCIM đã đồng bộ' })
  public async listGroups(
    @ValidatedQuery(ListScimDirectoryQuerySchema) query: ListScimDirectoryQuery,
  ): Promise<PaginatedResult<ScimGroupSummaryView>> {
    return this.provisioningService.listGroups(query);
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.SYNC_LOGS)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Lịch sử đồng bộ SCIM (request, kết quả, idempotency và lỗi)' })
  public async listSyncLogs(
    @ValidatedQuery(ListScimSyncLogsQuerySchema) query: ListScimSyncLogsQuery,
  ): Promise<PaginatedResult<ScimSyncLogView>> {
    return this.provisioningService.listSyncLogs(query);
  }

  @Post(IDENTITY_PROVISIONING_ADMIN_ROUTES.CLIENT_RECONCILE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('identity-provisioning.manage')
  @ApiDoc({ summary: 'Đối soát dữ liệu User/Group giữa hệ thống nội bộ và snapshot từ IdP' })
  public async reconcileWithIdp(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
    @ValidatedBody(RunScimReconciliationRequestSchema) body: RunScimReconciliationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ScimReconciliationRunView> {
    return this.provisioningService.reconcileWithIdp(params.id, body, actor);
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.RECONCILIATIONS)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Lịch sử các lần đối soát dữ liệu SCIM với Identity Provider' })
  public async listReconciliations(
    @ValidatedQuery(ListScimReconciliationsQuerySchema) query: ListScimReconciliationsQuery,
  ): Promise<PaginatedResult<ScimReconciliationRunView>> {
    return this.provisioningService.listReconciliationRuns(query);
  }

  @Get(IDENTITY_PROVISIONING_ADMIN_ROUTES.RECONCILIATION_BY_ID)
  @RequirePermissions('identity-provisioning.read')
  @ApiDoc({ summary: 'Chi tiết một phiên đối soát SCIM' })
  public async getReconciliationById(
    @ValidatedParams(clientIdParamSchema) params: { id: number },
  ): Promise<ScimReconciliationRunView> {
    return this.provisioningService.getReconciliationRunById(params.id);
  }
}
