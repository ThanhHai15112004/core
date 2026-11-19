import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createPaginatedResult, maskIp } from '@packages/http/index.js';
import {
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  defaultProviderRegistry,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import {
  PlatformSecurityService,
  SECURITY_ALERT_SEVERITY,
  SECURITY_EVENT_TYPE,
} from '@packages/security/index.js';
import {
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type ISessionsPublicService,
  SESSIONS_PUBLIC_SERVICE,
} from '@modules/sessions/contracts/index.js';
import type { Counter, Histogram } from 'prom-client';
import {
  FEDERATED_AUTH_OUTCOME,
  FEDERATED_AUTH_STAGE,
  type FederatedAuthOutcome,
  type FederatedAuthStage,
  type FederatedFlowType,
} from '../enum/federated-identity.enum.js';
import {
  redactFederatedMetadata,
  sanitizeFederatedErrorMessage,
} from '../helpers/federated-redaction.helper.js';
import { FederatedAuthEventRepository } from '../repositories/federated-auth-event.repository.js';
import { FederatedIdentityProviderRepository } from '../repositories/federated-identity-provider.repository.js';
import type { ListMonitoringErrorsQuery } from '../requests/federated-identity.requests.js';
import { FederatedIdentityResponseMapper } from '../responses/federated-identity.response.js';
import type {
  FederatedAuthEventView,
  FederatedMonitoringSummaryView,
  FederatedProviderMonitoringStats,
} from '../types/federated-identity.types.js';

export interface RecordFederatedAuthEventInput {
  readonly providerId?: number | null | undefined;
  readonly providerCode: string;
  readonly flowType: FederatedFlowType | string;
  readonly stage: FederatedAuthStage | string;
  readonly outcome: FederatedAuthOutcome;
  readonly errorCode?: string | null | undefined;
  readonly providerError?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly httpStatus?: number | null | undefined;
  readonly durationMs?: number | undefined;
  readonly userId?: number | null | undefined;
  readonly identityId?: number | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

const SECURITY_SENSITIVE_ERROR_CODES = new Set([
  'STATE_REPLAY_DETECTED',
  'STATE_NOT_FOUND',
  'PROVIDER_MISMATCH',
  'NONCE_MISMATCH',
  'MISSING_NONCE',
  'INVALID_SIGNATURE',
  'UNSUPPORTED_ALG',
  'INVALID_ISSUER',
  'INVALID_AUDIENCE',
]);

@Injectable()
export class FederatedMonitoringService {
  private readonly logger = new Logger(FederatedMonitoringService.name);
  private readonly attemptsCounter: Counter<'provider' | 'flow' | 'outcome'> | null;
  private readonly failuresCounter: Counter<'provider' | 'stage' | 'reason'> | null;
  private readonly durationHistogram: Histogram<'provider' | 'operation'> | null;
  private readonly kernelProviderRegistry: KernelProviderRegistryService;

  constructor(
    private readonly eventRepo: FederatedAuthEventRepository,
    private readonly providerRepo: FederatedIdentityProviderRepository,
    @Optional() metrics?: MetricsRegistryService,
    @Optional() private readonly platformSecurity?: PlatformSecurityService,
    @Optional()
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsPublicService?: ISessionsPublicService,
    @Optional() kernelProviderRegistry?: KernelProviderRegistryService,
  ) {
    this.kernelProviderRegistry = kernelProviderRegistry ?? defaultProviderRegistry;
    if (metrics) {
      this.attemptsCounter = metrics.counter(
        'federated_auth_attempts_total',
        'Total external OAuth authentication and linking attempts',
        ['provider', 'flow', 'outcome'],
      );
      this.failuresCounter = metrics.counter(
        'federated_auth_failures_total',
        'Total external OAuth failures by provider, stage and reason',
        ['provider', 'stage', 'reason'],
      );
      this.durationHistogram = metrics.histogram(
        'federated_auth_provider_duration_seconds',
        'External OAuth provider exchange and verification latency in seconds',
        ['provider', 'operation'],
      );
    } else {
      this.attemptsCounter = null;
      this.failuresCounter = null;
      this.durationHistogram = null;
    }
  }

  public observeProviderDuration(
    providerCode: string,
    operation: string,
    durationMs: number,
  ): void {
    const cleanProvider = providerCode.trim().toLowerCase() || 'unknown';
    const cleanOp = operation.trim().toLowerCase() || 'unknown';
    this.durationHistogram?.observe(
      { provider: cleanProvider, operation: cleanOp },
      Math.max(0, durationMs) / 1000,
    );
  }

  public async recordEvent(input: RecordFederatedAuthEventInput): Promise<void> {
    const providerCode = input.providerCode.trim().toLowerCase() || 'unknown';
    const flowType = String(input.flowType).toUpperCase();
    const stage = String(input.stage).toUpperCase();
    const outcome = input.outcome;
    const errorCode = input.errorCode?.trim() ? input.errorCode.trim().toUpperCase() : null;
    const providerError = input.providerError?.trim()
      ? input.providerError.trim().slice(0, 120)
      : null;
    const durationMs = Math.max(0, Math.trunc(input.durationMs ?? 0));

    this.attemptsCounter?.inc({
      provider: providerCode,
      flow: flowType,
      outcome,
    });

    if (outcome === FEDERATED_AUTH_OUTCOME.FAILED) {
      this.failuresCounter?.inc({
        provider: providerCode,
        stage,
        reason: errorCode ?? providerError ?? 'UNKNOWN',
      });
    }

    const ctx = RequestContextService.current();
    const correlationId = input.correlationId ?? ctx?.correlationId ?? null;
    const requestId = input.requestId ?? ctx?.requestId ?? correlationId;
    const rawIp = input.ipAddress ?? ctx?.ipAddress ?? null;
    const sourceIpMasked = rawIp ? maskIp(rawIp) : null;
    const safeMetadata = input.metadata ? redactFederatedMetadata(input.metadata) : null;
    const safeMessage = sanitizeFederatedErrorMessage(input.errorMessage);

    if (this.kernelProviderRegistry.hasProvidersOfType(PROVIDER_TYPE.IDENTITY)) {
      void this.kernelProviderRegistry.recordInvocation({
        providerType: PROVIDER_TYPE.IDENTITY,
        providerCode,
        success: outcome === FEDERATED_AUTH_OUTCOME.SUCCESS,
        latencyMs: durationMs,
        errorCode: outcome === FEDERATED_AUTH_OUTCOME.SUCCESS ? null : (errorCode ?? providerError),
        errorMessage: safeMessage,
      });
    }

    try {
      await this.eventRepo.saveEntity({
        eventUid: randomUUID(),
        providerCode,
        flowType,
        stage,
        outcome,
        errorCode,
        providerError,
        errorMessage: safeMessage,
        httpStatus: input.httpStatus ?? null,
        durationMs,
        userId: input.userId ?? null,
        identityId: input.identityId ?? null,
        requestId,
        correlationId,
        sourceIpMasked,
        metadataRedactedJson: safeMetadata ? JSON.stringify(safeMetadata) : null,
        occurredAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist federated_auth_events record for provider=${providerCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (input.providerId) {
      try {
        if (outcome === FEDERATED_AUTH_OUTCOME.SUCCESS) {
          await this.providerRepo.updateTelemetry(input.providerId, {
            lastSuccessAt: new Date(),
          });
        } else {
          await this.providerRepo.updateTelemetry(input.providerId, {
            lastErrorAt: new Date(),
            lastErrorCode: errorCode ?? providerError ?? 'OAUTH_ERROR',
          });
        }
      } catch {
        // Telemetry timestamp update is best-effort
      }
    }

    if (outcome === FEDERATED_AUTH_OUTCOME.FAILED) {
      this.logger.warn(
        `[FEDERATED_AUTH_FAILED] provider=${providerCode} flow=${flowType} stage=${stage} errorCode=${errorCode ?? 'NONE'} providerError=${providerError ?? 'NONE'} status=${input.httpStatus ?? 'N/A'} durationMs=${durationMs}`,
      );

      if (
        stage === FEDERATED_AUTH_STAGE.STATE_PKCE ||
        stage === FEDERATED_AUTH_STAGE.ID_TOKEN_VERIFY ||
        (errorCode && SECURITY_SENSITIVE_ERROR_CODES.has(errorCode))
      ) {
        await this.platformSecurity
          ?.recordSecurityEvent({
            eventType: SECURITY_EVENT_TYPE.LOGIN_FAILED,
            severity: SECURITY_ALERT_SEVERITY.HIGH,
            targetUserId: input.userId ?? null,
            identifier: `oauth:${providerCode}`,
            module: 'federated-identity',
            feature: 'oauth',
            action: stage,
            ipAddress: rawIp,
            userAgent: input.userAgent ?? null,
            reason: `${errorCode ?? 'OAUTH_SECURITY_FAILURE'}${providerError ? ` (${providerError})` : ''}`,
            metadata: {
              providerCode,
              flowType,
              stage,
              errorCode,
              providerError,
            },
          })
          .catch(() => undefined);
      }

      if (input.userId && this.sessionsPublicService) {
        await this.sessionsPublicService
          .recordAuthEvent({
            userId: input.userId,
            actorId: input.userId,
            identifier: `oauth:${providerCode}`,
            eventType: AUTH_EVENT_TYPE.OAUTH_LOGIN_FAILED,
            status: AUTH_EVENT_STATUS.FAILED,
            ipAddress: rawIp,
            userAgent: input.userAgent ?? null,
            reason: `${stage}: ${errorCode ?? providerError ?? 'OAuth failed'}`,
            metadata: {
              providerCode,
              flowType,
              stage,
              errorCode,
              providerError,
            },
          })
          .catch(() => undefined);
      }
    }
  }

  public async listEvents(
    query: Partial<ListMonitoringErrorsQuery> = {},
  ): Promise<PaginatedResult<FederatedAuthEventView>> {
    const paged = await this.eventRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      providerCode: query.providerCode,
      stage: query.stage,
      outcome: query.outcome,
      errorCode: query.errorCode,
    });
    return createPaginatedResult(
      paged.data.map((ev) => FederatedIdentityResponseMapper.toAuthEventView(ev)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getSummary(
    windowHours = 24,
    providerCode?: string,
  ): Promise<FederatedMonitoringSummaryView> {
    const safeHours = Math.max(1, Math.min(720, Math.trunc(windowHours)));
    const since = new Date(Date.now() - safeHours * 3_600_000);
    const events = await this.eventRepo.findEventsSince(since, providerCode);

    let successCount = 0;
    let failureCount = 0;
    let totalDurationMs = 0;

    const providerMap = new Map<
      string,
      {
        total: number;
        success: number;
        failure: number;
        durationSum: number;
        lastSuccessAt: string | null;
        lastFailureAt: string | null;
        lastErrorCode: string | null;
      }
    >();
    const stageMap = new Map<string, number>();
    const errorMap = new Map<
      string,
      { errorCode: string; providerError: string | null; count: number; lastOccurredAt: string }
    >();

    for (const ev of events) {
      const occurredIso =
        ev.occurredAt instanceof Date
          ? ev.occurredAt.toISOString()
          : new Date(ev.occurredAt).toISOString();
      const duration = Number(ev.durationMs ?? 0);
      totalDurationMs += duration;

      const pKey = ev.providerCode;
      const acc = providerMap.get(pKey) ?? {
        total: 0,
        success: 0,
        failure: 0,
        durationSum: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCode: null,
      };
      acc.total += 1;
      acc.durationSum += duration;

      if (ev.outcome === FEDERATED_AUTH_OUTCOME.SUCCESS) {
        successCount += 1;
        acc.success += 1;
        if (!acc.lastSuccessAt || occurredIso > acc.lastSuccessAt) {
          acc.lastSuccessAt = occurredIso;
        }
      } else {
        failureCount += 1;
        acc.failure += 1;
        if (!acc.lastFailureAt || occurredIso > acc.lastFailureAt) {
          acc.lastFailureAt = occurredIso;
          acc.lastErrorCode = ev.errorCode ?? ev.providerError ?? 'OAUTH_ERROR';
        }
        stageMap.set(ev.stage, (stageMap.get(ev.stage) ?? 0) + 1);

        const eKey = `${ev.errorCode ?? 'UNKNOWN'}::${ev.providerError ?? ''}`;
        const errAcc = errorMap.get(eKey);
        if (errAcc) {
          errAcc.count += 1;
          if (occurredIso > errAcc.lastOccurredAt) {
            errAcc.lastOccurredAt = occurredIso;
          }
        } else {
          errorMap.set(eKey, {
            errorCode: ev.errorCode ?? 'UNKNOWN',
            providerError: ev.providerError ?? null,
            count: 1,
            lastOccurredAt: occurredIso,
          });
        }
      }

      providerMap.set(pKey, acc);
    }

    const totalAttempts = events.length;
    const errorRatePercent =
      totalAttempts > 0 ? Math.round((failureCount / totalAttempts) * 10_000) / 100 : 0;
    const avgDurationMs = totalAttempts > 0 ? Math.round(totalDurationMs / totalAttempts) : 0;

    const byProvider: FederatedProviderMonitoringStats[] = Array.from(providerMap.entries()).map(
      ([code, acc]) => ({
        providerCode: code,
        totalAttempts: acc.total,
        successCount: acc.success,
        failureCount: acc.failure,
        errorRatePercent: acc.total > 0 ? Math.round((acc.failure / acc.total) * 10_000) / 100 : 0,
        avgDurationMs: acc.total > 0 ? Math.round(acc.durationSum / acc.total) : 0,
        lastSuccessAt: acc.lastSuccessAt,
        lastFailureAt: acc.lastFailureAt,
        lastErrorCode: acc.lastErrorCode,
      }),
    );

    const byStage = Array.from(stageMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    const topErrors = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      windowHours: safeHours,
      since: since.toISOString(),
      totalAttempts,
      successCount,
      failureCount,
      errorRatePercent,
      avgDurationMs,
      byProvider,
      byStage,
      topErrors,
    };
  }
}
