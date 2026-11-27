import {
  Controller,
  Delete,
  Get,
  Headers,
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
  type AcknowledgeAlertRequest,
  AcknowledgeAlertRequestSchema,
  type ActivateBreakGlassRequest,
  ActivateBreakGlassRequestSchema,
  type CreateBreakGlassAccountRequest,
  CreateBreakGlassAccountRequestSchema,
  type CreatePrivilegedGrantRequest,
  CreatePrivilegedGrantRequestSchema,
  type CreatePrivilegedReviewRequest,
  CreatePrivilegedReviewRequestSchema,
  type DecideReviewItemRequest,
  DecideReviewItemRequestSchema,
  type GrantDecisionRequest,
  GrantDecisionRequestSchema,
  type ListBreakGlassAccountsQuery,
  ListBreakGlassAccountsQuerySchema,
  type ListDirectoryUsersQuery,
  ListDirectoryUsersQuerySchema,
  type ListPrivilegedAlertsQuery,
  ListPrivilegedAlertsQuerySchema,
  type ListPrivilegedGrantsQuery,
  ListPrivilegedGrantsQuerySchema,
  type ListPrivilegedReviewsQuery,
  ListPrivilegedReviewsQuerySchema,
  type ListPrivilegedTargetsQuery,
  ListPrivilegedTargetsQuerySchema,
  type SealBreakGlassRequest,
  SealBreakGlassRequestSchema,
  type UpdatePrivilegedTargetRequest,
  UpdatePrivilegedTargetRequestSchema,
  type UpsertPrivilegedTargetRequest,
  UpsertPrivilegedTargetRequestSchema,
  idParamSchema,
  reviewItemParamsSchema,
} from '../requests/privileged-access.requests.js';
import { PRIVILEGED_ACCESS_ROUTES } from '../routes/privileged-access.routes.js';
import { PrivilegedAccessService } from '../services/privileged-access.service.js';
import type {
  BreakGlassAccountView,
  PrivilegedAccessOverviewView,
  PrivilegedAccessReviewDetailView,
  PrivilegedAccessReviewView,
  PrivilegedExpirationSweepResult,
  PrivilegedGrantView,
  PrivilegedTargetView,
  PrivilegedUsageAlertView,
  PrivilegedUserDirectoryItemView,
} from '../types/privileged-access.types.js';

