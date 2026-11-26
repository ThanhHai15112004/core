import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CoreConfigService } from '@packages/config/index.js';
import {
  DR_DOMAIN_EVENTS,
  DomainEventBusService,
  defaultDomainEventBus,
  type DrDomainEventName,
} from '@packages/kernel/index.js';
import {
  INCIDENTS_OPS_PUBLIC_SERVICE,
  type IIncidentsOpsPublicService,
} from '@modules/incidents-ops/contracts/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';

export interface DrAlertPayload {
  readonly eventName: DrDomainEventName;
  readonly alertCode: string;
  readonly title: string;
  readonly description: string;
  readonly severity: 'P1' | 'P2' | 'P3';
  readonly aggregateId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Điều phối cảnh báo Disaster Recovery:
 * - Ghi log qua Pino
 * - Phát Domain Event trên DomainEventBusService
 * - Tạo / gộp Incident trên `incidents-ops` (nếu có)
 * - Gửi Notification tới quản trị viên (nếu có)
 */
@Injectable()
export class DrAlertService {
  private readonly logger = new Logger(DrAlertService.name);
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

  public async publishEvent(
    eventName: DrDomainEventName,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.eventBus.publish({
        type: eventName,
        dotName: eventName,
        sourceModule: 'dr-ops',
        aggregateType,
        aggregateId,
        payload: {
          environment: this.config.app.env,
          ...payload,
        },
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to publish DR domain event ${eventName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  public async emitAlert(input: DrAlertPayload): Promise<{
    eventPublished: boolean;
    incidentCreated: boolean;
    notificationDispatched: boolean;
  }> {
    if (input.severity === 'P1') {
      this.logger.error(`[DrAlert:${input.alertCode}] ${input.title} — ${input.description}`);
    } else {
      this.logger.warn(`[DrAlert:${input.alertCode}] ${input.title} — ${input.description}`);
    }

    const eventPublished = await this.publishEvent(
      input.eventName,
      'DrProfile',
      input.aggregateId ?? 'DEFAULT',
      {
        alertCode: input.alertCode,
        title: input.title,
        description: input.description,
        severity: input.severity,
        ...(input.metadata ?? {}),
      },
    );

    let incidentCreated = false;
    const incidentsOps = this.resolveIncidentsOps();
    if (incidentsOps && input.eventName !== DR_DOMAIN_EVENTS.PROFILE_UPDATED) {
      try {
        await incidentsOps.ingestAlert({
          source: 'METRICS',
          alertCode: input.alertCode,
          title: input.title,
          description: input.description,
          severityHint: input.severity,
          fingerprint: `dr:${input.alertCode}:${input.aggregateId ?? 'DEFAULT'}`,
          module: 'dr-ops',
          metadata: input.metadata ?? {},
        });
        incidentCreated = true;
      } catch (err) {
        this.logger.warn(
          `Failed to ingest DR incident ${input.alertCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let notificationDispatched = false;
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
          actionUrl: '/system-console/dr',
          referenceModule: 'dr-ops',
          referenceType: 'DR_ALERT',
          referenceId: input.aggregateId ?? input.alertCode,
          metadata: input.metadata ?? null,
          forceDeliver: true,
        });
        notificationDispatched = true;
      } catch (err) {
        this.logger.warn(
          `Failed to dispatch DR alert notification: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { eventPublished, incidentCreated, notificationDispatched };
  }
}
