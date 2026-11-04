import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  Public,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, RequirePermissions, type UserIdentity } from '@packages/security/index.js';
import { MACHINE_IDENTITIES_ROUTES } from '../routes/machine-identities.routes.js';
import { ServiceAccountService } from '../services/service-account.service.js';
import {
  type CreateApiClientRequest,
  type CreateServiceAccountRequest,
  type IssueApiClientTokenRequest,
  type ListApiClientsQuery,
  type RevokeApiClientRequest,
  type RotateApiClientSecretRequest,
  type UpdateApiClientAllowedIpsRequest,
  type UpdateApiClientScopesRequest,
  type UpdateServiceAccountRequest,
  createApiClientSchema,
  createServiceAccountSchema,
  issueApiClientTokenSchema,
  listApiClientsQuerySchema,
  revokeApiClientSchema,
  rotateApiClientSecretSchema,
  updateApiClientAllowedIpsSchema,
  updateApiClientScopesSchema,
  updateServiceAccountSchema,
} from '../requests/machine-identities.requests.js';
import {
  type ApiClientCreatedWithSecretResponse,
  type ApiClientResponse,
  type ApiClientRevokeResponse,
  type ApiClientRotateSecretResponse,
  type ApiClientTokenResponse,
  type ApiClientUsageLogResponse,
  type ServiceAccountResponse,
  apiClientCreatedWithSecretResponseSchema,
  apiClientResponseSchema,
  apiClientRevokeResponseSchema,
  apiClientRotateSecretResponseSchema,
  apiClientTokenResponseSchema,
  apiClientUsageLogResponseSchema,
  serviceAccountResponseSchema,
} from '../responses/machine-identities.response.js';

@ApiGroup(
  'Service Accounts & API Clients',
  'Quản lý tài khoản hệ thống (Service Accounts) và API Clients (Mục 3.6)',
)
@Controller(MACHINE_IDENTITIES_ROUTES.PREFIX)
export class MachineIdentitiesController {
  constructor(private readonly serviceAccountService: ServiceAccountService) {}

