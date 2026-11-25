import {
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { AlertOwnerMappingEntity } from '../entities/alert-owner-mapping.entity.js';
import type { IncidentPostmortemEntity } from '../entities/incident-postmortem.entity.js';
import type { IncidentRunbookEntity } from '../entities/incident-runbook.entity.js';
import type { IncidentSeverityPolicyEntity } from '../entities/incident-severity-policy.entity.js';
import type { IncidentEntity } from '../entities/incident.entity.js';
import type { SiemDispatchLogEntity } from '../entities/siem-dispatch-log.entity.js';
import type {
  AlertOwnerMappingView,
  IncidentDetailView,
  IncidentPostmortemView,
  IncidentRunbookView,
  IncidentSeverityPolicyView,
  IncidentTimelineEntry,
  IncidentView,
  PreventiveActionItem,
  SiemDispatchLogView,
} from '../types/incidents-ops.types.js';

export class IncidentsOpsResponseMapper {
  public static toPolicyView(entity: IncidentSeverityPolicyEntity): IncidentSeverityPolicyView {
    return {
      id: Number(entity.id),
      severity: entity.severity,
      name: entity.name,
      description: entity.description,
      responseSlaMinutes: entity.responseSlaMinutes,
      resolutionSlaMinutes: entity.resolutionSlaMinutes,
      autoEscalate: entity.autoEscalate,
      isSystem: entity.isSystem,
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  public static toRunbookView(entity: IncidentRunbookEntity): IncidentRunbookView {
    return {
      id: Number(entity.id),
      code: entity.code,
      title: entity.title,
      description: entity.description,
      alertCode: entity.alertCode,
      defaultSeverity: entity.defaultSeverity,
      triageSteps: safeJsonParseStringArray(entity.triageStepsJson),
      mitigationSteps: safeJsonParseStringArray(entity.mitigationStepsJson),
      verificationSteps: safeJsonParseStringArray(entity.verificationStepsJson),
      isActive: entity.isActive,
      isSystem: entity.isSystem,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  public static toOwnerMappingView(entity: AlertOwnerMappingEntity): AlertOwnerMappingView {
    return {
      id: Number(entity.id),
      alertCode: entity.alertCode,
      alertName: entity.alertName,
      source: entity.source,
      defaultSeverity: entity.defaultSeverity,
      ownerUserId: Number(entity.ownerUserId),
      backupOwnerUserId:
        entity.backupOwnerUserId !== null ? Number(entity.backupOwnerUserId) : null,
      runbookId: entity.runbookId !== null ? Number(entity.runbookId) : null,
      notifyChannels: safeJsonParseStringArray(entity.notifyChannelsJson),
      isEnabled: entity.isEnabled,
      isSystem: entity.isSystem,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  public static toIncidentView(entity: IncidentEntity): IncidentView {
    const firstSeenAt =
      entity.firstSeenAt instanceof Date
        ? entity.firstSeenAt
        : new Date(String(entity.firstSeenAt));
    const lastSeenAt =
      entity.lastSeenAt instanceof Date ? entity.lastSeenAt : new Date(String(entity.lastSeenAt));
    const slaDueAt = entity.slaDueAt
      ? entity.slaDueAt instanceof Date
        ? entity.slaDueAt
        : new Date(String(entity.slaDueAt))
      : null;

    const isActive =
      entity.status === 'OPEN' || entity.status === 'ACKNOWLEDGED' || entity.status === 'MITIGATED';
    const dynamicBreached =
      entity.slaBreached || (isActive && slaDueAt !== null && slaDueAt.getTime() < Date.now());

    return {
      id: Number(entity.id),
      incidentCode: entity.incidentCode,
      title: entity.title,
      description: entity.description,
      source: entity.source,
      alertCode: entity.alertCode,
      fingerprint: entity.fingerprint,
      severity: entity.severity,
      status: entity.status,
      ownerUserId: Number(entity.ownerUserId),
      runbookId: entity.runbookId !== null ? Number(entity.runbookId) : null,
      occurrenceCount: entity.occurrenceCount,
      suppressedCount: entity.suppressedCount,
      isRepeated: entity.isRepeated,
      firstSeenAt: firstSeenAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
      slaDueAt: slaDueAt ? slaDueAt.toISOString() : null,
      slaBreached: dynamicBreached,
      acknowledgedAt: entity.acknowledgedAt ? new Date(entity.acknowledgedAt).toISOString() : null,
      acknowledgedBy: entity.acknowledgedBy !== null ? Number(entity.acknowledgedBy) : null,
      mitigatedAt: entity.mitigatedAt ? new Date(entity.mitigatedAt).toISOString() : null,
      mitigatedBy: entity.mitigatedBy !== null ? Number(entity.mitigatedBy) : null,
      resolvedAt: entity.resolvedAt ? new Date(entity.resolvedAt).toISOString() : null,
      resolvedBy: entity.resolvedBy !== null ? Number(entity.resolvedBy) : null,
      recoverySeconds: entity.recoverySeconds,
      rootCause: entity.rootCause,
      mitigationSummary: entity.mitigationSummary,
      resolutionNote: entity.resolutionNote,
      metadata: entity.metadataJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.metadataJson)
        : null,
      timeline: safeJsonParse<IncidentTimelineEntry[]>(entity.timelineJson, []) ?? [],
      siemDeliveryStatus: entity.siemDeliveryStatusJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.siemDeliveryStatusJson)
        : null,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  public static toIncidentDetailView(
    entity: IncidentEntity,
    runbook: IncidentRunbookEntity | null,
    postmortem: IncidentPostmortemEntity | null,
  ): IncidentDetailView {
    return {
      ...IncidentsOpsResponseMapper.toIncidentView(entity),
      runbook: runbook ? IncidentsOpsResponseMapper.toRunbookView(runbook) : null,
      postmortem: postmortem ? IncidentsOpsResponseMapper.toPostmortemView(postmortem) : null,
    };
  }

  public static toPostmortemView(entity: IncidentPostmortemEntity): IncidentPostmortemView {
    return {
      id: Number(entity.id),
      incidentId: Number(entity.incidentId),
      incidentCode: entity.incidentCode,
      title: entity.title,
      summary: entity.summary,
      impactSummary: entity.impactSummary,
      rootCauseAnalysis: entity.rootCauseAnalysis,
      lessonsLearned: entity.lessonsLearned,
      preventiveActions:
        safeJsonParse<PreventiveActionItem[]>(entity.preventiveActionsJson, []) ?? [],
      status: entity.status,
      authorId: entity.authorId !== null ? Number(entity.authorId) : null,
      publishedAt: entity.publishedAt ? new Date(entity.publishedAt).toISOString() : null,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt),
      updatedAt:
        entity.updatedAt instanceof Date
          ? entity.updatedAt.toISOString()
          : String(entity.updatedAt),
    };
  }

  public static toSiemDispatchLogView(entity: SiemDispatchLogEntity): SiemDispatchLogView {
    return {
      id: Number(entity.id),
      eventType: entity.eventType,
      alertCode: entity.alertCode,
      severity: entity.severity,
      driver: entity.driver,
      destination: entity.destination,
      status: entity.status,
      httpStatus: entity.httpStatus,
      attemptCount: entity.attemptCount,
      errorMessage: entity.errorMessage,
      payload: entity.payloadJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.payloadJson)
        : null,
      incidentId: entity.incidentId !== null ? Number(entity.incidentId) : null,
      actorUserId: entity.actorUserId !== null ? Number(entity.actorUserId) : null,
      ipAddress: entity.ipAddress,
      dispatchedAt:
        entity.dispatchedAt instanceof Date
          ? entity.dispatchedAt.toISOString()
          : String(entity.dispatchedAt),
    };
  }
}
