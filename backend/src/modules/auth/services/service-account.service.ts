import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
  safeJsonParse,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  AUDIT_ACTOR_TYPE,
  AuditLogService,
  type IdentityResolutionContext,
  PasswordHasherService,
  type TokenPayload,
  TokenService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  API_CLIENT_STATUS,
  type ApiClientUsageLogItem,
  type ApiClientUsageResultType,
  type AuthApiClientEntity,
  getApiClientStatusName,
} from '../entities/auth-api-client.entity.js';
import {
  type AuthServiceAccountEntity,
  SERVICE_ACCOUNT_STATUS,
  getServiceAccountStatusName,
  parseServiceAccountStatus,
} from '../entities/auth-service-account.entity.js';
import { AuthApiClientRepository } from '../repositories/auth-api-client.repository.js';
import { AuthServiceAccountRepository } from '../repositories/auth-service-account.repository.js';
import type {
  CreateApiClientRequest,
  CreateServiceAccountRequest,
  IssueApiClientTokenRequest,
  RevokeApiClientRequest,
  RotateApiClientSecretRequest,
  UpdateApiClientAllowedIpsRequest,
  UpdateApiClientScopesRequest,
  UpdateServiceAccountRequest,
} from '../requests/auth.requests.js';
import type {
  ApiClientCreatedWithSecretResponse,
  ApiClientResponse,
  ApiClientRevokeResponse,
  ApiClientRotateSecretResponse,
  ApiClientTokenResponse,
  ApiClientUsageLogResponse,
  ServiceAccountResponse,
} from '../responses/auth.response.js';

const DEFAULT_CLIENT_TOKEN_TTL_SECONDS = 3600; // 1 giờ
const MAX_USAGE_LOG_ENTRIES = 50;

/**
 * Dịch vụ quản lý Tài khoản hệ thống (Service Account) và API Client (Mục 3.6):
 * - 3.6.1: Tạo Service Account dùng cho hệ thống hoặc job, không gắn người dùng cá nhân (`userId = null`)
 * - 3.6.2: Tạo API Client có Client ID và Client Secret
 * - 3.6.3: Gán phạm vi truy cập (`scopes`) cho API Client, chỉ cho phép đúng API cần dùng
 * - 3.6.4: Tạo và xoay vòng Client Secret (Secret chỉ hiển thị một lần duy nhất)
 * - 3.6.5: Thu hồi API Client (ngừng toàn bộ token đã cấp ngay lập tức qua `tokenVersion` & `status = REVOKED`)
 * - 3.6.6: Giới hạn IP được phép gọi (IP Whitelist / CIDR / Wildcard cho tích hợp nhạy cảm)
 * - 3.6.7: Theo dõi lần sử dụng gần nhất (ghi IP, thời gian và kết quả)
 */
