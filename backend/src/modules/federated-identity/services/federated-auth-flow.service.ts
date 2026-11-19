import { Inject, Injectable, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { maskIp } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultProviderRegistry,
  defaultSettingRegistry,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  defaultFieldEncryptionService,
} from '@packages/security/index.js';
import {
  AUTH_PUBLIC_SERVICE,
  type IAuthPublicService,
  type LoginResponse,
} from '@modules/auth/contracts/index.js';
import {
  CREDENTIALS_PUBLIC_SERVICE,
  type ICredentialsPublicService,
} from '@modules/credentials/contracts/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type ISessionsPublicService,
  SESSIONS_PUBLIC_SERVICE,
} from '@modules/sessions/contracts/index.js';
import {
  type IUsersPublicService,
  USER_STATUS,
  USERS_PUBLIC_SERVICE,
} from '@modules/users/contracts/index.js';
import {
  FEDERATED_AUDIT_META,
  FEDERATED_AUTH_OUTCOME,
  FEDERATED_AUTH_STAGE,
  FEDERATED_FLOW_TYPE,
  FEDERATED_PROVIDER_STATUS,
  type FederatedFlowType,
} from '../enum/federated-identity.enum.js';
import type { FederatedAuthTransactionEntity } from '../entities/federated-auth-transaction.entity.js';
import type { FederatedIdentityEntity } from '../entities/federated-identity.entity.js';
import type { FederatedIdentityProviderEntity } from '../entities/federated-identity-provider.entity.js';
import {
  resolveEffectiveProviderPolicy,
  resolveFederatedRuntimeConfig,
} from '../helpers/federated-config.helper.js';
import {
  assertRedirectUriAllowed,
  generateOpaqueSecret,
  generatePkcePair,
  sha256Hex,
} from '../helpers/pkce-and-state.helper.js';
import { FederatedAuthTransactionRepository } from '../repositories/federated-auth-transaction.repository.js';
import { FederatedIdentityProviderRepository } from '../repositories/federated-identity-provider.repository.js';
import { FederatedIdentityRepository } from '../repositories/federated-identity.repository.js';
import { FederatedIdentityResponseMapper } from '../responses/federated-identity.response.js';
import type {
  FederatedIdentityView,
  InitiateOAuthAuthorizeResult,
  OAuthCallbackResult,
  UnlinkFederatedIdentityResult,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import { FederatedStageError } from './federated-jwks.service.js';
import { FederatedMonitoringService } from './federated-monitoring.service.js';
import { FederatedProvidersService } from './federated-providers.service.js';
import { OAuthProviderRegistryService } from './oauth-provider-registry.service.js';

export interface AuthorizeRequestContext {
  readonly actorUserId?: number | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}

export interface CallbackRequestContext {
  readonly actorUserId?: number | null | undefined;
  readonly expectedFlowType?: FederatedFlowType | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
}

@Injectable()
export class FederatedAuthFlowService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private readonly kernelProviderRegistry: KernelProviderRegistryService;

  constructor(
    private readonly providerRepo: FederatedIdentityProviderRepository,
    private readonly identityRepo: FederatedIdentityRepository,
    private readonly transactionRepo: FederatedAuthTransactionRepository,
    private readonly providersService: FederatedProvidersService,
    private readonly providerRegistry: OAuthProviderRegistryService,
    private readonly monitoringService: FederatedMonitoringService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Inject(CREDENTIALS_PUBLIC_SERVICE)
    private readonly credentialsPublicService: ICredentialsPublicService,
    @Inject(AUTH_PUBLIC_SERVICE)
    private readonly authPublicService: IAuthPublicService,
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsPublicService: ISessionsPublicService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly transactionManager?: TransactionManager,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() kernelProviderRegistry?: KernelProviderRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
    this.kernelProviderRegistry = kernelProviderRegistry ?? defaultProviderRegistry;
  }

  public async initiateAuthorize(
    rawProviderCode: string,
    flowType: FederatedFlowType,
    input: {
      readonly redirectUri: string;
      readonly loginHint?: string | undefined;
      readonly deviceName?: string | undefined;
    },
    context: AuthorizeRequestContext = {},
  ): Promise<InitiateOAuthAuthorizeResult> {
    const providerCode = rawProviderCode.trim().toLowerCase();
    if (
      flowType === FEDERATED_FLOW_TYPE.LINK &&
      (!context.actorUserId || context.actorUserId <= 0)
    ) {
      throw new UnauthorizedAppException('federated-identity.linkAuthRequired');
    }

    const provider = await this.requireEnabledConfiguredProvider(providerCode, flowType, context);
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const providerAllowlist = safeJsonParseStringArray(provider.allowedRedirectUrisJson);

    let redirectUri: string;
    try {
      redirectUri = assertRedirectUriAllowed(
        input.redirectUri,
        providerAllowlist,
        runtimeConfig.allowedRedirectUris,
      );
    } catch (err) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.AUTHORIZE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'INVALID_REDIRECT_URI',
        errorMessage: 'Redirect URI is not in allowlist',
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw err;
    }

    const adapter = this.providerRegistry.get(provider.driverCode);
    const adapterConfig = this.providersService.resolveAdapterConfig(provider);
    const state = generateOpaqueSecret(32);
    const nonce = generateOpaqueSecret(32);
    const pkce = generatePkcePair();
    const expiresAt = new Date(Date.now() + runtimeConfig.transactionTtlSeconds * 1000);

    await this.transactionRepo.saveEntity({
      stateHash: sha256Hex(state),
      providerCode,
      flowType,
      userId: flowType === FEDERATED_FLOW_TYPE.LINK ? Number(context.actorUserId) : null,
      nonceHash: sha256Hex(nonce),
      codeVerifierEncrypted: this.encryptionService.encrypt(pkce.codeVerifier),
      redirectUri,
      deviceName: input.deviceName?.trim() || null,
      ipAddressMasked: context.ipAddress ? maskIp(context.ipAddress) : null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      expiresAt,
      consumedAt: null,
    });

    const authorizationUrl = adapter.buildAuthorizationUrl({
      config: adapterConfig,
      redirectUri,
      state,
      nonce,
      codeChallenge: pkce.codeChallenge,
      loginHint: input.loginHint,
    });

    return {
      providerCode,
      driverCode: provider.driverCode,
      flowType,
      authorizationUrl,
      state,
      codeChallengeMethod: pkce.codeChallengeMethod,
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async handleCallback(
    rawProviderCode: string,
    input: {
      readonly code?: string | undefined;
      readonly state: string;
      readonly redirectUri?: string | undefined;
      readonly error?: string | undefined;
      readonly errorDescription?: string | undefined;
      readonly deviceName?: string | undefined;
      readonly trustedDeviceToken?: string | undefined;
    },
    context: CallbackRequestContext = {},
  ): Promise<OAuthCallbackResult> {
    const startedAtMs = Date.now();
    const providerCode = rawProviderCode.trim().toLowerCase();
    const fallbackFlow = context.expectedFlowType ?? FEDERATED_FLOW_TYPE.LOGIN;

    const tx = await this.validateAndConsumeTransaction(
      providerCode,
      input,
      context,
      fallbackFlow,
      startedAtMs,
    );

    const provider = await this.requireEnabledConfiguredProvider(
      providerCode,
      tx.flowType,
      context,
    );
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const adapter = this.providerRegistry.get(provider.driverCode);
    const adapterConfig = this.providersService.resolveAdapterConfig(provider);
    const codeVerifier = this.encryptionService.decrypt(tx.codeVerifierEncrypted);

    const exchangeStartMs = Date.now();
    let verified: VerifiedExternalProfile;
    try {
      verified = await adapter.exchangeCodeAndVerify({
        config: adapterConfig,
        code: input.code!.trim(),
        redirectUri: tx.redirectUri,
        codeVerifier,
        expectedNonceHash: tx.nonceHash,
        jwksCacheTtlSeconds: runtimeConfig.jwksCacheTtlSeconds,
      });
      this.monitoringService.observeProviderDuration(
        providerCode,
        'exchange_and_verify',
        Date.now() - exchangeStartMs,
      );
    } catch (err) {
      const durationMs = Date.now() - startedAtMs;
      this.monitoringService.observeProviderDuration(
        providerCode,
        'exchange_and_verify',
        Date.now() - exchangeStartMs,
      );
      if (err instanceof FederatedStageError) {
        await this.monitoringService.recordEvent({
          providerId: provider.id,
          providerCode,
          flowType: tx.flowType,
          stage: err.stage,
          outcome: FEDERATED_AUTH_OUTCOME.FAILED,
          errorCode: err.stageErrorCode,
          providerError: err.providerError,
          errorMessage: err.diagnosticMessage,
          httpStatus: err.httpStatus,
          durationMs,
          userId: tx.userId ?? context.actorUserId ?? null,
          requestId: context.requestId,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
      } else {
        await this.monitoringService.recordEvent({
          providerId: provider.id,
          providerCode,
          flowType: tx.flowType,
          stage: FEDERATED_AUTH_STAGE.TOKEN_EXCHANGE,
          outcome: FEDERATED_AUTH_OUTCOME.FAILED,
          errorCode: 'PROVIDER_EXCHANGE_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs,
          userId: tx.userId ?? context.actorUserId ?? null,
          requestId: context.requestId,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
      }
      throw err;
    }

    if (tx.flowType === FEDERATED_FLOW_TYPE.LINK) {
      return this.completeExplicitLinkFlow({
        provider,
        tx,
        verified,
        context,
        startedAtMs,
      });
    }

    return this.completeLoginFlow({
      provider,
      tx,
      verified,
      input,
      context,
      runtimeConfig,
      startedAtMs,
    });
  }

  public async listUserIdentities(userId: number): Promise<FederatedIdentityView[]> {
    const records = await this.identityRepo.findByUserId(Number(userId));
    return records.map((r) => FederatedIdentityResponseMapper.toIdentityView(r));
  }

  public async unlinkUserIdentity(
    targetUserId: number,
    identityId: number,
    options: {
      readonly actorUserId?: number | undefined;
      readonly stepUpToken?: string | undefined;
      readonly enforceSelfStepUp?: boolean | undefined;
      readonly ipAddress?: string | null | undefined;
      readonly userAgent?: string | null | undefined;
    } = {},
  ): Promise<UnlinkFederatedIdentityResult> {
    const uid = Number(targetUserId);
    const existing = await this.identityRepo.findByIdAndUserId(Number(identityId), uid);
    if (!existing) {
      throw new NotFoundAppException('federated-identity.identityNotFound');
    }

    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    if (options.enforceSelfStepUp && runtimeConfig.requireStepUpForUnlink) {
      const token = options.stepUpToken?.trim();
      if (!token) {
        throw new ForbiddenAppException('federated-identity.stepUpRequired');
      }
      const ok = await this.authPublicService.verifyStepUpToken(
        uid,
        token,
        'federated-identity.unlink',
      );
      if (!ok) {
        throw new ForbiddenAppException('federated-identity.stepUpRequired');
      }
    }

    const performUnlink = async (): Promise<{
      readonly remainingLinkedCount: number;
      readonly hasLocalPassword: boolean;
    }> => {
      const [hasLocalPassword, otherCount] = await Promise.all([
        this.credentialsPublicService.hasPassword(uid),
        this.identityRepo.countByUserIdExcluding(uid, existing.id),
      ]);

      if (!hasLocalPassword && otherCount === 0) {
        await this.monitoringService.recordEvent({
          providerId: existing.providerId,
          providerCode: existing.providerCode,
          flowType: FEDERATED_FLOW_TYPE.LINK,
          stage: FEDERATED_AUTH_STAGE.UNLINK,
          outcome: FEDERATED_AUTH_OUTCOME.FAILED,
          errorCode: 'CANNOT_UNLINK_LAST_LOGIN_METHOD',
          errorMessage:
            'Blocked unlink because user has no local password and no other linked identity',
          userId: uid,
          identityId: existing.id,
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
        });
        throw new ConflictAppException('federated-identity.cannotUnlinkLastLoginMethod');
      }

      await this.identityRepo.hardDeleteById(existing.id);
      return {
        remainingLinkedCount: otherCount,
        hasLocalPassword,
      };
    };

    const outcome = this.transactionManager
      ? await this.transactionManager.runInTransaction(() => performUnlink())
      : await performUnlink();

    await this.sessionsPublicService
      .recordAuthEvent({
        userId: uid,
        actorId: options.actorUserId ?? uid,
        identifier: existing.emailAtProvider ?? `oauth:${existing.providerCode}`,
        eventType: AUTH_EVENT_TYPE.OAUTH_UNLINKED,
        status: AUTH_EVENT_STATUS.SUCCESS,
        ipAddress: options.ipAddress ?? null,
        userAgent: options.userAgent ?? null,
        reason: `Unlinked external identity (${existing.providerCode})`,
        metadata: {
          providerCode: existing.providerCode,
          issuerUrl: existing.issuerUrl,
          identityId: existing.id,
        },
      })
      .catch(() => undefined);

    await this.auditLogService
      ?.record({
        actorUserId: options.actorUserId ?? uid,
        module: FEDERATED_AUDIT_META.MODULE,
        feature: FEDERATED_AUDIT_META.FEATURE_IDENTITY,
        action: 'UNLINK',
        resourceType: 'federated_identity',
        resourceId: existing.id,
        beforeData: FederatedIdentityResponseMapper.toIdentityView(existing),
      })
      .catch(() => undefined);

    await this.monitoringService.recordEvent({
      providerId: existing.providerId,
      providerCode: existing.providerCode,
      flowType: FEDERATED_FLOW_TYPE.LINK,
      stage: FEDERATED_AUTH_STAGE.UNLINK,
      outcome: FEDERATED_AUTH_OUTCOME.SUCCESS,
      userId: uid,
      identityId: existing.id,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    });

    return {
      unlinked: true,
      id: Number(existing.id),
      providerCode: existing.providerCode,
      remainingLinkedCount: outcome.remainingLinkedCount,
      hasLocalPassword: outcome.hasLocalPassword,
    };
  }

  private async requireEnabledConfiguredProvider(
    providerCode: string,
    flowType: FederatedFlowType,
    context: AuthorizeRequestContext,
  ): Promise<FederatedIdentityProviderEntity> {
    if (this.kernelProviderRegistry.isProviderPaused(PROVIDER_TYPE.IDENTITY, providerCode)) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.AUTHORIZE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_PAUSED',
        errorMessage: `Provider ${providerCode} is paused in Provider Registry`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new ForbiddenAppException('federated-identity.providerDisabled', [{ providerCode }], {
        providerCode,
      });
    }
    const provider = await this.providerRepo.findByCode(providerCode);
    if (!provider) {
      throw new NotFoundAppException('federated-identity.providerNotFound', { providerCode });
    }
    if (!provider.isEnabled || provider.status !== FEDERATED_PROVIDER_STATUS.ACTIVE) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.AUTHORIZE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_DISABLED',
        errorMessage: `Provider ${providerCode} is disabled`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new ForbiddenAppException('federated-identity.providerDisabled', [{ providerCode }], {
        providerCode,
      });
    }
    if (!provider.clientId?.trim() || !provider.clientSecretEncrypted?.trim()) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.AUTHORIZE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        errorMessage: `Provider ${providerCode} is missing clientId/clientSecret`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException(
        'federated-identity.providerNotConfigured',
        [{ providerCode }],
        { providerCode },
      );
    }
    return provider;
  }

  private async validateAndConsumeTransaction(
    providerCode: string,
    input: {
      readonly code?: string | undefined;
      readonly state: string;
      readonly redirectUri?: string | undefined;
      readonly error?: string | undefined;
      readonly errorDescription?: string | undefined;
    },
    context: CallbackRequestContext,
    fallbackFlow: FederatedFlowType,
    startedAtMs: number,
  ): Promise<FederatedAuthTransactionEntity> {
    const tx = await this.transactionRepo.findByStateHash(sha256Hex(input.state.trim()));

    if (input.error?.trim()) {
      if (tx && !tx.consumedAt && tx.providerCode === providerCode) {
        await this.transactionRepo.consumeAtomically(tx.id);
      }
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx?.flowType ?? fallbackFlow,
        stage: FEDERATED_AUTH_STAGE.CALLBACK_VALIDATION,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_RETURNED_ERROR',
        providerError: input.error.trim(),
        errorMessage: input.errorDescription ?? input.error.trim(),
        durationMs: Date.now() - startedAtMs,
        userId: tx?.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.providerReturnedError');
    }

    if (!input.code?.trim()) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx?.flowType ?? fallbackFlow,
        stage: FEDERATED_AUTH_STAGE.CALLBACK_VALIDATION,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'MISSING_AUTH_CODE',
        errorMessage: 'Callback payload missing authorization code',
        durationMs: Date.now() - startedAtMs,
        userId: tx?.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException('federated-identity.providerReturnedError');
    }

    if (!tx) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: fallbackFlow,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'STATE_NOT_FOUND',
        errorMessage: 'OAuth transaction state was not found',
        durationMs: Date.now() - startedAtMs,
        userId: context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.invalidOrExpiredState');
    }

    if (tx.consumedAt) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'STATE_REPLAY_DETECTED',
        errorMessage: 'OAuth state has already been consumed',
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.stateReplayDetected');
    }

    if (tx.providerCode !== providerCode) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_MISMATCH',
        errorMessage: `Expected provider ${tx.providerCode} but received ${providerCode}`,
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.invalidOrExpiredState');
    }

    if (context.expectedFlowType && tx.flowType !== context.expectedFlowType) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'FLOW_MISMATCH',
        errorMessage: `Expected flow ${context.expectedFlowType} but transaction is ${tx.flowType}`,
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException('federated-identity.flowMismatch');
    }

    if (tx.expiresAt.getTime() <= Date.now()) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'STATE_EXPIRED',
        errorMessage: 'OAuth transaction state expired',
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.invalidOrExpiredState');
    }

    if (input.redirectUri?.trim() && input.redirectUri.trim() !== tx.redirectUri) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'REDIRECT_URI_MISMATCH',
        errorMessage: 'Callback redirectUri does not match authorize transaction',
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException('federated-identity.invalidRedirectUri');
    }

    if (tx.flowType === FEDERATED_FLOW_TYPE.LINK) {
      if (!context.actorUserId || context.actorUserId <= 0) {
        throw new UnauthorizedAppException('federated-identity.linkAuthRequired');
      }
      if (Number(context.actorUserId) !== Number(tx.userId)) {
        await this.monitoringService.recordEvent({
          providerCode,
          flowType: tx.flowType,
          stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
          outcome: FEDERATED_AUTH_OUTCOME.FAILED,
          errorCode: 'LINK_USER_MISMATCH',
          errorMessage: 'Authenticated user does not match linking transaction owner',
          durationMs: Date.now() - startedAtMs,
          userId: context.actorUserId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
        throw new ForbiddenAppException('federated-identity.linkUserMismatch');
      }
    }

    const consumed = await this.transactionRepo.consumeAtomically(tx.id);
    if (!consumed) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: tx.flowType,
        stage: FEDERATED_AUTH_STAGE.STATE_PKCE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'STATE_REPLAY_DETECTED',
        errorMessage: 'Concurrent OAuth state replay rejected',
        durationMs: Date.now() - startedAtMs,
        userId: tx.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.stateReplayDetected');
    }

    return tx;
  }

  private async completeExplicitLinkFlow(params: {
    readonly provider: FederatedIdentityProviderEntity;
    readonly tx: FederatedAuthTransactionEntity;
    readonly verified: VerifiedExternalProfile;
    readonly context: CallbackRequestContext;
    readonly startedAtMs: number;
  }): Promise<OAuthCallbackResult> {
    const { provider, tx, verified, context, startedAtMs } = params;
    const targetUserId = Number(tx.userId);
    const existing = await this.identityRepo.findByProviderSubject(
      provider.providerCode,
      verified.issuer,
      verified.subject,
    );

    if (existing && Number(existing.userId) !== targetUserId) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode: provider.providerCode,
        flowType: FEDERATED_FLOW_TYPE.LINK,
        stage: FEDERATED_AUTH_STAGE.LINK,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'IDENTITY_LINKED_TO_OTHER_USER',
        errorMessage: 'External subject is already linked to another account',
        durationMs: Date.now() - startedAtMs,
        userId: targetUserId,
        identityId: existing.id,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new ConflictAppException('federated-identity.identityAlreadyLinkedToAnotherUser');
    }

    let saved: FederatedIdentityEntity;
    let alreadyLinked = false;
    if (existing) {
      alreadyLinked = true;
      existing.emailAtProvider = verified.email;
      existing.emailVerified = verified.emailVerified;
      existing.displayName = verified.displayName;
      existing.avatarUrl = verified.avatarUrl;
      existing.profileMetadataJson = JSON.stringify(verified.rawClaimsSummary);
      saved = await this.identityRepo.saveEntity(existing);
    } else {
      saved = await this.identityRepo.saveEntity({
        userId: targetUserId,
        providerId: provider.id,
        providerCode: provider.providerCode,
        issuerUrl: verified.issuer,
        providerSubject: verified.subject,
        providerTenantId: verified.tenantId,
        emailAtProvider: verified.email,
        emailVerified: verified.emailVerified,
        displayName: verified.displayName,
        avatarUrl: verified.avatarUrl,
        profileMetadataJson: JSON.stringify(verified.rawClaimsSummary),
        linkedAt: new Date(),
        linkedBy: targetUserId,
        lastLoginAt: null,
      });
    }

    const identityView = FederatedIdentityResponseMapper.toIdentityView(saved);

    if (!alreadyLinked) {
      await this.sessionsPublicService
        .recordAuthEvent({
          userId: targetUserId,
          actorId: targetUserId,
          identifier: verified.email ?? `oauth:${provider.providerCode}`,
          eventType: AUTH_EVENT_TYPE.OAUTH_LINKED,
          status: AUTH_EVENT_STATUS.SUCCESS,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          reason: `Linked external identity (${provider.providerCode})`,
          metadata: {
            providerCode: provider.providerCode,
            issuerUrl: verified.issuer,
            identityId: saved.id,
          },
        })
        .catch(() => undefined);

      await this.auditLogService
        ?.record({
          actorUserId: targetUserId,
          module: FEDERATED_AUDIT_META.MODULE,
          feature: FEDERATED_AUDIT_META.FEATURE_IDENTITY,
          action: 'LINK',
          resourceType: 'federated_identity',
          resourceId: saved.id,
          afterData: identityView,
        })
        .catch(() => undefined);
    }

    await this.monitoringService.recordEvent({
      providerId: provider.id,
      providerCode: provider.providerCode,
      flowType: FEDERATED_FLOW_TYPE.LINK,
      stage: FEDERATED_AUTH_STAGE.LINK,
      outcome: FEDERATED_AUTH_OUTCOME.SUCCESS,
      durationMs: Date.now() - startedAtMs,
      userId: targetUserId,
      identityId: saved.id,
      requestId: context.requestId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { alreadyLinked },
    });

    return {
      flowType: 'LINK',
      providerCode: provider.providerCode,
      linked: true,
      alreadyLinked,
      identity: identityView,
    };
  }

  private async completeLoginFlow(params: {
    readonly provider: FederatedIdentityProviderEntity;
    readonly tx: FederatedAuthTransactionEntity;
    readonly verified: VerifiedExternalProfile;
    readonly input: {
      readonly deviceName?: string | undefined;
      readonly trustedDeviceToken?: string | undefined;
    };
    readonly context: CallbackRequestContext;
    readonly runtimeConfig: ReturnType<typeof resolveFederatedRuntimeConfig>;
    readonly startedAtMs: number;
  }): Promise<OAuthCallbackResult> {
    const { provider, tx, verified, input, context, runtimeConfig, startedAtMs } = params;
    const effectivePolicy = resolveEffectiveProviderPolicy(provider, runtimeConfig);
    const now = new Date();

    let identityEntity = await this.identityRepo.findByProviderSubject(
      provider.providerCode,
      verified.issuer,
      verified.subject,
    );
    const isExistingIdentity = Boolean(identityEntity);
    let isNewUser = false;
    let autoLinked = false;

    if (!identityEntity) {
      const existingUser = verified.email
        ? await this.usersPublicService.findAuthUserByIdentifier(verified.email)
        : null;

      if (existingUser) {
        if (!effectivePolicy.autoLinkVerifiedEmail || !verified.emailVerified) {
          await this.monitoringService.recordEvent({
            providerId: provider.id,
            providerCode: provider.providerCode,
            flowType: FEDERATED_FLOW_TYPE.LOGIN,
            stage: FEDERATED_AUTH_STAGE.ACCOUNT_RESOLUTION,
            outcome: FEDERATED_AUTH_OUTCOME.FAILED,
            errorCode: 'ACCOUNT_EXISTS_MANUAL_LINK_REQUIRED',
            errorMessage:
              'Existing account matches email; automatic linking is disabled or email is not verified by provider',
            durationMs: Date.now() - startedAtMs,
            userId: existingUser.id,
            requestId: context.requestId,
            correlationId: context.correlationId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          });
          throw new ConflictAppException('federated-identity.accountExistsRequiresManualLink');
        }

        if (existingUser.archivedAt || existingUser.status === USER_STATUS.ARCHIVED) {
          throw new ForbiddenAppException('auth.accountArchived');
        }
        if (existingUser.status === USER_STATUS.INACTIVE) {
          throw new ForbiddenAppException('auth.accountInactive');
        }
        if (
          existingUser.status === USER_STATUS.LOCKED &&
          (!existingUser.lockedUntil || existingUser.lockedUntil.getTime() > Date.now())
        ) {
          throw new ForbiddenAppException('auth.accountLocked', [
            {
              reason: existingUser.lockReason,
              lockedUntil: existingUser.lockedUntil ? existingUser.lockedUntil.toISOString() : null,
            },
          ]);
        }

        autoLinked = true;
        identityEntity = await this.identityRepo.saveEntity({
          userId: existingUser.id,
          providerId: provider.id,
          providerCode: provider.providerCode,
          issuerUrl: verified.issuer,
          providerSubject: verified.subject,
          providerTenantId: verified.tenantId,
          emailAtProvider: verified.email,
          emailVerified: verified.emailVerified,
          displayName: verified.displayName,
          avatarUrl: verified.avatarUrl,
          profileMetadataJson: JSON.stringify(verified.rawClaimsSummary),
          linkedAt: now,
          linkedBy: existingUser.id,
          lastLoginAt: now,
        });
      } else {
        if (!effectivePolicy.allowAutoRegister) {
          await this.monitoringService.recordEvent({
            providerId: provider.id,
            providerCode: provider.providerCode,
            flowType: FEDERATED_FLOW_TYPE.LOGIN,
            stage: FEDERATED_AUTH_STAGE.ACCOUNT_RESOLUTION,
            outcome: FEDERATED_AUTH_OUTCOME.FAILED,
            errorCode: 'REGISTRATION_DISABLED',
            errorMessage: 'Automatic user registration from OAuth is disabled',
            durationMs: Date.now() - startedAtMs,
            requestId: context.requestId,
            correlationId: context.correlationId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          });
          throw new ForbiddenAppException('federated-identity.registrationDisabled');
        }

        if (
          effectivePolicy.requireVerifiedEmailForRegister &&
          (!verified.email || !verified.emailVerified)
        ) {
          await this.monitoringService.recordEvent({
            providerId: provider.id,
            providerCode: provider.providerCode,
            flowType: FEDERATED_FLOW_TYPE.LOGIN,
            stage: FEDERATED_AUTH_STAGE.ACCOUNT_RESOLUTION,
            outcome: FEDERATED_AUTH_OUTCOME.FAILED,
            errorCode: 'VERIFIED_EMAIL_REQUIRED',
            errorMessage: 'Provider must assert verified email before creating a new user',
            durationMs: Date.now() - startedAtMs,
            requestId: context.requestId,
            correlationId: context.correlationId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          });
          throw new ForbiddenAppException('federated-identity.verifiedEmailRequired');
        }

        isNewUser = true;
        const createUserAndLink = async (): Promise<FederatedIdentityEntity> => {
          const created = await this.usersPublicService.registerSelfUser({
            email: verified.email,
            firstName: verified.firstName ?? undefined,
            lastName: verified.lastName ?? undefined,
            fullName: verified.displayName ?? undefined,
            avatarUrl: verified.avatarUrl ?? null,
            status: USER_STATUS.ACTIVE,
          });
          if (verified.emailVerified) {
            await this.usersPublicService.markEmailVerified(created.id);
          }
          return this.identityRepo.saveEntity({
            userId: created.id,
            providerId: provider.id,
            providerCode: provider.providerCode,
            issuerUrl: verified.issuer,
            providerSubject: verified.subject,
            providerTenantId: verified.tenantId,
            emailAtProvider: verified.email,
            emailVerified: verified.emailVerified,
            displayName: verified.displayName,
            avatarUrl: verified.avatarUrl,
            profileMetadataJson: JSON.stringify(verified.rawClaimsSummary),
            linkedAt: now,
            linkedBy: created.id,
            lastLoginAt: now,
          });
        };

        identityEntity = this.transactionManager
          ? await this.transactionManager.runInTransaction(() => createUserAndLink())
          : await createUserAndLink();
      }
    }

    if (!identityEntity) {
      throw new NotFoundAppException('federated-identity.identityNotFound');
    }

    let loginResult: LoginResponse;
    try {
      loginResult = await this.authPublicService.completeExternalLogin({
        userId: Number(identityEntity.userId),
        providerCode: provider.providerCode,
        issuer: verified.issuer,
        identityId: Number(identityEntity.id),
        deviceName: input.deviceName ?? tx.deviceName ?? null,
        trustedDeviceToken: input.trustedDeviceToken ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      });
    } catch (err) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode: provider.providerCode,
        flowType: FEDERATED_FLOW_TYPE.LOGIN,
        stage: FEDERATED_AUTH_STAGE.LOGIN_COMPLETION,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'LOGIN_COMPLETION_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAtMs,
        userId: Number(identityEntity.userId),
        identityId: Number(identityEntity.id),
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw err;
    }

    if (isExistingIdentity) {
      identityEntity.emailAtProvider = verified.email;
      identityEntity.emailVerified = verified.emailVerified;
      identityEntity.displayName = verified.displayName;
      identityEntity.avatarUrl = verified.avatarUrl;
      identityEntity.profileMetadataJson = JSON.stringify(verified.rawClaimsSummary);
      identityEntity.lastLoginAt = now;
      identityEntity = await this.identityRepo.saveEntity(identityEntity);
    }

    const identityView = FederatedIdentityResponseMapper.toIdentityView(identityEntity);

    if (isNewUser || autoLinked) {
      await this.sessionsPublicService
        .recordAuthEvent({
          userId: Number(identityEntity.userId),
          actorId: Number(identityEntity.userId),
          identifier: verified.email ?? `oauth:${provider.providerCode}`,
          eventType: AUTH_EVENT_TYPE.OAUTH_LINKED,
          status: AUTH_EVENT_STATUS.SUCCESS,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
          reason: isNewUser
            ? `Auto-registered & linked via ${provider.providerCode}`
            : `Auto-linked verified email via ${provider.providerCode}`,
          metadata: {
            providerCode: provider.providerCode,
            issuerUrl: verified.issuer,
            identityId: identityEntity.id,
          },
        })
        .catch(() => undefined);

      await this.auditLogService
        ?.record({
          actorUserId: Number(identityEntity.userId),
          module: FEDERATED_AUDIT_META.MODULE,
          feature: FEDERATED_AUDIT_META.FEATURE_IDENTITY,
          action: isNewUser ? 'AUTO_REGISTER_LINK' : 'AUTO_LINK',
          resourceType: 'federated_identity',
          resourceId: identityEntity.id,
          afterData: identityView,
        })
        .catch(() => undefined);
    }

    await this.monitoringService.recordEvent({
      providerId: provider.id,
      providerCode: provider.providerCode,
      flowType: FEDERATED_FLOW_TYPE.LOGIN,
      stage: FEDERATED_AUTH_STAGE.LOGIN_COMPLETION,
      outcome: FEDERATED_AUTH_OUTCOME.SUCCESS,
      durationMs: Date.now() - startedAtMs,
      userId: Number(identityEntity.userId),
      identityId: Number(identityEntity.id),
      requestId: context.requestId,
      correlationId: context.correlationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { isNewUser, autoLinked },
    });

    return {
      flowType: 'LOGIN',
      providerCode: provider.providerCode,
      isNewUser,
      autoLinked,
      identity: identityView,
      loginResult,
    };
  }
}