  /** Danh sách tài khoản hệ thống (Service Accounts — Mục 3.6.1) */
  @Get(MACHINE_IDENTITIES_ROUTES.SERVICE_ACCOUNTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Danh sách tài khoản hệ thống (Service Accounts — độc lập với người dùng cá nhân)',
    response: z.array(serviceAccountResponseSchema),
  })
  public async listServiceAccounts(): Promise<ServiceAccountResponse[]> {
    return this.serviceAccountService.listServiceAccounts();
  }

  /** Tạo mới tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Post(MACHINE_IDENTITIES_ROUTES.SERVICE_ACCOUNTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary:
      'Tạo tài khoản hệ thống (Service Account) dùng cho hệ thống tích hợp hoặc background job',
    response: serviceAccountResponseSchema,
  })
  public async createServiceAccount(
    @ValidatedBody(createServiceAccountSchema) body: CreateServiceAccountRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService.createServiceAccount(body, actor?.id);
  }

  /** Xem chi tiết một tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Get(MACHINE_IDENTITIES_ROUTES.SERVICE_ACCOUNT_BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết tài khoản hệ thống (Service Account) theo ID',
    response: serviceAccountResponseSchema,
  })
  public async getServiceAccountById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService.getServiceAccountById(id);
  }

  /** Cập nhật tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Patch(MACHINE_IDENTITIES_ROUTES.SERVICE_ACCOUNT_BY_ID)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Cập nhật tên, mô tả, trạng thái hoặc phạm vi quyền của Service Account',
    response: serviceAccountResponseSchema,
  })
  public async updateServiceAccount(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateServiceAccountSchema) body: UpdateServiceAccountRequest,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService.updateServiceAccount(id, body);
  }

  /** Danh sách các API Clients (Mục 3.6.2) */
  @Get(MACHINE_IDENTITIES_ROUTES.API_CLIENTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Danh sách các API Clients (không hiển thị lại Client Secret)',
    response: z.array(apiClientResponseSchema),
  })
  public async listApiClients(
    @ValidatedQuery(listApiClientsQuerySchema) query?: ListApiClientsQuery,
  ): Promise<ApiClientResponse[]> {
    return this.serviceAccountService.listApiClients(query?.serviceAccountId);
  }

  /** Tạo mới API Client có Client ID và Client Secret (Secret chỉ hiển thị 1 lần duy nhất — Mục 3.6.2, 3.6.3, 3.6.4, 3.6.6) */
  @Post(MACHINE_IDENTITIES_ROUTES.API_CLIENTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Tạo mới API Client (trả về Client Secret duy nhất một lần)',
    response: apiClientCreatedWithSecretResponseSchema,
  })
  public async createApiClient(
    @ValidatedBody(createApiClientSchema) body: CreateApiClientRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ApiClientCreatedWithSecretResponse> {
    return this.serviceAccountService.createApiClient(body, actor?.id);
  }

  /** Cấp Access Token cho API Client từ Client ID và Client Secret (Mục 3.6.2, 3.6.3, 3.6.6, 3.6.7) */
  @Public()
  @Post(MACHINE_IDENTITIES_ROUTES.API_CLIENT_TOKEN)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đổi Client ID và Client Secret lấy Access Token (có kiểm tra IP Whitelist & Scopes)',
    response: apiClientTokenResponseSchema,
  })
  public async issueApiClientToken(
    @ValidatedBody(issueApiClientTokenSchema) body: IssueApiClientTokenRequest,
    @Req() req?: FastifyRequest,
  ): Promise<ApiClientTokenResponse> {
    return this.serviceAccountService.issueClientToken(body, {
      ipAddress: req?.ip ?? null,
      endpoint: req?.url ?? null,
    });
  }

  /** Xem chi tiết một API Client theo ID (không bao giờ trả về lại Client Secret — Mục 3.6.2 & 3.6.4) */
  @Get(MACHINE_IDENTITIES_ROUTES.API_CLIENT_BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết API Client theo ID (không trả về lại Client Secret)',
    response: apiClientResponseSchema,
  })
  public async getApiClientById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService.getApiClientById(id);
  }

  /** Gán / cập nhật phạm vi truy cập (Scopes) cho API Client (Mục 3.6.3) */
  @Put(MACHINE_IDENTITIES_ROUTES.API_CLIENT_SCOPES)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Gán hoặc cập nhật phạm vi truy cập (scopes) cho API Client',
    response: apiClientResponseSchema,
  })
  public async updateApiClientScopes(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateApiClientScopesSchema) body: UpdateApiClientScopesRequest,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService.updateApiClientScopes(id, body);
  }

  /** Giới hạn danh sách IP được phép gọi cho API Client (Mục 3.6.6) */
  @Put(MACHINE_IDENTITIES_ROUTES.API_CLIENT_ALLOWED_IPS)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Cấu hình danh sách địa chỉ IP được phép gọi (IP Whitelist) cho API Client',
    response: apiClientResponseSchema,
  })
  public async updateApiClientAllowedIps(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateApiClientAllowedIpsSchema) body: UpdateApiClientAllowedIpsRequest,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService.updateApiClientAllowedIps(id, body);
  }

  /** Tạo và xoay vòng Client Secret (Secret mới chỉ hiển thị 1 lần duy nhất — Mục 3.6.4) */
  @Post(MACHINE_IDENTITIES_ROUTES.API_CLIENT_ROTATE_SECRET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary:
      'Xoay vòng Client Secret của API Client (Secret mới chỉ hiển thị 1 lần và vô hiệu hóa token cũ)',
    response: apiClientRotateSecretResponseSchema,
  })
  public async rotateApiClientSecret(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(rotateApiClientSecretSchema) body?: RotateApiClientSecretRequest,
  ): Promise<ApiClientRotateSecretResponse> {
    return this.serviceAccountService.rotateClientSecret(id, body);
  }

  /** Thu hồi API Client — Ngừng toàn bộ token đã cấp ngay lập tức (Mục 3.6.5) */
  @Post(MACHINE_IDENTITIES_ROUTES.API_CLIENT_REVOKE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Thu hồi API Client và ngừng toàn bộ token đã cấp ngay lập tức',
    response: apiClientRevokeResponseSchema,
  })
  public async revokeApiClient(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(revokeApiClientSchema) body?: RevokeApiClientRequest,
  ): Promise<ApiClientRevokeResponse> {
    return this.serviceAccountService.revokeApiClient(id, body);
  }

  /** Theo dõi lần sử dụng gần nhất và lịch sử gọi của API Client (Ghi IP, thời gian, kết quả — Mục 3.6.7) */
  @Get(MACHINE_IDENTITIES_ROUTES.API_CLIENT_USAGE)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem lần sử dụng gần nhất và lịch sử sử dụng của API Client (IP, thời gian, kết quả)',
    response: apiClientUsageLogResponseSchema,
  })
  public async getApiClientUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ApiClientUsageLogResponse> {
    return this.serviceAccountService.getApiClientUsage(id);
  }
}