@Injectable()
export class ServiceAccountService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly serviceAccountRepo: AuthServiceAccountRepository,
    private readonly apiClientRepo: AuthApiClientRepository,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  private getDefaultClientTokenTtlSeconds(): number {
    return Math.max(
      60,
      this.settingRegistry.getNumber(
        'security.api_client.default_token_ttl_seconds',
        undefined,
        DEFAULT_CLIENT_TOKEN_TTL_SECONDS,
      ),
    );
  }

  private getMaxUsageLogEntries(): number {
    return Math.max(
      5,
      this.settingRegistry.getNumber(
        'security.api_client.max_usage_logs',
        undefined,
        MAX_USAGE_LOG_ENTRIES,
      ),
    );
  }

  // ============================================================================
  // 3.6.1: QUẢN LÝ TÀI KHOẢN HỆ THỐNG (SERVICE ACCOUNT)
  // ============================================================================

  /** Tạo mới Service Account (dùng cho hệ thống hoặc job, không gắn người dùng cá nhân — Mục 3.6.1) */
  public async createServiceAccount(
    dto: CreateServiceAccountRequest,
    actorId?: number,
  ): Promise<ServiceAccountResponse> {
    const normalizedCode = dto.code.trim().toUpperCase();
    const existing = await this.findServiceAccountByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'auth.duplicateServiceAccountCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const scopes = this.normalizeScopes(dto.scopes ?? []);
    const status =
      dto.status !== undefined
        ? parseServiceAccountStatus(dto.status)
        : SERVICE_ACCOUNT_STATUS.ACTIVE;

    const saved = await this.saveServiceAccount({
      code: normalizedCode,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      status,
      scopesJson: JSON.stringify(scopes),
      createdBy: actorId ?? null,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedResult: null,
    });

    const response = this.toServiceAccountResponse(saved);
    await this.auditLogService?.record({
      actorUserId: actorId ?? null,
      module: 'auth',
      feature: 'service-account',
      action: 'service_account.create',
      resourceType: 'service_account',
      resourceId: response.id,
      beforeData: null,
      afterData: {
        id: response.id,
        code: response.code,
        name: response.name,
        status: response.status,
        scopes: response.scopes,
      },
      reason: 'Created system service account',
    });
    return response;
  }

  /** Danh sách toàn bộ Service Accounts */
  public async listServiceAccounts(): Promise<ServiceAccountResponse[]> {
    const list = await this.findAllServiceAccounts();
    return list.map((sa) => this.toServiceAccountResponse(sa));
  }

  /** Xem chi tiết một Service Account theo ID */
  public async getServiceAccountById(id: number): Promise<ServiceAccountResponse> {
    const found = await this.findServiceAccountByIdInternal(id);
    if (!found) {
      throw new NotFoundAppException('auth.serviceAccountNotFound', { id });
    }
    return this.toServiceAccountResponse(found);
  }

  /** Cập nhật thông tin, trạng thái hoặc phạm vi quyền của Service Account */
  public async updateServiceAccount(
    id: number,
    dto: UpdateServiceAccountRequest,
  ): Promise<ServiceAccountResponse> {
    const existing = await this.findServiceAccountByIdInternal(id);
    if (!existing) {
      throw new NotFoundAppException('auth.serviceAccountNotFound', { id });
    }
    const beforeSnapshot = {
      id: existing.id,
      code: existing.code,
      name: existing.name,
      status: existing.status,
      scopes: this.parseStringArray(existing.scopesJson),
    };

    if (dto.name !== undefined) {
      existing.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      existing.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.scopes !== undefined) {
      existing.scopesJson = JSON.stringify(this.normalizeScopes(dto.scopes));
    }
    if (dto.status !== undefined) {
      existing.status = parseServiceAccountStatus(dto.status);
    }

    const saved = await this.saveServiceAccount(existing);
    const response = this.toServiceAccountResponse(saved);
    await this.auditLogService?.record({
      module: 'auth',
      feature: 'service-account',
      action: 'service_account.update',
      resourceType: 'service_account',
      resourceId: id,
      beforeData: beforeSnapshot,
      afterData: {
        id: response.id,
        code: response.code,
        name: response.name,
        status: response.status,
        scopes: response.scopes,
      },
      reason: 'Updated service account configuration',
    });
    return response;
  }

  // ============================================================================
  // 3.6.2 -> 3.6.6: QUẢN LÝ API CLIENT, SCOPES, SECRET ROTATION, REVOKE & IP WHITELIST
  // ============================================================================

  /**
   * Tạo API Client gắn với Service Account (Mục 3.6.2, 3.6.3, 3.6.4, 3.6.6)
   * - Sinh `clientId` và `clientSecret` ngẫu nhiên an toàn mật mã học
   * - `clientSecret` ở dạng rõ (plain text) CHỈ TRẢ VỀ MỘT LẦN DUY NHẤT trong phản hồi này
   */
  public async createApiClient(
    dto: CreateApiClientRequest,
    actorId?: number,
  ): Promise<ApiClientCreatedWithSecretResponse> {
    const serviceAccount = await this.findServiceAccountByIdInternal(dto.serviceAccountId);
    if (!serviceAccount) {
      throw new NotFoundAppException('auth.serviceAccountNotFound', {
        id: dto.serviceAccountId,
      });
    }

    if (Number(serviceAccount.status) !== SERVICE_ACCOUNT_STATUS.ACTIVE) {
      throw new ForbiddenAppException('auth.serviceAccountInactive', [
        {
          serviceAccountId: serviceAccount.id,
          status: getServiceAccountStatusName(serviceAccount.status),
        },
      ]);
    }

    const clientScopes = this.normalizeScopes(dto.scopes);
    const saScopes = this.parseStringArray(serviceAccount.scopesJson);
    this.ensureScopesWithinAllowed(clientScopes, saScopes);

    const allowedIps = this.normalizeIpList(dto.allowedIps ?? []);
    const clientId = `cli_${this.passwordHasher.generateRandomToken(12)}`;
    const plainClientSecret = `cs_${this.passwordHasher.generateRandomToken(24)}`;
    const clientSecretHash = this.passwordHasher.sha256(plainClientSecret);
    const secretPrefix = `${plainClientSecret.slice(0, 10)}...`;

    const saved = await this.saveApiClient({
      serviceAccountId: Number(serviceAccount.id),
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      clientId,
      clientSecretHash,
      secretPrefix,
      scopesJson: JSON.stringify(clientScopes),
      allowedIpsJson: JSON.stringify(allowedIps),
      status: API_CLIENT_STATUS.ACTIVE,
      tokenVersion: 1,
      secretRotatedAt: null,
      revokedAt: null,
      revokedReason: null,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedResult: null,
      lastUsedEndpoint: null,
      usageLogsJson: '[]',
      createdBy: actorId ?? null,
    });

    const baseResponse = this.toApiClientResponse(saved, serviceAccount);
    await this.auditLogService?.record({
      actorUserId: actorId ?? null,
      module: 'auth',
      feature: 'api-client',
      action: 'api_client.create',
      resourceType: 'api_client',
      resourceId: baseResponse.id,
      beforeData: null,
      afterData: {
        id: baseResponse.id,
        clientId: baseResponse.clientId,
        serviceAccountId: baseResponse.serviceAccountId,
        scopes: baseResponse.scopes,
        allowedIps: baseResponse.allowedIps,
      },
      reason: `Created API Client for service account ${serviceAccount.code}`,
    });
    return {
      ...baseResponse,
      clientSecret: plainClientSecret,
      oneTimeSecretWarning: true,
    };
  }

  /** Danh sách các API Clients (KHÔNG BAO GIỜ trả về plain `clientSecret` — Mục 3.6.4) */
  public async listApiClients(serviceAccountId?: number): Promise<ApiClientResponse[]> {
    const [clients, serviceAccounts] = await Promise.all([
      this.findAllApiClients(serviceAccountId),
      this.findAllServiceAccounts(),
    ]);
    const saMap = new Map(serviceAccounts.map((sa) => [Number(sa.id), sa]));
    return clients.map((c) => this.toApiClientResponse(c, saMap.get(Number(c.serviceAccountId))));
  }

  /** Xem chi tiết một API Client theo ID (KHÔNG BAO GIỜ trả về plain `clientSecret` — Mục 3.6.4) */
  public async getApiClientById(id: number): Promise<ApiClientResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    const sa = await this.findServiceAccountByIdInternal(client.serviceAccountId);
    return this.toApiClientResponse(client, sa ?? undefined);
  }

  /** Gán / cập nhật phạm vi truy cập (Scopes) cho API Client (Mục 3.6.3) */
  public async updateApiClientScopes(
    id: number,
    dto: UpdateApiClientScopesRequest,
  ): Promise<ApiClientResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    const prevScopes = this.parseStringArray(client.scopesJson);

    const sa = await this.findServiceAccountByIdInternal(client.serviceAccountId);
    const nextScopes = this.normalizeScopes(dto.scopes);
    if (sa) {
      const saScopes = this.parseStringArray(sa.scopesJson);
      this.ensureScopesWithinAllowed(nextScopes, saScopes);
    }

    client.scopesJson = JSON.stringify(nextScopes);
    const saved = await this.saveApiClient(client);
    const response = this.toApiClientResponse(saved, sa ?? undefined);
    await this.auditLogService?.record({
      module: 'auth',
      feature: 'api-client',
      action: 'api_client.update_scopes',
      resourceType: 'api_client',
      resourceId: id,
      beforeData: { scopes: prevScopes },
      afterData: { scopes: response.scopes },
      reason: 'Updated API Client scopes',
    });
    return response;
  }

  /** Cập nhật danh sách giới hạn IP được phép gọi cho API Client (Mục 3.6.6) */
  public async updateApiClientAllowedIps(
    id: number,
    dto: UpdateApiClientAllowedIpsRequest,
  ): Promise<ApiClientResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    const prevIps = this.parseStringArray(client.allowedIpsJson);

    const allowedIps = this.normalizeIpList(dto.allowedIps);
    client.allowedIpsJson = JSON.stringify(allowedIps);
    const saved = await this.saveApiClient(client);
    const sa = await this.findServiceAccountByIdInternal(client.serviceAccountId);
    const response = this.toApiClientResponse(saved, sa ?? undefined);
    await this.auditLogService?.record({
      module: 'auth',
      feature: 'api-client',
      action: 'api_client.update_allowed_ips',
      resourceType: 'api_client',
      resourceId: id,
      beforeData: { allowedIps: prevIps },
      afterData: { allowedIps: response.allowedIps },
      reason: 'Updated API Client IP whitelist',
    });
    return response;
  }

  /**
   * Tạo và xoay vòng Client Secret (Mục 3.6.4):
   * - Sinh `clientSecret` mới, chỉ hiển thị một lần duy nhất
   * - Tự động tăng `tokenVersion` (mặc định `revokeExistingTokens = true`) để ngừng các token cũ
   */
  public async rotateClientSecret(
    id: number,
    dto: RotateApiClientSecretRequest = { revokeExistingTokens: true },
  ): Promise<ApiClientRotateSecretResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    if (Number(client.status) === API_CLIENT_STATUS.REVOKED) {
      throw new ForbiddenAppException('auth.apiClientRevoked', [{ clientId: client.clientId }]);
    }

    const prevTokenVersion = client.tokenVersion ?? 1;
    const plainClientSecret = `cs_${this.passwordHasher.generateRandomToken(24)}`;
    const clientSecretHash = this.passwordHasher.sha256(plainClientSecret);
    const secretPrefix = `${plainClientSecret.slice(0, 10)}...`;
    const now = new Date();

    client.clientSecretHash = clientSecretHash;
    client.secretPrefix = secretPrefix;
    client.secretRotatedAt = now;
    if (dto.revokeExistingTokens !== false) {
      client.tokenVersion = (client.tokenVersion ?? 1) + 1;
    }

    const saved = await this.saveApiClient(client);
    await this.auditLogService?.record({
      module: 'auth',
      feature: 'api-client',
      action: 'api_client.rotate_secret',
      resourceType: 'api_client',
      resourceId: id,
      beforeData: { tokenVersion: prevTokenVersion },
      afterData: {
        tokenVersion: saved.tokenVersion,
        secretRotatedAt: now.toISOString(),
      },
      reason: 'Rotated API Client secret',
    });
    return {
      rotated: true,
      id: Number(saved.id),
      clientId: saved.clientId,
      clientSecret: plainClientSecret,
      secretPrefix: saved.secretPrefix,
      tokenVersion: saved.tokenVersion,
      secretRotatedAt: now.toISOString(),
      oneTimeSecretWarning: true,
    };
  }

  /**
   * Thu hồi API Client — Ngừng toàn bộ token đã cấp ngay lập tức (Mục 3.6.5)
   */
  public async revokeApiClient(
    id: number,
    dto: RevokeApiClientRequest = {},
  ): Promise<ApiClientRevokeResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    const prevStatus = client.status;

    const now = new Date();
    client.status = API_CLIENT_STATUS.REVOKED;
    client.revokedAt = now;
    client.revokedReason = dto.reason?.trim() || 'Revoked by administrator';
    client.tokenVersion = (client.tokenVersion ?? 1) + 1;

    const saved = await this.saveApiClient(client);
    await this.auditLogService?.record({
      module: 'auth',
      feature: 'api-client',
      action: 'api_client.revoke',
      resourceType: 'api_client',
      resourceId: id,
      beforeData: { status: prevStatus },
      afterData: {
        status: saved.status,
        tokenVersion: saved.tokenVersion,
        revokedAt: now.toISOString(),
      },
      reason: saved.revokedReason ?? 'Revoked by administrator',
    });
    return {
      revoked: true,
      id: Number(saved.id),
      clientId: saved.clientId,
      status: saved.status,
      statusName: 'REVOKED',
      tokenVersion: saved.tokenVersion,
      revokedAt: now.toISOString(),
      revokedReason: saved.revokedReason ?? null,
    };
  }

  // ============================================================================
  // 3.6.2, 3.6.3, 3.6.5, 3.6.6, 3.6.7: CẤP TOKEN & XÁC THỰC API CLIENT
  // ============================================================================

  /**
   * Xác thực `clientId` + `clientSecret` và cấp Access Token cho API Client (OAuth2 Client Credentials):
   * - Kiểm tra trạng thái API Client (`REVOKED` -> chặn)
   * - Kiểm tra trạng thái Service Account (`ACTIVE`)
   * - Kiểm tra giới hạn IP (`allowedIps` — Mục 3.6.6)
   * - Kiểm tra `clientSecret`
   * - Kiểm tra phạm vi `scopes` yêu cầu (Mục 3.6.3)
   * - Ghi nhận lần sử dụng gần nhất: IP, thời gian và kết quả (Mục 3.6.7)
   */
  public async issueClientToken(
    dto: IssueApiClientTokenRequest,
    meta: { ipAddress?: string | null; endpoint?: string | null } = {},
  ): Promise<ApiClientTokenResponse> {
    const ipAddress = this.normalizeCallerIp(meta.ipAddress);
    const endpoint = meta.endpoint ?? '/api/v1/auth/api-clients/token';
    const client = await this.findApiClientByClientIdInternal(dto.clientId.trim());

    if (!client) {
      throw new UnauthorizedAppException('auth.invalidApiClientCredentials');
    }

    const serviceAccount = await this.findServiceAccountByIdInternal(client.serviceAccountId);
    const { activeAccount, grantedScopes } = await this.verifyClientTokenEligibility({
      client,
      serviceAccount,
      dto,
      ipAddress,
      endpoint,
    });

    const ttlSeconds = dto.expiresInSeconds ?? this.getDefaultClientTokenTtlSeconds();
    const accessToken = await this.tokenService.signAccessToken(
      {
        sub: `sa:${activeAccount.id}`,
        username: activeAccount.code,
        roles: ['service_account'],
        permissions: grantedScopes,
        clientType: 'api_client',
        saId: Number(activeAccount.id),
        apiClientId: Number(client.id),
        cid: client.clientId,
        tv: Number(client.tokenVersion ?? 1),
      },
      ttlSeconds,
    );

    await this.recordClientUsage(client, activeAccount, {
      ipAddress,
      action: 'ISSUE_TOKEN',
      endpoint,
      status: 'SUCCESS',
      result: 'SUCCESS',
      reason: `Issued token with scopes [${grantedScopes.join(', ')}]`,
    });

    await this.auditLogService?.record({
      actorType: AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT,
      actorServiceAccountId: Number(activeAccount.id),
      actorApiClientId: Number(client.id),
      actorIdentifier: `${activeAccount.code}:${client.clientId}`,
      module: 'auth',
      feature: 'api-client-token',
      action: 'api_client.issue_token',
      resourceType: 'api_client',
      resourceId: client.id,
      beforeData: null,
      afterData: {
        clientId: client.clientId,
        serviceAccountId: Number(activeAccount.id),
        serviceAccountCode: activeAccount.code,
        scopes: grantedScopes,
      },
      reason: `Issued M2M access token for ${activeAccount.code}`,
      ipAddress,
    });

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresInSeconds: ttlSeconds,
      clientId: client.clientId,
      serviceAccountId: Number(activeAccount.id),
      serviceAccountCode: activeAccount.code,
      scopes: grantedScopes,
    };
  }

  private async verifyClientTokenEligibility(params: {
    client: AuthApiClientEntity;
    serviceAccount: AuthServiceAccountEntity | null;
    dto: IssueApiClientTokenRequest;
    ipAddress: string | null;
    endpoint: string;
  }): Promise<{ activeAccount: AuthServiceAccountEntity; grantedScopes: string[] }> {
    const { client, serviceAccount, dto, ipAddress, endpoint } = params;

    if (Number(client.status) === API_CLIENT_STATUS.REVOKED || client.revokedAt) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'ISSUE_TOKEN',
        endpoint,
        status: 'FAILED',
        result: 'CLIENT_REVOKED',
        reason: 'API Client has been revoked',
      });
      throw new ForbiddenAppException('auth.apiClientRevoked', [{ clientId: client.clientId }]);
    }

    if (!serviceAccount || Number(serviceAccount.status) !== SERVICE_ACCOUNT_STATUS.ACTIVE) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'ISSUE_TOKEN',
        endpoint,
        status: 'FAILED',
        result: 'SERVICE_ACCOUNT_INACTIVE',
        reason: 'Service Account is inactive or revoked',
      });
      throw new ForbiddenAppException('auth.serviceAccountInactive', [
        { clientId: client.clientId },
      ]);
    }

    const allowedIps = this.parseStringArray(client.allowedIpsJson);
    if (allowedIps.length > 0 && !this.isIpAllowed(ipAddress, allowedIps)) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'ISSUE_TOKEN',
        endpoint,
        status: 'FAILED',
        result: 'DENIED_IP',
        reason: `Caller IP ${ipAddress ?? 'unknown'} is not in allowedIps`,
      });
      throw new ForbiddenAppException('auth.apiClientIpNotAllowed', [
        { ipAddress: ipAddress ?? 'unknown', clientId: client.clientId },
      ]);
    }

    const candidateHash = this.passwordHasher.sha256(dto.clientSecret);
    if (!this.passwordHasher.safeEqualHex(candidateHash, client.clientSecretHash)) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'ISSUE_TOKEN',
        endpoint,
        status: 'FAILED',
        result: 'INVALID_SECRET',
        reason: 'Invalid client secret',
      });
      throw new UnauthorizedAppException('auth.invalidApiClientCredentials');
    }

    const allowedClientScopes = this.parseStringArray(client.scopesJson);
    let grantedScopes = allowedClientScopes;
    if (dto.scopes && dto.scopes.length > 0) {
      const requestedScopes = this.normalizeScopes(dto.scopes);
      const invalidScopes = requestedScopes.filter(
        (s) => !allowedClientScopes.includes('*') && !allowedClientScopes.includes(s),
      );
      if (invalidScopes.length > 0) {
        await this.recordClientUsage(client, serviceAccount, {
          ipAddress,
          action: 'ISSUE_TOKEN',
          endpoint,
          status: 'FAILED',
          result: 'FORBIDDEN_SCOPE',
          reason: `Requested unauthorized scopes: ${invalidScopes.join(', ')}`,
        });
        throw new ForbiddenAppException('auth.apiClientScopeExceeded', [
          { requestedScopes, invalidScopes, allowedScopes: allowedClientScopes },
        ]);
      }
      grantedScopes = requestedScopes;
    }

    return { activeAccount: serviceAccount, grantedScopes };
  }

  /**
   * Giải mã và kiểm tra hiệu lực trực tiếp của Access Token cấp cho API Client khi gọi vào bất kỳ endpoint nào:
   * - Kiểm tra API Client chưa bị thu hồi (`status === ACTIVE`)
   * - Kiểm tra `tokenVersion` khớp (`payload.tv === client.tokenVersion`) -> thu hồi hoặc rotate secret sẽ chặn ngay lập tức (Mục 3.6.4 & 3.6.5)
   * - Kiểm tra IP người gọi với `allowedIps` (Mục 3.6.6)
   * - Cập nhật `lastUsedAt`, `lastUsedIp`, `lastUsedResult` (Mục 3.6.7)
   */
  public async resolveApiClientTokenIdentity(
    payload: TokenPayload,
    context?: IdentityResolutionContext,
  ): Promise<UserIdentity | null> {
    const apiClientId = Number(payload.apiClientId);
    const clientIdStr = typeof payload.cid === 'string' ? payload.cid : '';
    const client =
      Number.isFinite(apiClientId) && apiClientId > 0
        ? await this.findApiClientByIdInternal(apiClientId)
        : clientIdStr
          ? await this.findApiClientByClientIdInternal(clientIdStr)
          : null;

    if (!client) {
      return null;
    }

    const serviceAccount = await this.findServiceAccountByIdInternal(client.serviceAccountId);
    const ipAddress = this.normalizeCallerIp(context?.ipAddress);
    const endpoint = context?.endpoint
      ? `${context.method ? `${context.method} ` : ''}${context.endpoint}`
      : null;

    // 1. Kiểm tra nếu API Client đã bị thu hồi hoặc tokenVersion đã thay đổi (Mục 3.6.4 & 3.6.5)
    const tokenVersion = Number(payload.tv ?? 0);
    if (
      Number(client.status) !== API_CLIENT_STATUS.ACTIVE ||
      client.revokedAt ||
      tokenVersion !== Number(client.tokenVersion ?? 1)
    ) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'API_REQUEST',
        endpoint,
        status: 'FAILED',
        result: 'CLIENT_REVOKED',
        reason:
          tokenVersion !== Number(client.tokenVersion ?? 1)
            ? 'Token version invalidated due to secret rotation or revocation'
            : 'API Client is revoked',
      });
      return null;
    }

    // 2. Kiểm tra Service Account còn hoạt động (Mục 3.6.1)
    if (!serviceAccount || Number(serviceAccount.status) !== SERVICE_ACCOUNT_STATUS.ACTIVE) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'API_REQUEST',
        endpoint,
        status: 'FAILED',
        result: 'SERVICE_ACCOUNT_INACTIVE',
        reason: 'Service Account is inactive or revoked',
      });
      return null;
    }

    // 3. Kiểm tra giới hạn IP (IP Whitelist — Mục 3.6.6)
    const allowedIps = this.parseStringArray(client.allowedIpsJson);
    if (allowedIps.length > 0 && !this.isIpAllowed(ipAddress, allowedIps)) {
      await this.recordClientUsage(client, serviceAccount, {
        ipAddress,
        action: 'API_REQUEST',
        endpoint,
        status: 'FAILED',
        result: 'DENIED_IP',
        reason: `Caller IP ${ipAddress ?? 'unknown'} is not in allowedIps`,
      });
      throw new ForbiddenAppException('auth.apiClientIpNotAllowed', [
        { ipAddress: ipAddress ?? 'unknown', clientId: client.clientId },
      ]);
    }

    // 4. Giao thoa giữa scopes trong token và scopes hiện hành của API Client
    const currentClientScopes = this.parseStringArray(client.scopesJson);
    const tokenScopes = Array.isArray(payload.permissions)
      ? payload.permissions
      : currentClientScopes;
    const effectiveScopes = tokenScopes.filter(
      (s) => currentClientScopes.includes('*') || currentClientScopes.includes(s),
    );

    // 5. Ghi nhận lần sử dụng gần nhất (Mục 3.6.7)
    await this.recordClientUsage(client, serviceAccount, {
      ipAddress,
      action: 'API_REQUEST',
      endpoint,
      status: 'SUCCESS',
      result: 'SUCCESS',
      reason: endpoint ? `Authorized ${endpoint}` : 'Authorized API request',
    });

    return {
      // Service Account không gắn với người dùng cá nhân (id = 0 để phân biệt với user id >= 1)
      id: 0,
      username: serviceAccount.code,
      subjectType: 'SERVICE_ACCOUNT',
      serviceAccountId: Number(serviceAccount.id),
      apiClientId: Number(client.id),
      clientId: client.clientId,
      roles: ['service_account'],
      permissions: effectiveScopes,
    };
  }

  /** Xem thông tin lần sử dụng gần nhất và lịch sử gọi API của API Client (Mục 3.6.7) */
  public async getApiClientUsage(id: number): Promise<ApiClientUsageLogResponse> {
    const client = await this.findApiClientByIdInternal(id);
    if (!client) {
      throw new NotFoundAppException('auth.apiClientNotFound', { id });
    }
    const logs = this.parseUsageLogs(client.usageLogsJson);
    return {
      id: Number(client.id),
      clientId: client.clientId,
      serviceAccountId: Number(client.serviceAccountId),
      lastUsedAt: client.lastUsedAt ? client.lastUsedAt.toISOString() : null,
      lastUsedIp: client.lastUsedIp ?? null,
      lastUsedResult: client.lastUsedResult ?? null,
      lastUsedEndpoint: client.lastUsedEndpoint ?? null,
      logs,
    };
  }

  // ============================================================================
  // PRIVATE HELPERS (IP WHITELIST, SCOPES, USAGE TRACKING & PERSISTENCE)
  // ============================================================================

  /** Kiểm tra IP người gọi có khớp với danh sách `allowedIps` (hỗ trợ exact IP, wildcard `*` và CIDR `/8..32`) */
  public isIpAllowed(callerIp: string | null, allowedIps: readonly string[]): boolean {
    if (allowedIps.length === 0) return true;
    if (!callerIp) return false;

    const normalizedCaller = this.normalizeCallerIp(callerIp);
    if (!normalizedCaller) return false;

    for (const rawRule of allowedIps) {
      const rule = this.normalizeCallerIp(rawRule) ?? rawRule.trim();
      if (!rule) continue;
      if (rule === '*' || rule === '0.0.0.0/0') return true;
      if (rule === normalizedCaller) return true;

      // Hỗ trợ wildcard dạng '10.10.1.*'
      if (rule.includes('*')) {
        const regexPattern: string =
          '^' +
          rule
            .split('*')
            .map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$';
        if (new RegExp(regexPattern).test(normalizedCaller)) {
          return true;
        }
      }

      // Hỗ trợ IPv4 CIDR dạng '10.10.1.0/24'
      if (rule.includes('/')) {
        if (this.matchIpv4Cidr(normalizedCaller, rule)) {
          return true;
        }
      }
    }

    return false;
  }

  private matchIpv4Cidr(ip: string, cidr: string): boolean {
    const [rangeIp, prefixStr] = cidr.split('/');
    if (!rangeIp || !prefixStr) return false;
    const prefix = Number.parseInt(prefixStr, 10);
    if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;

    const ipInt = this.ipv4ToUint32(ip);
    const rangeInt = this.ipv4ToUint32(rangeIp.trim());
    if (ipInt === null || rangeInt === null) return false;

    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0;
    return (ipInt & mask) >>> 0 === (rangeInt & mask) >>> 0;
  }

  private ipv4ToUint32(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null;
      const octet = Number.parseInt(part, 10);
      if (octet < 0 || octet > 255) return null;
      value = ((value << 8) | octet) >>> 0;
    }
    return value >>> 0;
  }

  private normalizeCallerIp(ip?: string | null): string | null {
    if (!ip || !ip.trim()) return null;
    const trimmed = ip.trim();
    if (trimmed.startsWith('::ffff:')) {
      return trimmed.slice(7);
    }
    return trimmed;
  }

  private async recordClientUsage(
    client: AuthApiClientEntity,
    serviceAccount: AuthServiceAccountEntity | null,
    entry: {
      ipAddress: string | null;
      action: 'ISSUE_TOKEN' | 'API_REQUEST';
      endpoint: string | null;
      status: 'SUCCESS' | 'FAILED';
      result: ApiClientUsageResultType;
      reason?: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    const logItem: ApiClientUsageLogItem = {
      timestamp: now.toISOString(),
      ipAddress: entry.ipAddress,
      action: entry.action,
      endpoint: entry.endpoint,
      status: entry.status,
      result: entry.result,
      reason: entry.reason ?? null,
    };

    const existingLogs = this.parseUsageLogs(client.usageLogsJson);
    const nextLogs = [logItem, ...existingLogs].slice(0, this.getMaxUsageLogEntries());

    client.lastUsedAt = now;
    client.lastUsedIp = entry.ipAddress;
    client.lastUsedResult = entry.result;
    client.lastUsedEndpoint = entry.endpoint;
    client.usageLogsJson = JSON.stringify(nextLogs);
    await this.saveApiClient(client);

    if (serviceAccount) {
      serviceAccount.lastUsedAt = now;
      serviceAccount.lastUsedIp = entry.ipAddress;
      serviceAccount.lastUsedResult = entry.result;
      await this.saveServiceAccount(serviceAccount);
    }
  }

  private ensureScopesWithinAllowed(
    requestedScopes: readonly string[],
    allowedSaScopes: readonly string[],
  ): void {
    if (allowedSaScopes.length === 0 || allowedSaScopes.includes('*')) {
      return;
    }
    const exceeded = requestedScopes.filter((s) => !allowedSaScopes.includes(s));
    if (exceeded.length > 0) {
      throw new ForbiddenAppException('auth.apiClientScopeExceeded', [
        { requestedScopes, exceededScopes: exceeded, serviceAccountScopes: allowedSaScopes },
      ]);
    }
  }

  private normalizeScopes(scopes: readonly string[]): string[] {
    return [...new Set(scopes.map((s) => s.trim()).filter(Boolean))];
  }

  private normalizeIpList(ips: readonly string[]): string[] {
    return [
      ...new Set(
        ips
          .map((ip) => this.normalizeCallerIp(ip) ?? ip.trim())
          .filter((ip): ip is string => Boolean(ip && ip.length > 0)),
      ),
    ];
  }

  private parseStringArray(jsonStr?: string | null): string[] {
    return safeJsonParseStringArray(jsonStr);
  }

  private parseUsageLogs(jsonStr?: string | null): ApiClientUsageLogItem[] {
    const parsed = safeJsonParse<unknown>(jsonStr, null);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ApiClientUsageLogItem =>
      Boolean(item && typeof item === 'object' && 'timestamp' in item && 'result' in item),
    );
  }

  private toServiceAccountResponse(entity: AuthServiceAccountEntity): ServiceAccountResponse {
    const status = parseServiceAccountStatus(entity.status);
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      description: entity.description ?? null,
      status,
      statusName: getServiceAccountStatusName(status),
      isServiceAccount: true,
      userId: null,
      scopes: this.parseStringArray(entity.scopesJson),
      createdBy: entity.createdBy ?? null,
      lastUsedAt: entity.lastUsedAt ? entity.lastUsedAt.toISOString() : null,
      lastUsedIp: entity.lastUsedIp ?? null,
      lastUsedResult: entity.lastUsedResult ?? null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
      updatedAt: (entity.updatedAt ?? new Date()).toISOString(),
    };
  }

  private toApiClientResponse(
    entity: AuthApiClientEntity,
    serviceAccount?: AuthServiceAccountEntity,
  ): ApiClientResponse {
    const status =
      Number(entity.status) === API_CLIENT_STATUS.REVOKED
        ? API_CLIENT_STATUS.REVOKED
        : API_CLIENT_STATUS.ACTIVE;
    return {
      id: Number(entity.id),
      serviceAccountId: Number(entity.serviceAccountId),
      ...(serviceAccount
        ? {
            serviceAccountCode: serviceAccount.code,
            serviceAccountName: serviceAccount.name,
          }
        : {}),
      name: entity.name,
      description: entity.description ?? null,
      clientId: entity.clientId,
      secretPrefix: entity.secretPrefix,
      scopes: this.parseStringArray(entity.scopesJson),
      allowedIps: this.parseStringArray(entity.allowedIpsJson),
      status,
      statusName: getApiClientStatusName(status),
      tokenVersion: Number(entity.tokenVersion ?? 1),
      secretRotatedAt: entity.secretRotatedAt ? entity.secretRotatedAt.toISOString() : null,
      revokedAt: entity.revokedAt ? entity.revokedAt.toISOString() : null,
      revokedReason: entity.revokedReason ?? null,
      lastUsedAt: entity.lastUsedAt ? entity.lastUsedAt.toISOString() : null,
      lastUsedIp: entity.lastUsedIp ?? null,
      lastUsedResult: entity.lastUsedResult ?? null,
      lastUsedEndpoint: entity.lastUsedEndpoint ?? null,
      createdBy: entity.createdBy ?? null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
      updatedAt: (entity.updatedAt ?? new Date()).toISOString(),
    };
  }

  private async findServiceAccountByIdInternal(
    id: number,
  ): Promise<AuthServiceAccountEntity | null> {
    if (!this.serviceAccountRepo) {
      throw new Error('AuthServiceAccountRepository is not initialized');
    }
    return await this.serviceAccountRepo.findById(Number(id));
  }

  private async findServiceAccountByCode(code: string): Promise<AuthServiceAccountEntity | null> {
    if (!this.serviceAccountRepo) {
      throw new Error('AuthServiceAccountRepository is not initialized');
    }
    return await this.serviceAccountRepo.findByCode(code.trim().toUpperCase());
  }

  private async findAllServiceAccounts(): Promise<AuthServiceAccountEntity[]> {
    if (!this.serviceAccountRepo) {
      throw new Error('AuthServiceAccountRepository is not initialized');
    }
    return await this.serviceAccountRepo.findAllOrdered();
  }

  private async saveServiceAccount(
    data: Partial<AuthServiceAccountEntity>,
  ): Promise<AuthServiceAccountEntity> {
    if (!this.serviceAccountRepo) {
      throw new Error('AuthServiceAccountRepository is not initialized');
    }
    return await this.serviceAccountRepo.saveEntity(data);
  }

  private async findApiClientByIdInternal(id: number): Promise<AuthApiClientEntity | null> {
    if (!this.apiClientRepo) {
      throw new Error('AuthApiClientRepository is not initialized');
    }
    return await this.apiClientRepo.findById(Number(id));
  }

  private async findApiClientByClientIdInternal(
    clientId: string,
  ): Promise<AuthApiClientEntity | null> {
    if (!this.apiClientRepo) {
      throw new Error('AuthApiClientRepository is not initialized');
    }
    return await this.apiClientRepo.findByClientId(clientId.trim());
  }

  private async findAllApiClients(serviceAccountId?: number): Promise<AuthApiClientEntity[]> {
    if (!this.apiClientRepo) {
      throw new Error('AuthApiClientRepository is not initialized');
    }
    return serviceAccountId !== undefined
      ? await this.apiClientRepo.findByServiceAccountId(serviceAccountId)
      : await this.apiClientRepo.findAllOrdered();
  }

  private async saveApiClient(data: Partial<AuthApiClientEntity>): Promise<AuthApiClientEntity> {
    if (!this.apiClientRepo) {
      throw new Error('AuthApiClientRepository is not initialized');
    }
    return await this.apiClientRepo.saveEntity(data);
  }
}
