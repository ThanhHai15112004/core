import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  FeatureFlagRegistryService,
  NotFoundAppException,
  type PaginatedResult,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  INCIDENTS_OPS_PUBLIC_SERVICE,
  type IIncidentsOpsPublicService,
} from '@modules/incidents-ops/contracts/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';
import type { PrivilegedTargetType } from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import { mapAlertEntityToView } from '../helpers/privileged-mapper.helper.js';
import { PrivilegedUsageAlertRepository } from '../repositories/privileged-usage-alert.repository.js';
import type {
  AcknowledgeAlertRequest,
  ListPrivilegedAlertsQuery,
} from '../requests/privileged-access.requests.js';
import type { PrivilegedUsageAlertView } from '../types/privileged-access.types.js';

export interface RecordPrivilegedAlertInput {
  readonly eventType: string;
  readonly severity: 'HIGH' | 'CRITICAL' | 'MEDIUM' | 'LOW';
  readonly actorUserId?: number | null | undefined;
  readonly actorUsername?: string | null | undefined;
  readonly targetType?: PrivilegedTargetType | null | undefined;
  readonly targetCode?: string | null | undefined;
  readonly action: string;
  readonly title: string;
  readonly content: string;
  readonly endpoint?: string | null | undefined;
  readonly httpMethod?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly details?: Record<string, unknown> | null | undefined;
  readonly extraRecipients?: readonly string[] | undefined;
  readonly bypassCooldown?: boolean | undefined;
  readonly createIncidentIfCritical?: boolean | undefined;
}

@Injectable()
export class PrivilegedAlertsService {
  private readonly logger = new Logger(PrivilegedAlertsService.name);
  private readonly cooldownCache = new Map<string, number>();

  constructor(
    private readonly alertRepository: PrivilegedUsageAlertRepository,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsService?: INotificationsPublicService,
    @Optional()
    @Inject(INCIDENTS_OPS_PUBLIC_SERVICE)
    private readonly incidentsService?: IIncidentsOpsPublicService,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
    @Optional()
    private readonly featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
  ) {}

