import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import {
  DomainEventBusService,
  SequenceRegistryService,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';
import {
  INCIDENTS_OPS_EVENTS,
  INCIDENT_STATUS,
  POSTMORTEM_STATUS,
  type IncidentStatus,
} from '../enum/incidents-ops.enum.js';
import {
  IncidentInvalidTransitionException,
  IncidentNotFoundException,
  IncidentPostmortemNotFoundException,
  IncidentRootCauseRequiredException,
} from '../exceptions/incidents-ops.exceptions.js';
import {
  allocateIncidentCode,
  appendIncidentTimeline,
  buildIncidentFingerprint,
  computeSlaDueAt,
  maskSiemEndpoint,
  resolveIncidentsRuntimeConfig,
} from '../helpers/incident-ops.helper.js';
import {
  IncidentPostmortemRepository,
  type ListPostmortemsFilter,
} from '../repositories/incident-postmortem.repository.js';
import { IncidentRunbookRepository } from '../repositories/incident-runbook.repository.js';
import {
  IncidentRepository,
  type ListIncidentsFilter,
} from '../repositories/incident.repository.js';
import { SiemDispatchLogRepository } from '../repositories/siem-dispatch-log.repository.js';
import type {
  CreateIncidentRequest,
  UpsertPostmortemRequest,
} from '../requests/incidents-ops.requests.js';
import { IncidentsOpsResponseMapper } from '../responses/incidents-ops.response.js';
import type {
  IncidentDetailView,
  IncidentPostmortemView,
  IncidentView,
  IncidentsOverviewView,
  IngestIncidentAlertInput,
  PreventiveActionItem,
} from '../types/incidents-ops.types.js';
import { IncidentGovernanceService } from './incident-governance.service.js';

@Injectable()
export class IncidentLifecycleService {
  private readonly logger = new Logger(IncidentLifecycleService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly incidentRepo: IncidentRepository,
    private readonly postmortemRepo: IncidentPostmortemRepository,
    private readonly runbookRepo: IncidentRunbookRepository,
    private readonly siemLogRepo: SiemDispatchLogRepository,
    private readonly governanceService: IncidentGovernanceService,
    private readonly txManager: TransactionManager,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notifications?: INotificationsPublicService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async getOverview(): Promise<IncidentsOverviewView> {
    const config = resolveIncidentsRuntimeConfig(this.settingRegistry);
    const [stats, siem24h] = await Promise.all([
      this.incidentRepo.getStatsSnapshot(),
      this.siemLogRepo.countLast24h(),
    ]);

    return {
      ...stats,
      siem: {
        enabled: config.siemEnabled,
        driver: config.siemDriver,
        endpointMasked: maskSiemEndpoint(config.siemEndpoint),
        sentLast24h: siem24h.sent,
        failedLast24h: siem24h.failed,
      },
    };
  }

  public async listIncidents(filter: ListIncidentsFilter): Promise<PaginatedResult<IncidentView>> {
    const page = await this.incidentRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => IncidentsOpsResponseMapper.toIncidentView(item)),
    };
  }

  public async listRepeatedAlerts(limit = 20): Promise<IncidentView[]> {
    const items = await this.incidentRepo.listRepeatedTop(limit);
    return items.map((item) => IncidentsOpsResponseMapper.toIncidentView(item));
  }

  public async getIncidentDetail(id: number): Promise<IncidentDetailView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);

    const [runbook, postmortem] = await Promise.all([
      entity.runbookId ? this.runbookRepo.findByIdSafe(Number(entity.runbookId)) : null,
      this.postmortemRepo.findByIncidentId(Number(entity.id)),
    ]);

    return IncidentsOpsResponseMapper.toIncidentDetailView(entity, runbook, postmortem);
  }

  public async createManualIncident(
    input: CreateIncidentRequest,
    actorUserId?: number,
  ): Promise<IncidentView> {
    const result = await this.ingestAlert({
      source: input.source,
      alertCode: input.alertCode,
      title: input.title,
      description: input.description ?? null,
      severityHint: input.severity,
      fingerprint: input.fingerprint,
      actorUserId: actorUserId ?? null,
      metadata: input.metadata,
    });
    return result.incident;
  }

  /**
   * Tiếp nhận cảnh báo từ SIEM / Metrics / Manual:
   * - Gộp cảnh báo lặp trong cửa sổ `dedupWindowMinutes` theo `fingerprint` (giảm alert noise).
   * - Tự động gán người phụ trách (không để alert vô chủ), tính SLA `P1–P4` và gắn Runbook.
   */
  public async ingestAlert(input: IngestIncidentAlertInput): Promise<{
    readonly incident: IncidentView;
    readonly deduplicated: boolean;
  }> {
    const now = new Date();
    const config = resolveIncidentsRuntimeConfig(this.settingRegistry);
    const fingerprint = buildIncidentFingerprint(input);
    const dedupSince = new Date(now.getTime() - config.dedupWindowMinutes * 60_000);

    const existing = await this.incidentRepo.findActiveByFingerprint(fingerprint, dedupSince);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.suppressedCount += 1;
      existing.isRepeated = true;
      existing.lastSeenAt = now;
      if (existing.slaDueAt && now.getTime() > new Date(existing.slaDueAt).getTime()) {
        existing.slaBreached = true;
      }
      if (input.siemDeliveryStatus) {
        existing.siemDeliveryStatusJson = JSON.stringify(input.siemDeliveryStatus);
      }
      existing.timelineJson = appendIncidentTimeline(existing.timelineJson, {
        at: now.toISOString(),
        action: 'REPEATED_ALERT_GROUPED',
        actorUserId: input.actorUserId ?? null,
        note: `Repeated alert grouped (#${existing.occurrenceCount}, suppressed=${existing.suppressedCount})`,
      });

      const saved = await this.txManager.runInTransaction(() =>
        this.incidentRepo.saveEntity(existing),
      );
      const view = IncidentsOpsResponseMapper.toIncidentView(saved);
      await this.publishIncidentEvent(INCIDENTS_OPS_EVENTS.INCIDENT_REPEATED, view);
      return { incident: view, deduplicated: true };
    }

    const routing = await this.governanceService.resolveAlertRouting(
      input.alertCode,
      input.severityHint,
    );
    const incidentCode = await allocateIncidentCode(this.sequenceRegistry);
    const slaDueAt = computeSlaDueAt(now, routing.severity, routing.responseSlaMinutes);

    const saved = await this.txManager.runInTransaction(() =>
      this.incidentRepo.saveEntity({
        incidentCode,
        title: input.title.trim().slice(0, 240),
        description: input.description?.trim() || null,
        source: input.source,
        alertCode: input.alertCode.trim().toUpperCase(),
        fingerprint,
        severity: routing.severity,
        status: INCIDENT_STATUS.OPEN,
        ownerUserId: routing.ownerUserId,
        runbookId: routing.runbookId,
        occurrenceCount: 1,
        suppressedCount: 0,
        isRepeated: false,
        firstSeenAt: now,
        lastSeenAt: now,
        slaDueAt,
        slaBreached: false,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        siemDeliveryStatusJson: input.siemDeliveryStatus
          ? JSON.stringify(input.siemDeliveryStatus)
          : null,
        timelineJson: appendIncidentTimeline(null, {
          at: now.toISOString(),
          action: 'INCIDENT_CREATED',
          actorUserId: input.actorUserId ?? null,
          note: `Assigned owner #${routing.ownerUserId}, severity=${routing.severity}, SLA=${routing.responseSlaMinutes}m`,
        }),
      }),
    );

    const view = IncidentsOpsResponseMapper.toIncidentView(saved);
    await this.notifyIncidentOwner(view, routing.backupOwnerUserId);
    await this.publishIncidentEvent(INCIDENTS_OPS_EVENTS.INCIDENT_CREATED, view);
    return { incident: view, deduplicated: false };
  }

  public async acknowledge(
    id: number,
    input?: { note?: string | undefined; actorUserId?: number | undefined },
  ): Promise<IncidentView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);
    if (entity.status === INCIDENT_STATUS.RESOLVED || entity.status === INCIDENT_STATUS.CLOSED) {
      throw new IncidentInvalidTransitionException(entity.status, INCIDENT_STATUS.ACKNOWLEDGED);
    }

    const now = new Date();
    if (entity.status === INCIDENT_STATUS.OPEN) {
      entity.status = INCIDENT_STATUS.ACKNOWLEDGED;
    }
    entity.acknowledgedAt = entity.acknowledgedAt ?? now;
    entity.acknowledgedBy = input?.actorUserId ?? entity.acknowledgedBy ?? null;
    if (entity.slaDueAt && now.getTime() > new Date(entity.slaDueAt).getTime()) {
      entity.slaBreached = true;
    }
    entity.timelineJson = appendIncidentTimeline(entity.timelineJson, {
      at: now.toISOString(),
      action: 'INCIDENT_ACKNOWLEDGED',
      actorUserId: input?.actorUserId ?? null,
      note: input?.note ?? null,
    });

    const saved = await this.txManager.runInTransaction(() => this.incidentRepo.saveEntity(entity));
    const view = IncidentsOpsResponseMapper.toIncidentView(saved);
    await this.publishIncidentEvent(INCIDENTS_OPS_EVENTS.INCIDENT_ACKNOWLEDGED, view);
    return view;
  }

  public async mitigate(
    id: number,
    input: { mitigationSummary: string; actorUserId?: number | undefined },
  ): Promise<IncidentView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);
    if (entity.status === INCIDENT_STATUS.RESOLVED || entity.status === INCIDENT_STATUS.CLOSED) {
      throw new IncidentInvalidTransitionException(entity.status, INCIDENT_STATUS.MITIGATED);
    }

    const now = new Date();
    entity.status = INCIDENT_STATUS.MITIGATED;
    entity.mitigatedAt = now;
    entity.mitigatedBy = input.actorUserId ?? null;
    entity.mitigationSummary = input.mitigationSummary.trim();
    entity.acknowledgedAt = entity.acknowledgedAt ?? now;
    entity.acknowledgedBy = entity.acknowledgedBy ?? input.actorUserId ?? null;
    entity.timelineJson = appendIncidentTimeline(entity.timelineJson, {
      at: now.toISOString(),
      action: 'INCIDENT_MITIGATED',
      actorUserId: input.actorUserId ?? null,
      note: entity.mitigationSummary,
    });

    const saved = await this.txManager.runInTransaction(() => this.incidentRepo.saveEntity(entity));
    const view = IncidentsOpsResponseMapper.toIncidentView(saved);
    await this.publishIncidentEvent(INCIDENTS_OPS_EVENTS.INCIDENT_MITIGATED, view);
    return view;
  }

  public async resolve(
    id: number,
    input: {
      rootCause: string;
      mitigationSummary: string;
      resolutionNote?: string | undefined;
      actorUserId?: number | undefined;
    },
  ): Promise<IncidentView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);
    if (entity.status === INCIDENT_STATUS.CLOSED) {
      throw new IncidentInvalidTransitionException(entity.status, INCIDENT_STATUS.RESOLVED);
    }

    const rootCause = input.rootCause.trim();
    const mitigationSummary = input.mitigationSummary.trim();
    if (!rootCause || !mitigationSummary) {
      throw new IncidentRootCauseRequiredException();
    }

    const now = new Date();
    const firstSeenMs =
      entity.firstSeenAt instanceof Date
        ? entity.firstSeenAt.getTime()
        : new Date(String(entity.firstSeenAt)).getTime();
    const recoverySeconds = Math.max(0, Math.round((now.getTime() - firstSeenMs) / 1000));

    entity.status = INCIDENT_STATUS.RESOLVED;
    entity.acknowledgedAt = entity.acknowledgedAt ?? now;
    entity.mitigatedAt = entity.mitigatedAt ?? now;
    entity.resolvedAt = now;
    entity.resolvedBy = input.actorUserId ?? null;
    entity.recoverySeconds = recoverySeconds;
    entity.rootCause = rootCause;
    entity.mitigationSummary = mitigationSummary;
    entity.resolutionNote = input.resolutionNote?.trim() || null;
    entity.timelineJson = appendIncidentTimeline(entity.timelineJson, {
      at: now.toISOString(),
      action: 'INCIDENT_RESOLVED',
      actorUserId: input.actorUserId ?? null,
      note: `MTTR=${recoverySeconds}s | ${rootCause}`,
    });

    const saved = await this.txManager.runInTransaction(() => this.incidentRepo.saveEntity(entity));
    const view = IncidentsOpsResponseMapper.toIncidentView(saved);
    await this.publishIncidentEvent(INCIDENTS_OPS_EVENTS.INCIDENT_RESOLVED, view);
    return view;
  }

  public async close(
    id: number,
    input?: { note?: string | undefined; actorUserId?: number | undefined },
  ): Promise<IncidentView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);
    if (entity.status !== INCIDENT_STATUS.RESOLVED) {
      throw new IncidentInvalidTransitionException(entity.status, INCIDENT_STATUS.CLOSED);
    }

    const now = new Date();
    entity.status = INCIDENT_STATUS.CLOSED;
    entity.timelineJson = appendIncidentTimeline(entity.timelineJson, {
      at: now.toISOString(),
      action: 'INCIDENT_CLOSED',
      actorUserId: input?.actorUserId ?? null,
      note: input?.note ?? null,
    });

    const saved = await this.txManager.runInTransaction(() => this.incidentRepo.saveEntity(entity));
    return IncidentsOpsResponseMapper.toIncidentView(saved);
  }

  public async assignOwner(
    id: number,
    input: { ownerUserId: number; note?: string | undefined; actorUserId?: number | undefined },
  ): Promise<IncidentView> {
    const entity = await this.incidentRepo.findByIdSafe(id);
    if (!entity) throw new IncidentNotFoundException(id);

    const prevOwner = entity.ownerUserId;
    entity.ownerUserId = input.ownerUserId;
    entity.timelineJson = appendIncidentTimeline(entity.timelineJson, {
      at: new Date().toISOString(),
      action: 'OWNER_REASSIGNED',
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? `Owner changed from #${prevOwner} to #${input.ownerUserId}`,
    });

    const saved = await this.txManager.runInTransaction(() => this.incidentRepo.saveEntity(entity));
    return IncidentsOpsResponseMapper.toIncidentView(saved);
  }

  public async listPostmortems(
    filter: ListPostmortemsFilter,
  ): Promise<PaginatedResult<IncidentPostmortemView>> {
    const page = await this.postmortemRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => IncidentsOpsResponseMapper.toPostmortemView(item)),
    };
  }

  public async getPostmortem(incidentId: number): Promise<IncidentPostmortemView> {
    const pm = await this.postmortemRepo.findByIncidentId(incidentId);
    if (!pm) throw new IncidentPostmortemNotFoundException(incidentId);
    return IncidentsOpsResponseMapper.toPostmortemView(pm);
  }

  public async upsertPostmortem(
    incidentId: number,
    input: UpsertPostmortemRequest,
  ): Promise<IncidentPostmortemView> {
    const incident = await this.incidentRepo.findByIdSafe(incidentId);
    if (!incident) throw new IncidentNotFoundException(incidentId);

    const preventiveActions: PreventiveActionItem[] = input.preventiveActions.map((a) => ({
      id: a.id ?? randomUUID().slice(0, 8),
      title: a.title.trim(),
      ownerUserId: a.ownerUserId ?? null,
      dueDate: a.dueDate ?? null,
      status: a.status,
    }));

    const existing = await this.postmortemRepo.findByIncidentId(incidentId);
    const saved = await this.txManager.runInTransaction(() =>
      this.postmortemRepo.saveEntity({
        ...(existing ? { id: existing.id } : {}),
        incidentId,
        incidentCode: incident.incidentCode,
        title: input.title.trim(),
        summary: input.summary.trim(),
        impactSummary: input.impactSummary?.trim() || null,
        rootCauseAnalysis: input.rootCauseAnalysis.trim(),
        lessonsLearned: input.lessonsLearned.trim(),
        preventiveActionsJson: JSON.stringify(preventiveActions),
        status: existing?.status ?? POSTMORTEM_STATUS.DRAFT,
        authorId: input.authorId ?? existing?.authorId ?? null,
        publishedAt: existing?.publishedAt ?? null,
      }),
    );

    return IncidentsOpsResponseMapper.toPostmortemView(saved);
  }

  public async publishPostmortem(
    incidentId: number,
    actorUserId?: number,
  ): Promise<IncidentPostmortemView> {
    const pm = await this.postmortemRepo.findByIncidentId(incidentId);
    if (!pm) throw new IncidentPostmortemNotFoundException(incidentId);

    const now = new Date();
    pm.status = POSTMORTEM_STATUS.PUBLISHED;
    pm.publishedAt = pm.publishedAt ?? now;
    pm.authorId = pm.authorId ?? actorUserId ?? null;

    const saved = await this.txManager.runInTransaction(() => this.postmortemRepo.saveEntity(pm));
    const view = IncidentsOpsResponseMapper.toPostmortemView(saved);

    try {
      await this.eventBus.publish({
        type: INCIDENTS_OPS_EVENTS.POSTMORTEM_PUBLISHED,
        dotName: INCIDENTS_OPS_EVENTS.POSTMORTEM_PUBLISHED,
        sourceModule: 'incidents-ops',
        aggregateType: 'incident_postmortem',
        aggregateId: String(view.id),
        payload: { ...view },
      });
    } catch {
      // Do not fail publish if bus handler throws
    }
    return view;
  }

  private async notifyIncidentOwner(
    incident: IncidentView,
    backupOwnerUserId: number | null,
  ): Promise<void> {
    if (!this.notifications) return;
    const recipientIds = new Set<number>([incident.ownerUserId]);
    if (incident.severity === 'P1' && backupOwnerUserId && backupOwnerUserId > 0) {
      recipientIds.add(backupOwnerUserId);
    }
    for (const userId of recipientIds) {
      try {
        await this.notifications.dispatch({
          title: `[${incident.severity}] ${incident.incidentCode}: ${incident.title}`,
          content:
            incident.description ??
            `Incident ${incident.incidentCode} (${incident.alertCode}) requires attention.`,
          category: 'SYSTEM',
          priority: incident.severity === 'P1' ? 'URGENT' : 'HIGH',
          targetType: 'USER_GROUP',
          userIds: [userId],
          channels:
            incident.severity === 'P1' || incident.severity === 'P2'
              ? ['IN_APP', 'EMAIL']
              : ['IN_APP'],
          referenceModule: 'incidents-ops',
          referenceType: 'incident',
          referenceId: String(incident.id),
          forceDeliver: incident.severity === 'P1',
        });
      } catch (err) {
        this.logger.warn(
          `Failed to notify owner #${userId} for incident ${incident.incidentCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async publishIncidentEvent(
    eventType: string,
    incident: IncidentView,
    extraStatus?: IncidentStatus,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        type: eventType,
        dotName: eventType,
        sourceModule: 'incidents-ops',
        aggregateType: 'incident',
        aggregateId: String(incident.id),
        payload: {
          ...incident,
          ...(extraStatus ? { status: extraStatus } : {}),
        },
      });
    } catch {
      // Non-blocking domain event publish
    }
  }
}
