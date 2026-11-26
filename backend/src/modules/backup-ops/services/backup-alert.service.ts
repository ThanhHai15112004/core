import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BACKUP_DOMAIN_EVENTS,
  DomainEventBusService,
  defaultDomainEventBus,
} from '@packages/kernel/index.js';
import {
  INCIDENTS_OPS_PUBLIC_SERVICE,
  type IIncidentsOpsPublicService,
} from '@modules/incidents-ops/contracts/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';

export interface BackupAlertPayload {
  readonly eventName:
    | typeof BACKUP_DOMAIN_EVENTS.FAILED
    | typeof BACKUP_DOMAIN_EVENTS.STALE
    | typeof BACKUP_DOMAIN_EVENTS.DRILL_FAILED;
  readonly alertCode: string;
  readonly title: string;
  readonly description: string;
  readonly severity: 'P1' | 'P2' | 'P3';
  readonly backupCode?: string | null;
  readonly policyCode?: string | null;
  readonly targetType?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Điều phối cảnh báo khi Backup / Verify Drill thất bại hoặc bị quá hạn (stale):
 * - Ghi log mức error/warn qua Pino
 * - Phát Domain Event trên DomainEventBusService
 * - Tạo / gộp Incident trên `incidents-ops` (nếu module được nạp)
 * - Gửi Notification tới quản trị viên (`ADMIN` / `SYSTEM_ADMIN`) nếu `notifications` khả dụng
 */
@Injectable()
export class BackupAlertService {
  private readonly logger = new Logger(BackupAlertService.name);
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: CoreConfigService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  private resolveIncidentsOps(): IIncidentsOpsPublicService | null {
    try {
      return this.moduleRef.get<IIncidentsOpsPublicService>(INCIDENTS_OPS_PUBLIC_SERVICE, {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  private resolveNotifications(): INotificationsPublicService | null {
    try {
      return this.moduleRef.get<INotificationsPublicService>(NOTIFICATIONS_PUBLIC_SERVICE, {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  public async emitAlert(input: BackupAlertPayload): Promise<{
    eventPublished: boolean;
    incidentCreated: boolean;
    notificationDispatched: boolean;
  }> {
    this.logger.error(`[BackupAlert:${input.alertCode}] ${input.title} — ${input.description}`);

    let eventPublished = false;
    let incidentCreated = false;
    let notificationDispatched = false;

    try {
      await this.eventBus.publish({
        type: input.eventName,
        dotName: input.eventName,
        sourceModule: 'backup-ops',
        aggregateType: 'BackupPolicy',
        aggregateId: input.policyCode ?? input.backupCode ?? input.alertCode,
        payload: {
          alertCode: input.alertCode,
          title: input.title,
          description: input.description,
          severity: input.severity,
          backupCode: input.backupCode ?? null,
          policyCode: input.policyCode ?? null,
          targetType: input.targetType ?? null,
          environment: this.config.app.env,
          ...(input.metadata ?? {}),
        },
      });
      eventPublished = true;
    } catch (err) {
      this.logger.warn(
        `Failed to publish backup domain event ${input.eventName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const incidentsOps = this.resolveIncidentsOps();
    if (incidentsOps) {
      try {
        await incidentsOps.ingestAlert({
          source: 'METRICS',
          alertCode: input.alertCode,
          title: input.title,
          description: input.description,
          severityHint: input.severity,
          fingerprint: `backup:${input.alertCode}:${input.policyCode ?? input.targetType ?? 'global'}`,
          module: 'backup-ops',
          metadata: {
            backupCode: input.backupCode ?? null,
            policyCode: input.policyCode ?? null,
            targetType: input.targetType ?? null,
            ...(input.metadata ?? {}),
          },
        });
        incidentCreated = true;
      } catch (err) {
        this.logger.warn(
          `Failed to ingest backup incident ${input.alertCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const notifications = this.resolveNotifications();
    if (notifications) {
      try {
        await notifications.dispatch({
          title: input.title,
          content: input.description,
          category: 'SYSTEM',
          priority: input.severity === 'P1' ? 'URGENT' : 'HIGH',
          targetType: 'ROLE',
          roleCodes: ['SUPER_ADMIN', 'ADMIN'],
          channels: ['IN_APP', 'EMAIL'],
          actionUrl: '/system-console/backups',
          referenceModule: 'backup-ops',
          referenceType: 'BACKUP_ALERT',
          referenceId: input.backupCode ?? input.policyCode ?? input.alertCode,
          metadata: input.metadata ?? null,
          forceDeliver: true,
        });
        notificationDispatched = true;
      } catch (err) {
        this.logger.warn(
          `Failed to dispatch backup alert notification: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { eventPublished, incidentCreated, notificationDispatched };
  }
}
