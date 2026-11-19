import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ApiDoc,
  ApiGroup,
  Public,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intIdParamSchema,
} from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { FEDERATED_FLOW_TYPE } from '../enum/federated-identity.enum.js';
import {
  type InitiateAuthorizeRequest,
  InitiateAuthorizeRequestSchema,
  type ListMonitoringErrorsQuery,
  ListMonitoringErrorsQuerySchema,
  type MonitoringSummaryQuery,
  MonitoringSummaryQuerySchema,
  type OAuthCallbackRequest,
  OAuthCallbackRequestSchema,
  providerCodeParamSchema,
  type UnlinkAccountQuery,
  UnlinkAccountQuerySchema,
  type UpsertFederatedProviderRequest,
  UpsertFederatedProviderRequestSchema,
  userAndIdentityIdParamSchema,
  userIdParamSchema,
} from '../requests/federated-identity.requests.js';
import { FEDERATED_IDENTITY_ROUTES } from '../routes/federated-identity.routes.js';
import { FederatedIdentityService } from '../services/federated-identity.service.js';
import type {
  FederatedAuthEventView,
  FederatedDriverMetadata,
  FederatedIdentityView,
  FederatedMonitoringSummaryView,
  FederatedPolicyView,
  FederatedProviderView,
  InitiateOAuthAuthorizeResult,
  OAuthCallbackResult,
  PublicFederatedProviderView,
  TestProviderConnectionResult,
  UnlinkFederatedIdentityResult,
} from '../types/federated-identity.types.js';

function extractRequestMeta(req?: FastifyRequest): {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
} {
  const uaHeader = req?.headers?.['user-agent'];
  return {
    ipAddress: req?.ip ?? null,
    userAgent: typeof uaHeader === 'string' ? uaHeader : null,
  };
}