@ApiGroup(
  'Privileged Access Management (PAM — 14.4)',
  'Quản trị quyền đặc biệt: đánh dấu quyền/vai trò nhạy cảm, bắt buộc MFA Step-Up, cấp quyền tạm thời có phê duyệt & tự thu hồi, tài khoản khẩn cấp Break-glass, cảnh báo bảo mật và rà soát định kỳ.',
)
@Controller(PRIVILEGED_ACCESS_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class PrivilegedAccessController {
  constructor(private readonly privilegedAccessService: PrivilegedAccessService) {}

  @Get(PRIVILEGED_ACCESS_ROUTES.OVERVIEW)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Tổng quan chính sách và trạng thái Privileged Access (14.4)' })
  public async getOverview(): Promise<PrivilegedAccessOverviewView> {
    return this.privilegedAccessService.getOverview();
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.DIRECTORY_USERS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({
    summary:
      'Danh sách người dùng hiện có từ bảng users (hỗ trợ lọc tài khoản admin đặc biệt để liên kết Break-glass hoặc cấp quyền)',
  })
  public async listUsersDirectory(
    @ValidatedQuery(ListDirectoryUsersQuerySchema) query: ListDirectoryUsersQuery,
  ): Promise<PaginatedResult<PrivilegedUserDirectoryItemView>> {
    return this.privilegedAccessService.listExistingUsersDirectory(query);
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.DIRECTORY_STANDING_USERS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách tài khoản admin đang giữ vai trò đặc biệt cố định từ bảng users' })
  public async listStandingPrivilegedUsers(): Promise<PrivilegedUserDirectoryItemView[]> {
    return this.privilegedAccessService.listStandingPrivilegedUsers();
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.TARGETS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách vai trò và quyền được đánh dấu đặc biệt' })
  public async listTargets(
    @ValidatedQuery(ListPrivilegedTargetsQuerySchema) query: ListPrivilegedTargetsQuery,
  ): Promise<PaginatedResult<PrivilegedTargetView>> {
    return this.privilegedAccessService.listTargets(query);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.TARGETS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Đánh dấu hoặc cập nhật chính sách vai trò/quyền đặc biệt (MFA Step-Up)' })
  public async upsertTarget(
    @ValidatedBody(UpsertPrivilegedTargetRequestSchema) body: UpsertPrivilegedTargetRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    return this.privilegedAccessService.upsertTarget(body, actor);
  }

  @Put(PRIVILEGED_ACCESS_ROUTES.TARGET_BY_ID)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Cập nhật chính sách vai trò/quyền đặc biệt theo ID (MFA Step-Up)' })
  public async updateTarget(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(UpdatePrivilegedTargetRequestSchema) body: UpdatePrivilegedTargetRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    return this.privilegedAccessService.updateTarget(params.id, body, actor);
  }

  @Delete(PRIVILEGED_ACCESS_ROUTES.TARGET_BY_ID)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Xóa mềm đánh dấu vai trò/quyền đặc biệt (MFA Step-Up)' })
  public async deleteTarget(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.privilegedAccessService.deleteTarget(params.id, actor);
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.GRANTS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách yêu cầu và bản ghi cấp quyền tạm thời (JIT)' })
  public async listGrants(
    @ValidatedQuery(ListPrivilegedGrantsQuerySchema) query: ListPrivilegedGrantsQuery,
  ): Promise<PaginatedResult<PrivilegedGrantView>> {
    return this.privilegedAccessService.listGrants(query);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('privileged-access.request')
  @ApiDoc({ summary: 'Tạo yêu cầu cấp quyền đặc biệt tạm thời có thời hạn và lý do' })
  public async requestGrant(
    @ValidatedBody(CreatePrivilegedGrantRequestSchema) body: CreatePrivilegedGrantRequest,
    @CurrentUser() actor?: UserIdentity,
    @Headers('x-step-up-token') stepUpToken?: string,
  ): Promise<PrivilegedGrantView> {
    return this.privilegedAccessService.requestGrant(body, actor, Boolean(stepUpToken?.trim()));
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANT_APPROVE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.approve')
  @ApiDoc({ summary: 'Phê duyệt yêu cầu cấp quyền tạm thời (chặn tự duyệt, MFA Step-Up)' })
  public async approveGrant(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(GrantDecisionRequestSchema) body: GrantDecisionRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.privilegedAccessService.approveGrant(params.id, body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANT_REJECT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.approve')
  @ApiDoc({ summary: 'Từ chối yêu cầu cấp quyền tạm thời (MFA Step-Up)' })
  public async rejectGrant(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(GrantDecisionRequestSchema) body: GrantDecisionRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.privilegedAccessService.rejectGrant(params.id, body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANT_REVOKE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.approve')
  @ApiDoc({ summary: 'Thu hồi sớm quyền tạm thời đang hiệu lực (MFA Step-Up)' })
  public async revokeGrant(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(GrantDecisionRequestSchema) body: GrantDecisionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.privilegedAccessService.revokeGrant(params.id, body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANT_CANCEL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.request')
  @ApiDoc({ summary: 'Hủy yêu cầu cấp quyền tạm thời đang chờ duyệt' })
  public async cancelGrant(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.privilegedAccessService.cancelGrant(params.id, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.GRANTS_SWEEP_EXPIRED)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Quét và thu hồi ngay các quyền tạm thời & Break-glass đã hết hạn' })
  public async sweepExpired(): Promise<PrivilegedExpirationSweepResult> {
    return this.privilegedAccessService.sweepExpiredAccess();
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.BREAK_GLASS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách tài khoản khẩn cấp Break-glass' })
  public async listBreakGlassAccounts(
    @ValidatedQuery(ListBreakGlassAccountsQuerySchema) query: ListBreakGlassAccountsQuery,
  ): Promise<PaginatedResult<BreakGlassAccountView>> {
    return this.privilegedAccessService.listBreakGlassAccounts(query);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.BREAK_GLASS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('privileged-access.break_glass.manage')
  @ApiDoc({
    summary:
      'Đăng ký tài khoản khẩn cấp Break-glass (liên kết user admin sẵn có hoặc tạo mới — MFA Step-Up)',
  })
  public async createBreakGlassAccount(
    @ValidatedBody(CreateBreakGlassAccountRequestSchema) body: CreateBreakGlassAccountRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.privilegedAccessService.createBreakGlassAccount(body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.BREAK_GLASS_ACTIVATE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.break_glass.manage')
  @ApiDoc({ summary: 'Kích hoạt khẩn cấp tài khoản Break-glass có thời hạn & lý do (MFA Step-Up)' })
  public async activateBreakGlass(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(ActivateBreakGlassRequestSchema) body: ActivateBreakGlassRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.privilegedAccessService.activateBreakGlass(params.id, body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.BREAK_GLASS_SEAL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.break_glass.manage')
  @ApiDoc({
    summary: 'Niêm phong lại tài khoản Break-glass, khóa user & thu hồi phiên (MFA Step-Up)',
  })
  public async sealBreakGlass(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(SealBreakGlassRequestSchema) body: SealBreakGlassRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.privilegedAccessService.sealBreakGlass(params.id, body, actor);
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.ALERTS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách cảnh báo sử dụng quyền đặc biệt và Break-glass' })
  public async listAlerts(
    @ValidatedQuery(ListPrivilegedAlertsQuerySchema) query: ListPrivilegedAlertsQuery,
  ): Promise<PaginatedResult<PrivilegedUsageAlertView>> {
    return this.privilegedAccessService.listAlerts(query);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.ALERT_ACKNOWLEDGE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Xác nhận đã kiểm tra cảnh báo bảo mật (MFA Step-Up)' })
  public async acknowledgeAlert(
    @ValidatedParams(idParamSchema) params: { id: number },
    @ValidatedBody(AcknowledgeAlertRequestSchema) body: AcknowledgeAlertRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedUsageAlertView> {
    return this.privilegedAccessService.acknowledgeAlert(params.id, body, actor);
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.REVIEWS)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Danh sách các đợt rà soát quyền đặc biệt định kỳ' })
  public async listReviews(
    @ValidatedQuery(ListPrivilegedReviewsQuerySchema) query: ListPrivilegedReviewsQuery,
  ): Promise<PaginatedResult<PrivilegedAccessReviewView>> {
    return this.privilegedAccessService.listReviews(query);
  }

  @Get(PRIVILEGED_ACCESS_ROUTES.REVIEW_BY_ID)
  @RequirePermissions('privileged-access.read')
  @ApiDoc({ summary: 'Chi tiết một đợt rà soát quyền đặc biệt và danh sách mục cần duyệt' })
  public async getReviewDetail(
    @ValidatedParams(idParamSchema) params: { id: number },
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.privilegedAccessService.getReviewDetail(params.id);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.REVIEWS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Khởi tạo đợt rà soát quyền đặc biệt mới (MFA Step-Up)' })
  public async createReviewCampaign(
    @ValidatedBody(CreatePrivilegedReviewRequestSchema) body: CreatePrivilegedReviewRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.privilegedAccessService.createReviewCampaign(body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.REVIEW_ITEM_DECIDE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Quyết định Giữ hoặc Thu hồi quyền đặc biệt trong đợt rà soát (MFA Step-Up)' })
  public async decideReviewItem(
    @ValidatedParams(reviewItemParamsSchema) params: { id: number; itemId: number },
    @ValidatedBody(DecideReviewItemRequestSchema) body: DecideReviewItemRequest,
    @CurrentUser() actor: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.privilegedAccessService.decideReviewItem(params.id, params.itemId, body, actor);
  }

  @Post(PRIVILEGED_ACCESS_ROUTES.REVIEW_CLOSE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('privileged-access.manage')
  @ApiDoc({ summary: 'Đóng đợt rà soát quyền đặc biệt (MFA Step-Up)' })
  public async closeReview(
    @ValidatedParams(idParamSchema) params: { id: number },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.privilegedAccessService.closeReview(params.id, actor);
  }
}
