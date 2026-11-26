import { Inject, Injectable, Optional } from '@nestjs/common';
import { maskIp } from '@packages/http/index.js';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import {
  BadRequestAppException,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultProviderRegistry,
  defaultSettingRegistry,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  defaultFieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  FEDERATED_AUDIT_META,
  FEDERATED_AUTH_OUTCOME,
  FEDERATED_AUTH_STAGE,
  FEDERATED_DRIVER_CODE,
  FEDERATED_FEATURE_FLAGS,
  FEDERATED_FLOW_TYPE,
  FEDERATED_PROVIDER_STATUS,
  SAML_CERT_STATUS,
  SAML_DEFAULTS,
  type FederatedFlowType,
  type SamlCertStatus,
} from '../enum/federated-identity.enum.js';
import type { FederatedAuthTransactionEntity } from '../entities/federated-auth-transaction.entity.js';
import type { FederatedIdentityProviderEntity } from '../entities/federated-identity-provider.entity.js';
import { resolveFederatedRuntimeConfig } from '../helpers/federated-config.helper.js';
import {
  assertRedirectUriAllowed,
  generateOpaqueSecret,
  sha256Hex,
} from '../helpers/pkce-and-state.helper.js';
import {
  getEligibleIdpVerificationCerts,
  mergeIdpCertificatesForRotation,
} from '../helpers/saml-certificate.helper.js';
import {
  isSamlProviderConfigured,
  parseSamlConfig,
} from '../helpers/saml-config.helper.js';
import {
  buildSpMetadataXml,
  parseIdpMetadataXml,
} from '../helpers/saml-metadata.helper.js';
import { parseAndValidateSamlAssertion } from '../helpers/saml-assertion.helper.js';
import { mapAndValidateSamlAttributes } from '../helpers/saml-attribute-mapping.helper.js';
import {
  buildSamlAuthnRequest,
  verifySamlXmlSignature,
} from '../helpers/saml-xml-signature.helper.js';
import { FederatedAuthTransactionRepository } from '../repositories/federated-auth-transaction.repository.js';
import { FederatedIdentityProviderRepository } from '../repositories/federated-identity-provider.repository.js';
import { FederatedSamlAssertionReplayRepository } from '../repositories/federated-saml-assertion-replay.repository.js';
import type {
  ImportSamlMetadataRequest,
  SamlAcsRequest,
  SamlExchangeRequest,
} from '../requests/federated-identity.requests.js';
import type {
  InitiateOAuthAuthorizeResult,
  OAuthCallbackResult,
  SamlMetadataImportResult,
  SamlProviderConfig,
  VerifiedExternalProfile,
} from '../types/federated-identity.types.js';
import {
  type AuthorizeRequestContext,
  type CallbackRequestContext,
  FederatedAuthFlowService,
} from './federated-auth-flow.service.js';
import { FederatedStageError } from './federated-jwks.service.js';
import { FederatedMonitoringService } from './federated-monitoring.service.js';
import { FederatedProvidersService } from './federated-providers.service.js';

interface StoredSamlExchangePayload {
  readonly originalFlowType: 'LOGIN' | 'LINK';
  readonly linkUserId: number | null;
  readonly verified: VerifiedExternalProfile;
  readonly deviceName?: string | null | undefined;
  readonly certFingerprint: string;
  readonly certStatus: SamlCertStatus;
}

export type SamlAcsHandleResult =
  | { readonly mode: 'json'; readonly result: OAuthCallbackResult }
  | { readonly mode: 'redirect'; readonly redirectUrl: string };

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