@ApiGroup(
  'Federated Identity (OAuth / External Login)',
  'Đăng nhập và liên kết tài khoản qua Google / Microsoft với State, Nonce, PKCE, định danh ổn định (sub), bảo vệ chống gỡ phương thức đăng nhập cuối và theo dõi lỗi nhà cung cấp.',
)
@Controller(FEDERATED_IDENTITY_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class FederatedIdentityController {
  constructor(private readonly federatedIdentityService: FederatedIdentityService) {}

  @Public()
  @Get(FEDERATED_IDENTITY_ROUTES.PUBLIC_PROVIDERS)
  @ApiDoc({ summary: 'Danh sách nhà cung cấp đăng nhập ngoài đang bật cho màn hình đăng nhập' })
  public async listPublicProviders(): Promise<PublicFederatedProviderView[]> {
    return this.federatedIdentityService.listPublicProviders();
  }

  @Public()
  @Post(FEDERATED_IDENTITY_ROUTES.PROVIDER_AUTHORIZE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Khởi tạo phiên đăng nhập OAuth (tạo State, Nonce & PKCE S256)' })
  public async initiateLoginAuthorize(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(InitiateAuthorizeRequestSchema) body: InitiateAuthorizeRequest,
    @Req() req?: FastifyRequest,
  ): Promise<InitiateOAuthAuthorizeResult> {
    return this.federatedIdentityService.initiateLoginAuthorize(
      params.providerCode,
      body,
      extractRequestMeta(req),
    );
  }

  @Public()
  @Post(FEDERATED_IDENTITY_ROUTES.PROVIDER_CALLBACK)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary:
      'Hoàn tất callback OAuth từ SPA (đổi code với PKCE, kiểm tra State/Nonce/JWKS và cấp Session)',
  })
  public async handleCallback(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(OAuthCallbackRequestSchema) body: OAuthCallbackRequest,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<OAuthCallbackResult> {
    const meta = extractRequestMeta(req);
    return this.federatedIdentityService.handleCallback(params.providerCode, body, {
      actorUserId: actor?.id ?? null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  @Get(FEDERATED_IDENTITY_ROUTES.MY_ACCOUNTS)
  @ApiDoc({ summary: 'Danh sách tài khoản ngoài đã liên kết của người dùng hiện tại' })
  public async listMyAccounts(
    @CurrentUser() actor: UserIdentity,
  ): Promise<FederatedIdentityView[]> {
    return this.federatedIdentityService.listUserIdentities(actor.id);
  }

  @Post(FEDERATED_IDENTITY_ROUTES.LINK_AUTHORIZE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Khởi tạo luồng liên kết tài khoản ngoài vào tài khoản đang đăng nhập' })
  public async initiateLinkAuthorize(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(InitiateAuthorizeRequestSchema) body: InitiateAuthorizeRequest,
    @CurrentUser() actor: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<InitiateOAuthAuthorizeResult> {
    return this.federatedIdentityService.initiateLinkAuthorize(
      params.providerCode,
      actor.id,
      body,
      extractRequestMeta(req),
    );
  }

  @Post(FEDERATED_IDENTITY_ROUTES.LINK_CALLBACK)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({ summary: 'Hoàn tất callback liên kết tài khoản ngoài cho người dùng đang đăng nhập' })
  public async handleLinkCallback(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(OAuthCallbackRequestSchema) body: OAuthCallbackRequest,
    @CurrentUser() actor: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<OAuthCallbackResult> {
    const meta = extractRequestMeta(req);
    return this.federatedIdentityService.handleCallback(params.providerCode, body, {
      actorUserId: actor.id,
      expectedFlowType: FEDERATED_FLOW_TYPE.LINK,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  @Delete(FEDERATED_IDENTITY_ROUTES.UNLINK_ACCOUNT)
  @ApiDoc({
    summary:
      'Gỡ liên kết một tài khoản ngoài của chính mình (chặn nếu không còn mật khẩu hoặc phương thức khác)',
  })
  public async unlinkMyAccount(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedQuery(UnlinkAccountQuerySchema) query: UnlinkAccountQuery,
    @CurrentUser() actor: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<UnlinkFederatedIdentityResult> {
    const meta = extractRequestMeta(req);
    return this.federatedIdentityService.unlinkUserIdentity(actor.id, params.id, {
      actorUserId: actor.id,
      stepUpToken: query.stepUpToken,
      enforceSelfStepUp: true,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  @Get(FEDERATED_IDENTITY_ROUTES.DRIVERS)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Danh sách OAuth Adapter Drivers được hỗ trợ (Google, Microsoft...)' })
  public listDrivers(): FederatedDriverMetadata[] {
    return this.federatedIdentityService.listDrivers();
  }

  @Get(FEDERATED_IDENTITY_ROUTES.POLICY)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Xem chính sách runtime hiện hành và các setting keys cấu hình OAuth' })
  public async getPolicy(): Promise<FederatedPolicyView> {
    return this.federatedIdentityService.getPolicy();
  }

  @Get(FEDERATED_IDENTITY_ROUTES.PROVIDERS)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Danh sách cấu hình nhà cung cấp OAuth (Admin)' })
  public async listProviders(): Promise<FederatedProviderView[]> {
    return this.federatedIdentityService.listProviders();
  }

  @Get(FEDERATED_IDENTITY_ROUTES.PROVIDER_BY_CODE)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Chi tiết cấu hình một nhà cung cấp OAuth (Admin)' })
  public async getProviderByCode(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
  ): Promise<FederatedProviderView> {
    return this.federatedIdentityService.getProviderByCode(params.providerCode);
  }

  @Put(FEDERATED_IDENTITY_ROUTES.PROVIDER_BY_CODE)
  @RequirePermissions('federated-identity.manage')
  @ApiDoc({ summary: 'Tạo hoặc cập nhật cấu hình nhà cung cấp OAuth (Google / Microsoft)' })
  public async upsertProvider(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @ValidatedBody(UpsertFederatedProviderRequestSchema) body: UpsertFederatedProviderRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FederatedProviderView> {
    return this.federatedIdentityService.upsertProvider(params.providerCode, body, actor);
  }

  @Delete(FEDERATED_IDENTITY_ROUTES.PROVIDER_BY_CODE)
  @RequirePermissions('federated-identity.manage')
  @ApiDoc({ summary: 'Xóa mềm cấu hình nhà cung cấp OAuth' })
  public async deleteProvider(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
    @CurrentUser() actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly providerCode: string }> {
    return this.federatedIdentityService.deleteProvider(params.providerCode, actor);
  }

  @Post(FEDERATED_IDENTITY_ROUTES.PROVIDER_TEST)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('federated-identity.manage')
  @ApiDoc({ summary: 'Kiểm tra kết nối JWKS và thông số cấu hình của nhà cung cấp OAuth' })
  public async testProvider(
    @ValidatedParams(providerCodeParamSchema) params: { providerCode: string },
  ): Promise<TestProviderConnectionResult> {
    return this.federatedIdentityService.testProviderConnection(params.providerCode);
  }

  @Get(FEDERATED_IDENTITY_ROUTES.USER_ACCOUNTS)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Danh sách liên kết tài khoản ngoài của một người dùng cụ thể (Admin)' })
  public async listUserAccounts(
    @ValidatedParams(userIdParamSchema) params: { userId: number },
  ): Promise<FederatedIdentityView[]> {
    return this.federatedIdentityService.listUserIdentities(params.userId);
  }

  @Delete(FEDERATED_IDENTITY_ROUTES.ADMIN_UNLINK_ACCOUNT)
  @RequirePermissions('federated-identity.manage')
  @ApiDoc({
    summary:
      'Quản trị viên gỡ liên kết tài khoản ngoài của người dùng (vẫn bảo vệ chống khóa phương thức cuối)',
  })
  public async adminUnlinkUserAccount(
    @ValidatedParams(userAndIdentityIdParamSchema) params: { userId: number; id: number },
    @CurrentUser() actor: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<UnlinkFederatedIdentityResult> {
    const meta = extractRequestMeta(req);
    return this.federatedIdentityService.unlinkUserIdentity(params.userId, params.id, {
      actorUserId: actor.id,
      enforceSelfStepUp: false,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  @Get(FEDERATED_IDENTITY_ROUTES.MONITORING_SUMMARY)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Thống kê tỷ lệ thành công/lỗi và độ trễ từ nhà cung cấp OAuth' })
  public async getMonitoringSummary(
    @ValidatedQuery(MonitoringSummaryQuerySchema) query: MonitoringSummaryQuery,
  ): Promise<FederatedMonitoringSummaryView> {
    return this.federatedIdentityService.getMonitoringSummary(
      query.windowHours ?? 24,
      query.providerCode,
    );
  }

  @Get(FEDERATED_IDENTITY_ROUTES.MONITORING_ERRORS)
  @RequirePermissions('federated-identity.read')
  @ApiDoc({ summary: 'Nhật ký sự kiện và lỗi xác thực từ nhà cung cấp OAuth (đã che bí mật)' })
  public async listMonitoringEvents(
    @ValidatedQuery(ListMonitoringErrorsQuerySchema) query: ListMonitoringErrorsQuery,
  ): Promise<PaginatedResult<FederatedAuthEventView>> {
    return this.federatedIdentityService.listAuthEvents(query);
  }
}
