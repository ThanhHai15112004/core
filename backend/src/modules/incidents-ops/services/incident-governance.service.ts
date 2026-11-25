import { Injectable, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseStringArray,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import {
  ALL_INCIDENT_SEVERITIES,
  DEFAULT_RESOLUTION_SLA_MINUTES,
  DEFAULT_RESPONSE_SLA_MINUTES,
  type IncidentSeverity,
} from '../enum/incidents-ops.enum.js';
import {
  AlertOwnerMappingDuplicateException,
  AlertOwnerMappingNotFoundException,
  AlertOwnerRequiredException,
  IncidentPolicyNotFoundException,
  IncidentRunbookCodeDuplicateException,
  IncidentRunbookNotFoundException,
} from '../exceptions/incidents-ops.exceptions.js';
import {
  normalizeIncidentSeverity,
  resolveIncidentsRuntimeConfig,
} from '../helpers/incident-ops.helper.js';
import {
  AlertOwnerMappingRepository,
  type ListOwnerMappingsFilter,
} from '../repositories/alert-owner-mapping.repository.js';
import {
  IncidentRunbookRepository,
  type ListRunbooksFilter,
} from '../repositories/incident-runbook.repository.js';
import { IncidentSeverityPolicyRepository } from '../repositories/incident-severity-policy.repository.js';
import type {
  CreateOwnerMappingRequest,
  CreateRunbookRequest,
  UpdateOwnerMappingRequest,
  UpdateRunbookRequest,
  UpdateSeverityPolicyRequest,
} from '../requests/incidents-ops.requests.js';
import { IncidentsOpsResponseMapper } from '../responses/incidents-ops.response.js';
import type {
  AlertOwnerMappingView,
  IncidentRunbookView,
  IncidentSeverityPolicyView,
} from '../types/incidents-ops.types.js';

export interface ResolvedAlertRouting {
  readonly severity: IncidentSeverity;
  readonly ownerUserId: number;
  readonly backupOwnerUserId: number | null;
  readonly runbookId: number | null;
  readonly notifyChannels: string[];
  readonly responseSlaMinutes: number;
}

@Injectable()
export class IncidentGovernanceService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly policyRepo: IncidentSeverityPolicyRepository,
    private readonly runbookRepo: IncidentRunbookRepository,
    private readonly ownerMappingRepo: AlertOwnerMappingRepository,
    private readonly txManager: TransactionManager,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async listSeverityPolicies(): Promise<IncidentSeverityPolicyView[]> {
    const rows = await this.policyRepo.listAll();
    if (rows.length > 0) {
      return rows.map((r) => IncidentsOpsResponseMapper.toPolicyView(r));
    }
    const nowIso = new Date().toISOString();
    return ALL_INCIDENT_SEVERITIES.map((severity, idx) => ({
      id: idx + 1,
      severity,
      name: `${severity} Policy`,
      description: null,
      responseSlaMinutes: DEFAULT_RESPONSE_SLA_MINUTES[severity],
      resolutionSlaMinutes: DEFAULT_RESOLUTION_SLA_MINUTES[severity],
      autoEscalate: severity === 'P1' || severity === 'P2',
      isSystem: true,
      updatedAt: nowIso,
    }));
  }

  public async updateSeverityPolicy(
    severity: IncidentSeverity,
    input: UpdateSeverityPolicyRequest,
  ): Promise<IncidentSeverityPolicyView> {
    const existing = await this.policyRepo.findBySeverity(severity);
    if (!existing) {
      throw new IncidentPolicyNotFoundException(severity);
    }

    if (input.name !== undefined) existing.name = input.name.trim();
    if (input.description !== undefined) existing.description = input.description?.trim() || null;
    if (input.responseSlaMinutes !== undefined) {
      existing.responseSlaMinutes = input.responseSlaMinutes;
    }
    if (input.resolutionSlaMinutes !== undefined) {
      existing.resolutionSlaMinutes = input.resolutionSlaMinutes;
    }
    if (input.autoEscalate !== undefined) existing.autoEscalate = input.autoEscalate;

    const saved = await this.txManager.runInTransaction(() => this.policyRepo.saveEntity(existing));
    return IncidentsOpsResponseMapper.toPolicyView(saved);
  }

  public async listRunbooks(
    filter: ListRunbooksFilter,
  ): Promise<PaginatedResult<IncidentRunbookView>> {
    const page = await this.runbookRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => IncidentsOpsResponseMapper.toRunbookView(item)),
    };
  }

  public async getRunbookById(id: number): Promise<IncidentRunbookView> {
    const entity = await this.runbookRepo.findByIdSafe(id);
    if (!entity) throw new IncidentRunbookNotFoundException(id);
    return IncidentsOpsResponseMapper.toRunbookView(entity);
  }

  public async createRunbook(
    input: CreateRunbookRequest,
    actorUserId?: number,
  ): Promise<IncidentRunbookView> {
    const code = input.code.trim().toUpperCase();
    const existing = await this.runbookRepo.findByCode(code);
    if (existing) throw new IncidentRunbookCodeDuplicateException(code);

    const saved = await this.txManager.runInTransaction(() =>
      this.runbookRepo.saveEntity({
        code,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        alertCode: input.alertCode?.trim() || null,
        defaultSeverity: input.defaultSeverity,
        triageStepsJson: JSON.stringify(input.triageSteps),
        mitigationStepsJson: JSON.stringify(input.mitigationSteps),
        verificationStepsJson: input.verificationSteps
          ? JSON.stringify(input.verificationSteps)
          : null,
        isActive: input.isActive ?? true,
        isSystem: false,
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      }),
    );
    return IncidentsOpsResponseMapper.toRunbookView(saved);
  }

  public async updateRunbook(
    id: number,
    input: UpdateRunbookRequest,
    actorUserId?: number,
  ): Promise<IncidentRunbookView> {
    const entity = await this.runbookRepo.findByIdSafe(id);
    if (!entity) throw new IncidentRunbookNotFoundException(id);

    if (input.title !== undefined) entity.title = input.title.trim();
    if (input.description !== undefined) entity.description = input.description?.trim() || null;
    if (input.alertCode !== undefined) entity.alertCode = input.alertCode?.trim() || null;
    if (input.defaultSeverity !== undefined) entity.defaultSeverity = input.defaultSeverity;
    if (input.triageSteps !== undefined) entity.triageStepsJson = JSON.stringify(input.triageSteps);
    if (input.mitigationSteps !== undefined) {
      entity.mitigationStepsJson = JSON.stringify(input.mitigationSteps);
    }
    if (input.verificationSteps !== undefined) {
      entity.verificationStepsJson = JSON.stringify(input.verificationSteps);
    }
    if (input.isActive !== undefined) entity.isActive = input.isActive;
    entity.updatedBy = actorUserId ?? entity.updatedBy;

    const saved = await this.txManager.runInTransaction(() => this.runbookRepo.saveEntity(entity));
    return IncidentsOpsResponseMapper.toRunbookView(saved);
  }

  public async deleteRunbook(id: number): Promise<{ deleted: true; id: number }> {
    const entity = await this.runbookRepo.findByIdSafe(id);
    if (!entity) throw new IncidentRunbookNotFoundException(id);

    await this.txManager.runInTransaction(() => this.runbookRepo.repository.softDelete(id));
    return { deleted: true, id };
  }

  public async listOwnerMappings(
    filter: ListOwnerMappingsFilter,
  ): Promise<PaginatedResult<AlertOwnerMappingView>> {
    const page = await this.ownerMappingRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => IncidentsOpsResponseMapper.toOwnerMappingView(item)),
    };
  }

  public async createOwnerMapping(
    input: CreateOwnerMappingRequest,
    actorUserId?: number,
  ): Promise<AlertOwnerMappingView> {
    if (!input.ownerUserId || input.ownerUserId < 1) {
      throw new AlertOwnerRequiredException();
    }
    const alertCode = input.alertCode.trim().toUpperCase();
    const existing = await this.ownerMappingRepo.findByAlertCode(alertCode);
    if (existing) throw new AlertOwnerMappingDuplicateException(alertCode);

    if (input.runbookId !== undefined && input.runbookId !== null) {
      const rb = await this.runbookRepo.findByIdSafe(input.runbookId);
      if (!rb) throw new IncidentRunbookNotFoundException(input.runbookId);
    }

    const saved = await this.txManager.runInTransaction(() =>
      this.ownerMappingRepo.saveEntity({
        alertCode,
        alertName: input.alertName.trim(),
        source: input.source,
        defaultSeverity: input.defaultSeverity,
        ownerUserId: input.ownerUserId,
        backupOwnerUserId: input.backupOwnerUserId ?? null,
        runbookId: input.runbookId ?? null,
        notifyChannelsJson: input.notifyChannels
          ? JSON.stringify(input.notifyChannels)
          : JSON.stringify(['IN_APP']),
        isEnabled: input.isEnabled ?? true,
        isSystem: false,
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      }),
    );
    return IncidentsOpsResponseMapper.toOwnerMappingView(saved);
  }

  public async updateOwnerMapping(
    id: number,
    input: UpdateOwnerMappingRequest,
    actorUserId?: number,
  ): Promise<AlertOwnerMappingView> {
    const entity = await this.ownerMappingRepo.findByIdSafe(id);
    if (!entity) throw new AlertOwnerMappingNotFoundException(id);

    if (input.ownerUserId !== undefined) {
      if (!input.ownerUserId || input.ownerUserId < 1) {
        throw new AlertOwnerRequiredException();
      }
      entity.ownerUserId = input.ownerUserId;
    }
    if (input.alertName !== undefined) entity.alertName = input.alertName.trim();
    if (input.source !== undefined) entity.source = input.source;
    if (input.defaultSeverity !== undefined) entity.defaultSeverity = input.defaultSeverity;
    if (input.backupOwnerUserId !== undefined) {
      entity.backupOwnerUserId = input.backupOwnerUserId;
    }
    if (input.runbookId !== undefined) {
      if (input.runbookId !== null) {
        const rb = await this.runbookRepo.findByIdSafe(input.runbookId);
        if (!rb) throw new IncidentRunbookNotFoundException(input.runbookId);
      }
      entity.runbookId = input.runbookId;
    }
    if (input.notifyChannels !== undefined) {
      entity.notifyChannelsJson = JSON.stringify(input.notifyChannels);
    }
    if (input.isEnabled !== undefined) entity.isEnabled = input.isEnabled;
    entity.updatedBy = actorUserId ?? entity.updatedBy;

    const saved = await this.txManager.runInTransaction(() =>
      this.ownerMappingRepo.saveEntity(entity),
    );
    return IncidentsOpsResponseMapper.toOwnerMappingView(saved);
  }

  public async deleteOwnerMapping(id: number): Promise<{ deleted: true; id: number }> {
    const entity = await this.ownerMappingRepo.findByIdSafe(id);
    if (!entity) throw new AlertOwnerMappingNotFoundException(id);

    await this.txManager.runInTransaction(() => this.ownerMappingRepo.repository.softDelete(id));
    return { deleted: true, id };
  }

  /**
   * Định tuyến cảnh báo: đảm bảo 100% cảnh báo có `ownerUserId`, gắn `P1..P4` SLA và `runbookId` tương ứng.
   */
  public async resolveAlertRouting(
    alertCode: string,
    severityHint?: string | null,
  ): Promise<ResolvedAlertRouting> {
    const config = resolveIncidentsRuntimeConfig(this.settingRegistry);
    const normalizedCode = alertCode.trim().toUpperCase();
    const mapping = await this.ownerMappingRepo.findByAlertCode(normalizedCode);

    const activeMapping = mapping && mapping.isEnabled ? mapping : null;
    const severity = normalizeIncidentSeverity(
      severityHint ?? activeMapping?.defaultSeverity,
      activeMapping?.defaultSeverity ?? 'P2',
    );
    const ownerUserId =
      activeMapping && activeMapping.ownerUserId > 0
        ? Number(activeMapping.ownerUserId)
        : config.defaultOwnerUserId;
    const backupOwnerUserId =
      activeMapping?.backupOwnerUserId && activeMapping.backupOwnerUserId > 0
        ? Number(activeMapping.backupOwnerUserId)
        : null;

    let runbookId = activeMapping?.runbookId ? Number(activeMapping.runbookId) : null;
    if (!runbookId) {
      const matchedRunbook = await this.runbookRepo.findActiveByAlertCode(normalizedCode);
      runbookId = matchedRunbook ? Number(matchedRunbook.id) : null;
    }

    const policy = await this.policyRepo.findBySeverity(severity);
    const responseSlaMinutes = policy?.responseSlaMinutes ?? DEFAULT_RESPONSE_SLA_MINUTES[severity];
    const notifyChannels = activeMapping
      ? safeJsonParseStringArray(activeMapping.notifyChannelsJson)
      : ['IN_APP'];

    return {
      severity,
      ownerUserId,
      backupOwnerUserId,
      runbookId,
      notifyChannels: notifyChannels.length > 0 ? notifyChannels : ['IN_APP'],
      responseSlaMinutes,
    };
  }
}