@Injectable()
export class SamlSsoService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private readonly kernelProviderRegistry: KernelProviderRegistryService;
  private readonly httpClient: HttpClientContract;

  constructor(
    private readonly providerRepo: FederatedIdentityProviderRepository,
    private readonly transactionRepo: FederatedAuthTransactionRepository,
    private readonly replayRepo: FederatedSamlAssertionReplayRepository,
    private readonly providersService: FederatedProvidersService,
    private readonly authFlowService: FederatedAuthFlowService,
    private readonly monitoringService: FederatedMonitoringService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() kernelProviderRegistry?: KernelProviderRegistryService,
    @Optional() private readonly featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
    this.kernelProviderRegistry = kernelProviderRegistry ?? defaultProviderRegistry;
    this.httpClient = httpClient ?? new BaseHttpClientProvider();
  }

  public async getSpMetadataXml(rawProviderCode: string): Promise<string> {
    const providerCode = rawProviderCode.trim().toLowerCase();
    const provider = await this.providersService.getProviderEntityOrThrow(providerCode);
    if (provider.driverCode !== FEDERATED_DRIVER_CODE.SAML) {
      throw new BadRequestAppException('federated-identity.unsupportedDriver', [
        { driverCode: provider.driverCode },
      ]);
    }
    const config = parseSamlConfig(provider.extraConfigJson, provider.providerCode);
    return buildSpMetadataXml(config);
  }

  public async importIdpMetadata(
    rawProviderCode: string,
    input: ImportSamlMetadataRequest,
    actor?: UserIdentity,
  ): Promise<SamlMetadataImportResult> {
    const providerCode = rawProviderCode.trim().toLowerCase();
    const existing = await this.providerRepo.findByCode(providerCode, true);
    if (existing && existing.driverCode !== FEDERATED_DRIVER_CODE.SAML) {
      throw new BadRequestAppException('federated-identity.unsupportedDriver', [
        { driverCode: existing.driverCode },
      ]);
    }

    let metadataXml = input.metadataXml?.trim() ?? '';
    if (!metadataXml && input.metadataUrl) {
      metadataXml = await this.fetchMetadataFromUrl(providerCode, input.metadataUrl.trim());
    }

    let parsed;
    try {
      parsed = parseIdpMetadataXml(metadataXml);
    } catch (err) {
      await this.monitoringService.recordEvent({
        providerId: existing?.id ?? null,
        providerCode,
        flowType: FEDERATED_FLOW_TYPE.LOGIN,
        stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode:
          err instanceof FederatedStageError ? err.stageErrorCode : 'SAML_INVALID_METADATA',
        errorMessage:
          err instanceof FederatedStageError
            ? err.diagnosticMessage
            : err instanceof Error
              ? err.message
              : String(err),
        userId: actor ? Number(actor.id) : null,
      });
      throw err;
    }

    const currentSaml = parseSamlConfig(existing?.extraConfigJson, providerCode);
    const mergedCerts = mergeIdpCertificatesForRotation(
      currentSaml.idpCertificates,
      parsed.signingCertificatesPem,
      {
        mergeCertificates: input.mergeCertificates ?? true,
        transitionGraceDays: input.transitionGraceDays ?? SAML_DEFAULTS.TRANSITION_GRACE_DAYS,
      },
    );

    const updatedView = await this.providersService.upsertProvider(
      providerCode,
      {
        driverCode: FEDERATED_DRIVER_CODE.SAML,
        ...(existing ? {} : { displayName: SAML_DEFAULTS.DISPLAY_NAME }),
        issuerUrl: parsed.idpEntityId,
        samlConfig: {
          idpEntityId: parsed.idpEntityId,
          idpSsoUrl: parsed.idpSsoUrl,
          idpSsoBinding: parsed.idpSsoBinding,
          idpCertificates: mergedCerts.certificates.map((c) => ({
            id: c.id,
            label: c.label ?? null,
            pem: c.pem,
            status: c.status,
            graceEndsAt: c.graceEndsAt,
          })),
        },
      },
      actor,
    );

    await this.auditLogService
      ?.record({
        actor,
        module: FEDERATED_AUDIT_META.MODULE,
        feature: FEDERATED_AUDIT_META.FEATURE_SAML_METADATA,
        action: 'IMPORT_METADATA',
        resourceType: 'federated_identity_provider',
        resourceId: providerCode,
        afterData: {
          idpEntityId: parsed.idpEntityId,
          idpSsoUrl: parsed.idpSsoUrl,
          idpSsoBinding: parsed.idpSsoBinding,
          importedCertificatesCount: parsed.signingCertificatesPem.length,
          transitionedCertificatesCount: mergedCerts.transitionedCount,
          activeCertificatesCount: mergedCerts.activeCount,
        },
      })
      .catch(() => undefined);

    await this.monitoringService.recordEvent({
      providerId: updatedView.id,
      providerCode,
      flowType: FEDERATED_FLOW_TYPE.LOGIN,
      stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
      outcome: FEDERATED_AUTH_OUTCOME.SUCCESS,
      userId: actor ? Number(actor.id) : null,
      metadata: {
        idpEntityId: parsed.idpEntityId,
        importedCertificatesCount: parsed.signingCertificatesPem.length,
        transitionedCertificatesCount: mergedCerts.transitionedCount,
      },
    });

    return {
      providerCode,
      idpEntityId: parsed.idpEntityId,
      idpSsoUrl: parsed.idpSsoUrl,
      idpSsoBinding: parsed.idpSsoBinding,
      importedCertificatesCount: parsed.signingCertificatesPem.length,
      transitionedCertificatesCount: mergedCerts.transitionedCount,
      activeCertificatesCount: mergedCerts.activeCount,
      provider: updatedView,
    };
  }

  public async initiateAuthorize(
    rawProviderCode: string,
    flowType: 'LOGIN' | 'LINK',
    input: {
      readonly redirectUri: string;
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

    const { provider, samlConfig } = await this.requireEnabledConfiguredSamlProvider(
      providerCode,
      flowType,
      context,
    );
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
        stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'INVALID_REDIRECT_URI',
        errorMessage: 'Redirect URI is not in allowlist',
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw err;
    }

    const relayState = generateOpaqueSecret(32);
    const activeSpCert =
      samlConfig.spCertificates.find((c) => c.status === SAML_CERT_STATUS.ACTIVE) ??
      samlConfig.spCertificates.find((c) => c.status === SAML_CERT_STATUS.TRANSITIONING) ??
      null;
    const signingPrivateKeyPem = activeSpCert?.privateKeyEncrypted
      ? this.encryptionService.decrypt(activeSpCert.privateKeyEncrypted)
      : null;

    const built = buildSamlAuthnRequest({
      spEntityId: samlConfig.spEntityId,
      acsUrl: samlConfig.acsUrl,
      idpSsoUrl: samlConfig.idpSsoUrl!,
      nameIdFormat: samlConfig.nameIdFormat,
      binding: samlConfig.idpSsoBinding,
      relayState,
      signRequest: samlConfig.authnRequestsSigned && Boolean(signingPrivateKeyPem),
      signingPrivateKeyPem,
      signingCertPem: activeSpCert?.pem ?? null,
    });

    const expiresAt = new Date(Date.now() + runtimeConfig.transactionTtlSeconds * 1000);
    await this.transactionRepo.saveEntity({
      stateHash: sha256Hex(relayState),
      providerCode,
      flowType,
      userId: flowType === FEDERATED_FLOW_TYPE.LINK ? Number(context.actorUserId) : null,
      nonceHash: sha256Hex(built.requestId),
      codeVerifierEncrypted: this.encryptionService.encrypt(
        JSON.stringify({ requestId: built.requestId, flowType }),
      ),
      redirectUri,
      deviceName: input.deviceName?.trim() || null,
      ipAddressMasked: context.ipAddress ? maskIp(context.ipAddress) : null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      expiresAt,
      consumedAt: null,
    });

    return {
      providerCode,
      driverCode: provider.driverCode,
      flowType,
      authorizationUrl: built.authorizationUrl,
      state: relayState,
      codeChallengeMethod: 'S256',
      expiresAt: expiresAt.toISOString(),
      binding: built.binding,
      samlRequest: built.samlRequest,
      relayState: built.relayState,
      requestId: built.requestId,
    };
  }

  public async handleAcs(
    rawProviderCode: string,
    input: SamlAcsRequest,
    options: {
      readonly responseMode: 'redirect' | 'json';
      readonly context?: CallbackRequestContext | undefined;
    },
  ): Promise<SamlAcsHandleResult> {
    const startedAtMs = Date.now();
    const providerCode = rawProviderCode.trim().toLowerCase();
    const context = options.context ?? {};
    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    const effectiveResponseMode = input.responseMode ?? options.responseMode;

    let provider: FederatedIdentityProviderEntity | null = null;
    let samlConfig: SamlProviderConfig | null = null;
    let matchedTx: FederatedAuthTransactionEntity | null = null;
    let resolvedFlowType: 'LOGIN' | 'LINK' = 'LOGIN';
    let assertionIdHashForLog: string | null = null;
    let certFingerprintForLog: string | null = null;

    try {
      const resolved = await this.requireEnabledConfiguredSamlProvider(
        providerCode,
        FEDERATED_FLOW_TYPE.LOGIN,
        context,
      );
      provider = resolved.provider;
      samlConfig = resolved.samlConfig;

      const rawB64 = (input.SAMLResponse ?? input.samlResponse ?? '').trim();
      if (!rawB64) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlInvalidResponse',
          stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
          stageErrorCode: 'SAML_MISSING_RESPONSE',
          diagnosticMessage: 'Missing SAMLResponse payload',
        });
      }

      const xml = Buffer.from(rawB64, 'base64').toString('utf8');
      const now = new Date();
      const sigResult = verifySamlXmlSignature({
        xml,
        idpCertificates: samlConfig.idpCertificates,
        wantAssertionsSigned: samlConfig.wantAssertionsSigned,
        now,
        clockSkewSeconds: samlConfig.clockSkewSeconds,
      });
      certFingerprintForLog = sigResult.certFingerprint;

      const assertion = parseAndValidateSamlAssertion({
        responseNode: sigResult.responseNode,
        assertionNode: sigResult.assertionNode,
        config: samlConfig,
        now,
      });
      assertionIdHashForLog = assertion.assertionIdHash;

      // Verify InResponseTo / transaction state (SP-initiated vs IdP-initiated)
      const relayState = (input.RelayState ?? input.relayState)?.trim();
      if (assertion.inResponseTo) {
        matchedTx = await this.consumeSamlAuthnTransaction({
          providerCode,
          inResponseTo: assertion.inResponseTo,
          relayState,
          now,
        });
        resolvedFlowType =
          matchedTx.flowType === FEDERATED_FLOW_TYPE.LINK ? 'LINK' : 'LOGIN';
      } else if (!samlConfig.allowIdpInitiated) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlIdpInitiatedDisabled',
          stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
          stageErrorCode: 'SAML_IDP_INITIATED_DISABLED',
          diagnosticMessage: 'IdP-initiated SAML Response rejected because allowIdpInitiated=false',
          metadata: { assertionIdHash: assertion.assertionIdHash },
        });
      }

      // Persistent Anti-Replay check on Assertion ID
      const replayExpiresAt = new Date(
        Math.max(assertion.notOnOrAfter.getTime() + samlConfig.clockSkewSeconds * 1000, now.getTime() + 60_000),
      );
      const isFresh = await this.replayRepo.recordAssertionIfUnused({
        providerCode,
        assertionIdHash: assertion.assertionIdHash,
        issuer: assertion.issuer,
        expiresAt: replayExpiresAt,
        now,
      });
      if (!isFresh) {
        throw new FederatedStageError({
          i18nKey: 'federated-identity.samlAssertionReplay',
          stage: FEDERATED_AUTH_STAGE.SAML_REPLAY_CHECK,
          stageErrorCode: 'SAML_ASSERTION_REPLAY',
          diagnosticMessage: 'SAML Assertion ID has already been consumed',
          metadata: {
            assertionIdHash: assertion.assertionIdHash,
            certFingerprint: sigResult.certFingerprint,
          },
        });
      }

      const verified = mapAndValidateSamlAttributes({
        assertion,
        config: samlConfig,
        providerCode,
      });

      this.monitoringService.observeProviderDuration(
        providerCode,
        'saml_acs_verify',
        Date.now() - startedAtMs,
      );

      if (effectiveResponseMode === 'json') {
        const result =
          resolvedFlowType === 'LINK'
            ? await this.authFlowService.completeVerifiedProfileLink({
                provider,
                targetUserId: Number(matchedTx!.userId),
                verified,
                context,
                startedAtMs,
              })
            : await this.authFlowService.completeVerifiedProfileLogin({
                provider,
                tx: matchedTx,
                verified,
                input: {
                  deviceName: input.deviceName,
                  trustedDeviceToken: input.trustedDeviceToken,
                },
                context,
                runtimeConfig,
                startedAtMs,
              });
        return { mode: 'json', result };
      }

      const targetRedirectUri = this.resolveTargetRedirectUri(
        provider,
        matchedTx,
        runtimeConfig.allowedRedirectUris,
      );
      const samlCode = generateOpaqueSecret(32);
      const exchangePayload: StoredSamlExchangePayload = {
        originalFlowType: resolvedFlowType,
        linkUserId: resolvedFlowType === 'LINK' ? Number(matchedTx?.userId ?? 0) || null : null,
        verified,
        deviceName: input.deviceName ?? matchedTx?.deviceName ?? null,
        certFingerprint: sigResult.certFingerprint,
        certStatus: sigResult.certStatus,
      };
      const exchangeExpiresAt = new Date(
        Date.now() + SAML_DEFAULTS.EXCHANGE_CODE_TTL_SECONDS * 1000,
      );

      await this.transactionRepo.saveEntity({
        stateHash: sha256Hex(samlCode),
        providerCode,
        flowType: FEDERATED_FLOW_TYPE.SAML_EXCHANGE,
        userId: exchangePayload.linkUserId,
        nonceHash: assertion.assertionIdHash,
        codeVerifierEncrypted: this.encryptionService.encrypt(JSON.stringify(exchangePayload)),
        redirectUri: targetRedirectUri,
        deviceName: exchangePayload.deviceName ?? null,
        ipAddressMasked: context.ipAddress ? maskIp(context.ipAddress) : null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        expiresAt: exchangeExpiresAt,
        consumedAt: null,
      });

      const redirectUrl = this.appendQueryParams(targetRedirectUri, {
        samlCode,
        provider: providerCode,
      });
      return { mode: 'redirect', redirectUrl };
    } catch (err) {
      const durationMs = Date.now() - startedAtMs;
      const errorCode =
        err instanceof FederatedStageError
          ? err.stageErrorCode
          : err instanceof BadRequestAppException ||
              err instanceof ForbiddenAppException ||
              err instanceof UnauthorizedAppException
            ? 'SAML_ACS_FAILED'
            : 'SAML_ACS_UNEXPECTED_ERROR';
      const stage =
        err instanceof FederatedStageError
          ? err.stage
          : FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION;
      const diagnosticMessage =
        err instanceof FederatedStageError
          ? err.diagnosticMessage
          : err instanceof Error
            ? err.message
            : String(err);

      await this.monitoringService.recordEvent({
        providerId: provider?.id ?? null,
        providerCode,
        flowType: resolvedFlowType,
        stage,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode,
        providerError: err instanceof FederatedStageError ? err.providerError : null,
        errorMessage: diagnosticMessage,
        durationMs,
        userId: matchedTx?.userId ?? context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          ...(assertionIdHashForLog ? { assertionIdHash: assertionIdHashForLog } : {}),
          ...(certFingerprintForLog ? { certFingerprint: certFingerprintForLog } : {}),
          ...(err instanceof FederatedStageError && err.metadata ? err.metadata : {}),
        },
      });

      if (effectiveResponseMode === 'redirect' && provider) {
        try {
          const fallbackRedirect = this.resolveTargetRedirectUri(
            provider,
            matchedTx,
            runtimeConfig.allowedRedirectUris,
          );
          return {
            mode: 'redirect',
            redirectUrl: this.appendQueryParams(fallbackRedirect, {
              samlError: errorCode,
              provider: providerCode,
            }),
          };
        } catch {
          // Fall through and rethrow if no valid redirect URI allowlist entry exists
        }
      }

      throw err;
    }
  }

  public async exchangeSamlCode(
    rawProviderCode: string,
    input: SamlExchangeRequest,
    context: CallbackRequestContext = {},
  ): Promise<OAuthCallbackResult> {
    const startedAtMs = Date.now();
    const providerCode = rawProviderCode.trim().toLowerCase();
    const tx = await this.transactionRepo.findByStateHash(sha256Hex(input.samlCode.trim()));

    if (
      !tx ||
      tx.flowType !== FEDERATED_FLOW_TYPE.SAML_EXCHANGE ||
      tx.providerCode !== providerCode ||
      tx.consumedAt ||
      tx.expiresAt.getTime() <= Date.now()
    ) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType: FEDERATED_FLOW_TYPE.LOGIN,
        stage: FEDERATED_AUTH_STAGE.SAML_EXCHANGE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: tx?.consumedAt ? 'SAML_EXCHANGE_CODE_REPLAY' : 'SAML_EXCHANGE_CODE_INVALID',
        errorMessage: 'SAML exchange code is invalid, expired, or already consumed',
        durationMs: Date.now() - startedAtMs,
        userId: context.actorUserId ?? null,
        requestId: context.requestId,
        correlationId: context.correlationId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedAppException('federated-identity.samlExchangeCodeInvalid');
    }

    const consumed = await this.transactionRepo.consumeAtomically(tx.id);
    if (!consumed) {
      throw new UnauthorizedAppException('federated-identity.samlExchangeCodeInvalid');
    }

    const payload = safeJsonParseObject<Partial<StoredSamlExchangePayload>>(
      this.encryptionService.decrypt(tx.codeVerifierEncrypted),
      {},
    );
    if (!payload.verified) {
      throw new UnauthorizedAppException('federated-identity.samlExchangeCodeInvalid');
    }

    const { provider } = await this.requireEnabledConfiguredSamlProvider(
      providerCode,
      payload.originalFlowType === 'LINK' ? FEDERATED_FLOW_TYPE.LINK : FEDERATED_FLOW_TYPE.LOGIN,
      context,
    );

    if (payload.originalFlowType === 'LINK') {
      const targetUserId = Number(payload.linkUserId ?? tx.userId ?? 0);
      if (!context.actorUserId || Number(context.actorUserId) !== targetUserId) {
        throw new ForbiddenAppException('federated-identity.linkUserMismatch');
      }
      return this.authFlowService.completeVerifiedProfileLink({
        provider,
        targetUserId,
        verified: payload.verified,
        context,
        startedAtMs,
      });
    }

    const runtimeConfig = resolveFederatedRuntimeConfig(this.settingRegistry);
    return this.authFlowService.completeVerifiedProfileLogin({
      provider,
      tx,
      verified: payload.verified,
      input: {
        deviceName: input.deviceName ?? payload.deviceName ?? undefined,
        trustedDeviceToken: input.trustedDeviceToken,
      },
      context,
      runtimeConfig,
      startedAtMs,
    });
  }

  private async consumeSamlAuthnTransaction(params: {
    readonly providerCode: string;
    readonly inResponseTo: string;
    readonly relayState?: string | undefined;
    readonly now: Date;
  }): Promise<FederatedAuthTransactionEntity> {
    const expectedNonceHash = sha256Hex(params.inResponseTo);
    let tx: FederatedAuthTransactionEntity | null = null;
    if (params.relayState) {
      tx = await this.transactionRepo.findByStateHash(sha256Hex(params.relayState));
    }
    if (!tx) {
      tx = await this.transactionRepo.findByNonceHash(expectedNonceHash);
    }

    if (
      !tx ||
      tx.providerCode !== params.providerCode ||
      tx.nonceHash !== expectedNonceHash ||
      tx.flowType === FEDERATED_FLOW_TYPE.SAML_EXCHANGE
    ) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlInResponseToMismatch',
        stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
        stageErrorCode: 'SAML_IN_RESPONSE_TO_MISMATCH',
        diagnosticMessage: 'SAML InResponseTo does not match an active AuthnRequest transaction',
      });
    }

    if (tx.consumedAt) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlAssertionReplay',
        stage: FEDERATED_AUTH_STAGE.SAML_REPLAY_CHECK,
        stageErrorCode: 'SAML_IN_RESPONSE_TO_REPLAY',
        diagnosticMessage: 'SAML AuthnRequest transaction was already consumed',
      });
    }

    if (tx.expiresAt.getTime() <= params.now.getTime()) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlInResponseToMismatch',
        stage: FEDERATED_AUTH_STAGE.SAML_ASSERTION_VALIDATION,
        stageErrorCode: 'SAML_TRANSACTION_EXPIRED',
        diagnosticMessage: 'SAML AuthnRequest transaction has expired',
      });
    }

    const consumed = await this.transactionRepo.consumeAtomically(tx.id, params.now);
    if (!consumed) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlAssertionReplay',
        stage: FEDERATED_AUTH_STAGE.SAML_REPLAY_CHECK,
        stageErrorCode: 'SAML_IN_RESPONSE_TO_REPLAY',
        diagnosticMessage: 'Concurrent SAML AuthnRequest replay rejected',
      });
    }

    return tx;
  }

  private async requireEnabledConfiguredSamlProvider(
    providerCode: string,
    flowType: FederatedFlowType,
    context: AuthorizeRequestContext,
  ): Promise<{
    readonly provider: FederatedIdentityProviderEntity;
    readonly samlConfig: SamlProviderConfig;
  }> {
    if (this.kernelProviderRegistry.isProviderPaused(PROVIDER_TYPE.IDENTITY, providerCode)) {
      await this.monitoringService.recordEvent({
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
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
    if (provider.driverCode !== FEDERATED_DRIVER_CODE.SAML) {
      throw new BadRequestAppException('federated-identity.unsupportedDriver', [
        { driverCode: provider.driverCode },
      ]);
    }
    if (!provider.isEnabled || provider.status !== FEDERATED_PROVIDER_STATUS.ACTIVE) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'PROVIDER_DISABLED',
        errorMessage: `SAML provider ${providerCode} is disabled`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new ForbiddenAppException('federated-identity.providerDisabled', [{ providerCode }], {
        providerCode,
      });
    }

    if (this.featureFlagRegistry) {
      const ffResult = this.featureFlagRegistry.evaluate(
        FEDERATED_FEATURE_FLAGS.ENTERPRISE_SAML_SSO,
        { userId: context.actorUserId ?? undefined },
      );
      if (!ffResult.enabled && ffResult.reason !== 'FLAG_NOT_FOUND') {
        await this.monitoringService.recordEvent({
          providerId: provider.id,
          providerCode,
          flowType,
          stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
          outcome: FEDERATED_AUTH_OUTCOME.FAILED,
          errorCode: 'ENTERPRISE_SAML_DISABLED',
          errorMessage: `Enterprise SAML SSO feature flag is disabled for ${providerCode}`,
          userId: context.actorUserId ?? null,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
        throw new ForbiddenAppException('federated-identity.enterpriseSamlDisabled');
      }
    }

    const samlConfig = parseSamlConfig(provider.extraConfigJson, provider.providerCode);
    if (!isSamlProviderConfigured(samlConfig)) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.SAML_AUTHN_REQUEST,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'SAML_NOT_CONFIGURED',
        errorMessage: `SAML provider ${providerCode} is missing SP/IdP metadata or certificate`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException('federated-identity.samlNotConfigured', [{ providerCode }], {
        providerCode,
      });
    }

    const eligibleCerts = getEligibleIdpVerificationCerts(
      samlConfig.idpCertificates,
      new Date(),
      samlConfig.clockSkewSeconds,
    );
    if (eligibleCerts.length === 0) {
      await this.monitoringService.recordEvent({
        providerId: provider.id,
        providerCode,
        flowType,
        stage: FEDERATED_AUTH_STAGE.SAML_SIGNATURE,
        outcome: FEDERATED_AUTH_OUTCOME.FAILED,
        errorCode: 'SAML_NO_ELIGIBLE_CERTIFICATE',
        errorMessage: `SAML provider ${providerCode} has no active/transitioning non-expired IdP certificate`,
        userId: context.actorUserId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new BadRequestAppException('federated-identity.samlNotConfigured', [{ providerCode }], {
        providerCode,
      });
    }

    return { provider, samlConfig };
  }

  private async fetchMetadataFromUrl(providerCode: string, metadataUrl: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(metadataUrl);
    } catch {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlMetadataFetchFailed',
        stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
        stageErrorCode: 'SAML_METADATA_INVALID_URL',
        diagnosticMessage: `Malformed SAML metadata URL for ${providerCode}`,
      });
    }

    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    if (protocol !== 'https:' && !(protocol === 'http:' && LOCALHOST_HOSTNAMES.has(hostname))) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlMetadataFetchFailed',
        stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
        stageErrorCode: 'SAML_METADATA_INVALID_URL',
        diagnosticMessage: 'SAML metadata URL must use https (or http only for localhost)',
      });
    }

    try {
      const xml = await this.httpClient.forService('saml-metadata').get<string>(parsed.toString(), {
        headers: { Accept: 'application/samlmetadata+xml, application/xml, text/xml' },
        responseType: 'text',
      });
      return typeof xml === 'string' ? xml : '';
    } catch (err) {
      throw new FederatedStageError({
        i18nKey: 'federated-identity.samlMetadataFetchFailed',
        stage: FEDERATED_AUTH_STAGE.SAML_METADATA,
        stageErrorCode: 'SAML_METADATA_FETCH_FAILED',
        diagnosticMessage:
          err instanceof Error ? err.message : 'Failed to fetch SAML metadata XML',
      });
    }
  }

  private resolveTargetRedirectUri(
    provider: FederatedIdentityProviderEntity,
    tx: FederatedAuthTransactionEntity | null,
    globalAllowlist: readonly string[],
  ): string {
    const providerAllowlist = safeJsonParseStringArray(provider.allowedRedirectUrisJson);
    const candidate = tx?.redirectUri || providerAllowlist[0] || globalAllowlist[0] || '';
    return assertRedirectUriAllowed(candidate, providerAllowlist, globalAllowlist);
  }

  private appendQueryParams(baseUrl: string, params: Record<string, string>): string {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  }
}