  /** Ghi nhận cảnh báo sử dụng quyền đặc biệt và gửi thông báo tới người phụ trách bảo mật */
  public async recordAndDispatchAlert(
    input: RecordPrivilegedAlertInput,
  ): Promise<PrivilegedUsageAlertView | null> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );

    const cooldownKey = `${input.eventType}:${input.actorUserId ?? 'anon'}:${input.targetCode ?? 'none'}:${input.action}`;
    const nowMs = Date.now();
    if (!input.bypassCooldown && cfg.alertCooldownSeconds > 0) {
      const lastMs = this.cooldownCache.get(cooldownKey);
      if (lastMs && nowMs - lastMs < cfg.alertCooldownSeconds * 1000) {
        return null;
      }
    }
    this.cooldownCache.set(cooldownKey, nowMs);
    if (this.cooldownCache.size > 2000) {
      const oldestKey = this.cooldownCache.keys().next().value;
      if (oldestKey) this.cooldownCache.delete(oldestKey);
    }

    const recipientSet = new Set<string>([
      ...cfg.alertRoleCodes.map((r) => `role:${r}`),
      ...(input.extraRecipients ?? []).filter((x) => x.trim().length > 0),
    ]);
    const recipients = [...recipientSet];

    let dispatchId: number | null = null;
    if (this.notificationsService && cfg.alertRoleCodes.length > 0) {
      try {
        const dispatch = await this.notificationsService.dispatch({
          title: input.title,
          content: input.content,
          category: NOTIFICATION_CATEGORY.SECURITY,
          priority:
            input.severity === 'CRITICAL'
              ? NOTIFICATION_PRIORITY.URGENT
              : NOTIFICATION_PRIORITY.HIGH,
          targetType: NOTIFICATION_TARGET_TYPE.ROLE,
          roleCodes: [...cfg.alertRoleCodes],
          referenceModule: 'privileged-access',
          referenceType: input.eventType,
          referenceId: input.targetCode ?? String(input.actorUserId ?? ''),
          metadata: {
            eventType: input.eventType,
            severity: input.severity,
            actorUserId: input.actorUserId ?? null,
            targetType: input.targetType ?? null,
            targetCode: input.targetCode ?? null,
            action: input.action,
            ...(input.details ?? {}),
          },
          forceDeliver: true,
        });
        dispatchId = Number(dispatch.id);
      } catch (err) {
        this.logger.warn(
          `Failed to dispatch PAM security notification: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let incidentId: number | null = null;
    const shouldCreateIncident =
      input.severity === 'CRITICAL' &&
      (input.createIncidentIfCritical ?? cfg.alertCreateIncidentForCritical);
    if (shouldCreateIncident && this.incidentsService) {
      try {
        const ingested = await this.incidentsService.ingestAlert({
          source: 'SIEM',
          alertCode: `PAM_${input.eventType}`,
          title: input.title,
          description: input.content,
          severityHint: 'P1',
          actorUserId: input.actorUserId ?? null,
          ipAddress: input.ipAddress ?? null,
          module: 'privileged-access',
          metadata: {
            eventType: input.eventType,
            targetType: input.targetType ?? null,
            targetCode: input.targetCode ?? null,
            action: input.action,
            ...(input.details ?? {}),
          },
        });
        incidentId = Number(ingested.incident.id);
      } catch (err) {
        this.logger.warn(
          `Failed to ingest PAM incident alert: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const entity = this.alertRepository.create({
      eventType: input.eventType,
      severity: input.severity,
      actorUserId: input.actorUserId ?? null,
      actorUsername: input.actorUsername ?? null,
      targetType: input.targetType ?? null,
      targetCode: input.targetCode ?? null,
      action: input.action,
      endpoint: input.endpoint ?? null,
      httpMethod: input.httpMethod ?? null,
      ipAddress: input.ipAddress ?? null,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
      notifiedRecipientsJson: JSON.stringify(recipients),
      notificationDispatchId: dispatchId,
      incidentId,
      acknowledgedBy: null,
      acknowledgedAt: null,
      acknowledgeNote: null,
    });

    const saved = await this.alertRepository.saveEntity(entity);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_alerts',
          action: `pam.alert.${input.eventType.toLowerCase()}`,
          resourceType: 'privileged_usage_alerts',
          resourceId: String(saved.id),
          actorUserId: input.actorUserId ?? null,
          afterData: {
            eventType: input.eventType,
            severity: input.severity,
            targetCode: input.targetCode ?? null,
            action: input.action,
          },
        })
        .catch(() => undefined);
    }

    return mapAlertEntityToView(saved);
  }

  public async listAlerts(
    query: ListPrivilegedAlertsQuery,
  ): Promise<PaginatedResult<PrivilegedUsageAlertView>> {
    const res = await this.alertRepository.paginateFiltered({
      eventType: query.eventType,
      severity: query.severity,
      actorUserId: query.actorUserId,
      unacknowledgedOnly: query.unacknowledgedOnly,
      page: query.page,
      limit: query.limit,
    });
    return createPaginatedResult(
      res.data.map(mapAlertEntityToView),
      res.meta.total,
      res.meta.page,
      res.meta.limit,
    );
  }

  public async acknowledgeAlert(
    id: number,
    dto: AcknowledgeAlertRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedUsageAlertView> {
    const alert = await this.alertRepository.findById(id);
    if (!alert) {
      throw new NotFoundAppException('privileged-access.alertNotFound');
    }

    alert.acknowledgedBy = actor?.id ?? null;
    alert.acknowledgedAt = new Date();
    alert.acknowledgeNote = dto.note?.trim() || null;
    const saved = await this.alertRepository.saveEntity(alert);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_alerts',
          action: 'pam.alert.acknowledge',
          resourceType: 'privileged_usage_alerts',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            acknowledgedBy: saved.acknowledgedBy,
            acknowledgeNote: saved.acknowledgeNote,
          },
        })
        .catch(() => undefined);
    }

    return mapAlertEntityToView(saved);
  }

  public async countUnacknowledged(): Promise<number> {
    return this.alertRepository.countUnacknowledged();
  }
}
