import { type CanActivate, type ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  FeatureFlagRegistryService,
  defaultFeatureFlagRegistry,
  resolveForwardedContext,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  SCIM_CLIENT_STATUS,
  SCIM_FEATURE_FLAGS,
  SCIM_SYNC_OUTCOME,
} from '../enum/identity-provisioning.enum.js';
import { ScimProtocolException } from '../helpers/scim-error.helper.js';
import {
  hashScimToken,
  isScimClientIpAllowed,
  normalizeCallerIp,
} from '../helpers/scim-security.helper.js';
import { ScimClientRepository } from '../repositories/scim-client.repository.js';
import { ScimSyncLogService } from '../services/scim-sync-log.service.js';
import type { ScimAuthenticatedRequest } from '../types/identity-provisioning.types.js';

@Injectable()
export class ScimClientAuthGuard implements CanActivate {
  private readonly featureFlagRegistry: FeatureFlagRegistryService;

  constructor(
    private readonly clientRepository: ScimClientRepository,
    private readonly syncLogService: ScimSyncLogService,
    @Optional() private readonly config?: CoreConfigService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
  ) {
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<ScimAuthenticatedRequest>();
    const forwarded = resolveForwardedContext(request, this.config?.gateway.proxy);
    const callerIp = normalizeCallerIp(forwarded.clientIp ?? request.ip ?? null);
    const requestIdHeader = request.headers['x-request-id'];
    const correlationHeader = request.headers['x-correlation-id'];
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const correlationId = Array.isArray(correlationHeader)
      ? correlationHeader[0]
      : correlationHeader;

    const recordAuthFailure = async (
      clientId: number | null,
      httpStatus: number,
      errorCode: string,
      errorMessage: string,
    ): Promise<void> => {
      await this.syncLogService.record({
        clientId,
        requestId: requestId ?? null,
        correlationId: correlationId ?? null,
        operation: 'AUTH',
        resourceType: 'ScimClient',
        httpMethod: request.method ?? 'GET',
        httpPath: request.url ?? '/scim/v2',
        httpStatus,
        outcome: SCIM_SYNC_OUTCOME.FAILED,
        errorCode,
        errorMessage,
        ipAddress: callerIp,
      });
    };

    const flagDef = this.featureFlagRegistry.getDefinition(SCIM_FEATURE_FLAGS.SCIM_V2);
    const flagEnabled = flagDef
      ? this.featureFlagRegistry.isEnabled(SCIM_FEATURE_FLAGS.SCIM_V2, {})
      : true;
    if (!flagEnabled) {
      await recordAuthFailure(
        null,
        403,
        'SCIM_FEATURE_DISABLED',
        'SCIM 2.0 provisioning is disabled by feature flag',
      );
      throw new ScimProtocolException(
        403,
        'SCIM 2.0 provisioning is disabled by feature flag',
        undefined,
        'SCIM_FEATURE_DISABLED',
      );
    }

    const rawAuth = request.headers['authorization'];
    const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await recordAuthFailure(null, 401, 'SCIM_MISSING_TOKEN', 'Missing SCIM Bearer token');
      throw new ScimProtocolException(
        401,
        'Missing or invalid SCIM Bearer token',
        undefined,
        'SCIM_MISSING_TOKEN',
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      await recordAuthFailure(null, 401, 'SCIM_EMPTY_TOKEN', 'Empty SCIM Bearer token');
      throw new ScimProtocolException(
        401,
        'Missing or invalid SCIM Bearer token',
        undefined,
        'SCIM_EMPTY_TOKEN',
      );
    }

    const tokenHash = hashScimToken(token);
    const client = await this.clientRepository.findByTokenHash(tokenHash);
    if (!client) {
      await recordAuthFailure(null, 401, 'SCIM_INVALID_TOKEN', 'Invalid SCIM Bearer token');
      throw new ScimProtocolException(
        401,
        'Invalid SCIM Bearer token',
        undefined,
        'SCIM_INVALID_TOKEN',
      );
    }

    if (Number(client.status) !== SCIM_CLIENT_STATUS.ACTIVE) {
      await recordAuthFailure(client.id, 403, 'SCIM_CLIENT_INACTIVE', 'SCIM Client is inactive');
      throw new ScimProtocolException(
        403,
        'SCIM Client is currently inactive',
        undefined,
        'SCIM_CLIENT_INACTIVE',
      );
    }

    const allowedIps = safeJsonParseStringArray(client.allowedIpsJson);
    if (!isScimClientIpAllowed(callerIp, allowedIps)) {
      await recordAuthFailure(
        client.id,
        403,
        'SCIM_IP_NOT_ALLOWED',
        `Caller IP ${callerIp ?? 'unknown'} is not in allowed IP list`,
      );
      throw new ScimProtocolException(
        403,
        `Caller IP (${callerIp ?? 'unknown'}) is not allowed for this SCIM client`,
        undefined,
        'SCIM_IP_NOT_ALLOWED',
      );
    }

    request.scimClient = client;
    void this.clientRepository.updateLastUsed(client.id, callerIp).catch(() => undefined);
    return true;
  }
}
