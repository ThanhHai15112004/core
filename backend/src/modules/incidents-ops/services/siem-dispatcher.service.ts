import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { HTTP_CLIENT_TOKEN, type HttpClientContract } from '@packages/http-client/index.js';
import {
  DomainEventBusService,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultSettingRegistry,
  type DomainEvent,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import {
  PlatformSecurityService,
  type ISecurityEventSink,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
} from '@packages/security/index.js';
import {
  INCIDENTS_OPS_EVENTS,
  INCIDENT_SOURCE,
  SIEM_DISPATCH_STATUS,
  SIEM_DRIVER,
  type SiemDispatchStatus,
  type SiemDriver,
} from '../enum/incidents-ops.enum.js';
import { InvalidSiemEndpointException } from '../exceptions/incidents-ops.exceptions.js';
import {
  formatSiemDispatchRequest,
  isValidSiemEndpointUrl,
  maskSiemEndpoint,
  resolveIncidentsRuntimeConfig,
} from '../helpers/incident-ops.helper.js';
import {
  SiemDispatchLogRepository,
  type ListSiemLogsFilter,
} from '../repositories/siem-dispatch-log.repository.js';
import { IncidentsOpsResponseMapper } from '../responses/incidents-ops.response.js';
import type { SiemDispatchLogView } from '../types/incidents-ops.types.js';
import { IncidentLifecycleService } from './incident-lifecycle.service.js';

const SECURITY_SINK_NAME = 'incidents-ops-siem-sink';
const METRICS_EVENT_HANDLER_ID = 'incidents-ops.metrics-alert-listener';

const FORWARDED_SECURITY_EVENTS = new Set<string>([
  'LOGIN_FAILED',
  'PERMISSION_CHANGED',
  'DATA_EXPORT',
  'MFA_DISABLED',
  'TOKEN_REUSE_DETECTED',
  'RATE_LIMIT_EXCEEDED',
  'PASSWORD_CHANGED',
  'LOGOUT_ALL',
]);

@Injectable()
export class SiemDispatcherService implements OnModuleInit, OnModuleDestroy, ISecurityEventSink {
  public readonly name = SECURITY_SINK_NAME;
  private readonly logger = new Logger(SiemDispatcherService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly siemLogRepo: SiemDispatchLogRepository,
    private readonly lifecycleService: IncidentLifecycleService,
    private readonly txManager: TransactionManager,
    @Optional() private readonly platformSecurity?: PlatformSecurityService,
    @Optional() @Inject(HTTP_CLIENT_TOKEN) private readonly httpClient?: HttpClientContract,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public onModuleInit(): void {
    this.platformSecurity?.registerSecurityEventSink(this);
    this.eventBus.registerHandler({
      id: METRICS_EVENT_HANDLER_ID,
      module: 'incidents-ops',
      eventPattern: 'metrics.alert.fired',
      handler: (evt) => this.handleMetricsAlertFired(evt),
    });
  }

  public onModuleDestroy(): void {
    this.platformSecurity?.unregisterSecurityEventSink(SECURITY_SINK_NAME);
    this.eventBus.unregisterHandler(METRICS_EVENT_HANDLER_ID);
  }

  public async listLogs(filter: ListSiemLogsFilter): Promise<PaginatedResult<SiemDispatchLogView>> {
    const page = await this.siemLogRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => IncidentsOpsResponseMapper.toSiemDispatchLogView(item)),
    };
  }

  /**
   * Hook được gọi tự động từ `PlatformSecurityService.recordSecurityEvent`.
   * 1. Gửi sự kiện bảo mật (LOGIN_FAILED, PERMISSION_CHANGED, DATA_EXPORT...) sang SIEM.
   * 2. Nếu phát sinh `SecurityAnomalyAlert`, tự động nạp vào `IncidentLifecycleService` (dedup + gán owner + SLA + runbook).
   */
  public async onSecurityEvent(
    event: SecurityEventRecord,
    alert: SecurityAnomalyAlert | null,
  ): Promise<void> {
    const shouldForward = Boolean(alert) || FORWARDED_SECURITY_EVENTS.has(event.eventTypeName);
    if (!shouldForward) return;

    const dispatchResult = await this.dispatchPayload({
      eventType: event.eventTypeName,
      alertCode: alert?.alertCode ?? null,
      severity: alert?.severityName ?? event.severityName,
      actorUserId: event.actorUserId,
      ipAddress: event.ipAddress,
      payload: {
        kind: alert ? 'SECURITY_ANOMALY_ALERT' : 'SECURITY_EVENT',
        eventType: event.eventTypeName,
        alertCode: alert?.alertCode ?? null,
        anomalyType: alert?.anomalyType ?? null,
        severity: alert?.severityName ?? event.severityName,
        module: event.module,
        action: event.action,
        actorUserId: event.actorUserId,
        targetUserId: event.targetUserId,
        identifier: event.identifier,
        ipAddress: event.ipAddress,
        reason: alert?.description ?? event.reason,
        exportedRowCount: event.exportedRowCount,
        requestId: event.requestId,
        correlationId: event.correlationId,
        occurredAt: event.createdAt,
        metadata: alert?.metadata ?? event.metadata ?? {},
      },
    });

    if (alert) {
      try {
        const ingested = await this.lifecycleService.ingestAlert({
          source: INCIDENT_SOURCE.SIEM,
          alertCode: alert.alertCode,
          title: alert.title,
          description: alert.description,
          severityHint: alert.severityName,
          actorUserId: alert.actorUserId,
          targetUserId: alert.targetUserId,
          ipAddress: alert.ipAddress,
          module: alert.module,
          metadata: {
            ...alert.metadata,
            eventType: event.eventTypeName,
            requestId: event.requestId,
            correlationId: event.correlationId,
          },
          siemDeliveryStatus: {
            status: dispatchResult.status,
            driver: dispatchResult.driver,
            destination: dispatchResult.destination,
            dispatchedAt: dispatchResult.dispatchedAt,
          },
        });

        if (dispatchResult.logId !== undefined) {
          const logId = dispatchResult.logId;
          await this.txManager
            .runInTransaction(() =>
              this.siemLogRepo.saveEntity({
                id: logId,
                incidentId: ingested.incident.id,
              }),
            )
            .catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to ingest SIEM alert ${alert.alertCode} into incidents-ops: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Gửi sự kiện kiểm tra kết nối SIEM thủ công từ Console / API. */
  public async testConnection(override?: {
    driver?: SiemDriver | undefined;
    endpoint?: string | undefined;
    authToken?: string | undefined;
  }): Promise<SiemDispatchLogView> {
    const config = resolveIncidentsRuntimeConfig(this.settingRegistry);
    const driver = override?.driver ?? config.siemDriver;
    const endpoint = (override?.endpoint ?? config.siemEndpoint).trim();
    const authToken = (override?.authToken ?? config.siemAuthToken).trim();

    if (driver !== SIEM_DRIVER.INTERNAL_LOG && (!endpoint || !isValidSiemEndpointUrl(endpoint))) {
      throw new InvalidSiemEndpointException();
    }

    const res = await this.dispatchPayload(
      {
        eventType: 'SIEM_CONNECTIVITY_TEST',
        alertCode: 'SIEM_TEST',
        severity: 'INFO',
        actorUserId: null,
        ipAddress: '127.0.0.1',
        payload: {
          kind: 'SIEM_TEST',
          message: 'Core Incident & SIEM Manager connectivity verification',
          occurredAt: new Date().toISOString(),
        },
      },
      {
        forceEnabled: true,
        driver,
        endpoint,
        authToken,
      },
    );

    if (res.savedEntity) {
      return IncidentsOpsResponseMapper.toSiemDispatchLogView(res.savedEntity);
    }

    return {
      id: 0,
      eventType: 'SIEM_CONNECTIVITY_TEST',
      alertCode: 'SIEM_TEST',
      severity: 'INFO',
      driver: res.driver,
      destination: res.destination,
      status: res.status,
      httpStatus: res.httpStatus,
      attemptCount: 1,
      errorMessage: res.errorMessage,
      payload: null,
      incidentId: null,
      actorUserId: null,
      ipAddress: '127.0.0.1',
      dispatchedAt: res.dispatchedAt,
    };
  }

  private async dispatchPayload(
    input: {
      eventType: string;
      alertCode: string | null;
      severity: string;
      actorUserId: number | null;
      ipAddress: string | null;
      payload: Record<string, unknown>;
    },
    override?: {
      forceEnabled?: boolean;
      driver?: SiemDriver;
      endpoint?: string;
      authToken?: string;
    },
  ): Promise<{
    status: SiemDispatchStatus;
    driver: SiemDriver;
    destination: string;
    httpStatus: number | null;
    errorMessage: string | null;
    dispatchedAt: string;
    logId?: number;
    savedEntity?: Awaited<ReturnType<SiemDispatchLogRepository['saveEntity']>>;
  }> {
    const config = resolveIncidentsRuntimeConfig(this.settingRegistry);
    const enabled = override?.forceEnabled ?? config.siemEnabled;
    const driver = override?.driver ?? config.siemDriver;
    const endpoint = (override?.endpoint ?? config.siemEndpoint).trim();
    const authToken = (override?.authToken ?? config.siemAuthToken).trim();
    const now = new Date();

    let status: SiemDispatchStatus = SIEM_DISPATCH_STATUS.SENT;
    let destination = 'internal-siem-logger';
    let httpStatus: number | null = null;
    let errorMessage: string | null = null;

    const useExternalHttp =
      enabled &&
      driver !== SIEM_DRIVER.INTERNAL_LOG &&
      endpoint.length > 0 &&
      isValidSiemEndpointUrl(endpoint) &&
      Boolean(this.httpClient);

    if (useExternalHttp && this.httpClient) {
      destination = maskSiemEndpoint(endpoint) ?? endpoint.slice(0, 255);
      const req = formatSiemDispatchRequest({
        driver,
        endpoint,
        authToken,
        payload: input.payload,
      });
      try {
        const response = await this.httpClient.requestRaw('POST', req.url, JSON.parse(req.body), {
          headers: req.headers,
          timeoutMs: 5000,
        });
        httpStatus = response.status;
        if (response.status >= 400) {
          status = SIEM_DISPATCH_STATUS.FAILED;
          errorMessage = `HTTP ${response.status} from SIEM endpoint`;
        }
      } catch (err) {
        status = SIEM_DISPATCH_STATUS.FAILED;
        errorMessage = err instanceof Error ? err.message.slice(0, 490) : String(err).slice(0, 490);
        this.logger.warn(
          `SIEM HTTP dispatch failed (${driver} -> ${destination}): ${errorMessage}`,
        );
      }
    } else {
      this.logger.log(
        `[SIEM_EVENT] type=${input.eventType} alert=${input.alertCode ?? 'NONE'} severity=${input.severity} actor=${input.actorUserId ?? 'anonymous'} ip=${input.ipAddress ?? 'unknown'}`,
      );
    }

    let savedEntity: Awaited<ReturnType<SiemDispatchLogRepository['saveEntity']>> | undefined;
    if (this.siemLogRepo.isDatabaseReady()) {
      try {
        savedEntity = await this.txManager.runInTransaction(() =>
          this.siemLogRepo.saveEntity({
            eventType: input.eventType,
            alertCode: input.alertCode,
            severity: input.severity,
            driver: useExternalHttp ? driver : SIEM_DRIVER.INTERNAL_LOG,
            destination,
            status,
            httpStatus,
            attemptCount: 1,
            errorMessage,
            payloadJson: JSON.stringify(input.payload),
            actorUserId: input.actorUserId,
            ipAddress: input.ipAddress,
            dispatchedAt: now,
          }),
        );
      } catch {
        // Non-blocking audit log save
      }
    }

    try {
      await this.eventBus.publish({
        type: INCIDENTS_OPS_EVENTS.SIEM_DISPATCHED,
        dotName: INCIDENTS_OPS_EVENTS.SIEM_DISPATCHED,
        sourceModule: 'incidents-ops',
        aggregateType: 'siem_dispatch',
        aggregateId: String(savedEntity?.id ?? input.eventType),
        payload: {
          eventType: input.eventType,
          alertCode: input.alertCode,
          severity: input.severity,
          status,
          destination,
        },
      });
    } catch {
      // Non-blocking
    }

    return {
      status,
      driver: useExternalHttp ? driver : SIEM_DRIVER.INTERNAL_LOG,
      destination,
      httpStatus,
      errorMessage,
      dispatchedAt: now.toISOString(),
      ...(savedEntity ? { logId: Number(savedEntity.id), savedEntity } : {}),
    };
  }

  private async handleMetricsAlertFired(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    const severity = typeof payload['severity'] === 'string' ? payload['severity'] : 'WARNING';
    if (severity !== 'CRITICAL' && severity !== 'WARNING') return;

    const ruleCode =
      typeof payload['ruleCode'] === 'string' ? payload['ruleCode'] : 'METRICS_ALERT';
    const ruleName = typeof payload['ruleName'] === 'string' ? payload['ruleName'] : ruleCode;
    const summary = typeof payload['summary'] === 'string' ? payload['summary'] : ruleName;
    const fingerprint =
      typeof payload['fingerprint'] === 'string' ? payload['fingerprint'] : undefined;

    await this.lifecycleService
      .ingestAlert({
        source: INCIDENT_SOURCE.METRICS,
        alertCode: ruleCode,
        title: ruleName,
        description: summary,
        severityHint: severity === 'CRITICAL' ? 'P1' : 'P3',
        fingerprint,
        metadata: payload,
      })
      .catch(() => undefined);
  }
}
