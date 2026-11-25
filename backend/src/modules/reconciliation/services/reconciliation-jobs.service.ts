import { Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  ReconciliationRegistryService,
  SequenceRegistryService,
  defaultReconciliationRegistry,
  defaultSequenceRegistry,
  parseNumericUserId,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type { ReconciliationCatalogView } from '../contracts/index.js';
import type { ReconciliationJobEntity } from '../entities/reconciliation-job.entity.js';
import {
  RECONCILIATION_AUDIT_META,
  RECONCILIATION_SEQUENCE_KEYS,
} from '../enum/reconciliation.enum.js';
import {
  allocateReconciliationCode,
  computeNextRunAt,
} from '../helpers/reconciliation-config.helper.js';
import { ReconciliationJobRepository } from '../repositories/reconciliation-job.repository.js';
import type { ListReconciliationJobsQuery } from '../requests/reconciliation.requests.js';
import { ReconciliationResponseMapper } from '../responses/reconciliation.response.js';
import type {
  CreateReconciliationJobInput,
  ReconciliationJobView,
  UpdateReconciliationJobInput,
} from '../types/reconciliation.types.js';

@Injectable()
export class ReconciliationJobsService {
  private readonly registry: ReconciliationRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly jobRepo: ReconciliationJobRepository,
    @Optional() registry?: ReconciliationRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.registry = registry ?? defaultReconciliationRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
  }

  public getCatalog(): ReconciliationCatalogView {
    return {
      adapters: this.registry.listAdapters(),
      repairHandlers: this.registry.listRepairHandlers(),
    };
  }

  public async listJobs(
    query: ListReconciliationJobsQuery,
  ): Promise<PaginatedResult<ReconciliationJobView>> {
    const paged = await this.jobRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => ReconciliationResponseMapper.toJobView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getJobEntityOrThrow(id: number): Promise<ReconciliationJobEntity> {
    const entity = await this.jobRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.jobNotFound', { id });
    }
    return entity;
  }

  public async getJobById(id: number): Promise<ReconciliationJobView> {
    const entity = await this.getJobEntityOrThrow(id);
    return ReconciliationResponseMapper.toJobView(entity);
  }

  public async createJob(
    input: CreateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    const adapterCode = input.adapterCode.trim().toLowerCase();
    const adapter = this.registry.getAdapter(adapterCode);
    if (!adapter) {
      throw new BadRequestAppException('reconciliation.adapterNotFound', [{ adapterCode }]);
    }

    const jobCode = input.jobCode?.trim()
      ? input.jobCode.trim().toUpperCase()
      : await allocateReconciliationCode(
          this.sequenceRegistry,
          RECONCILIATION_SEQUENCE_KEYS.JOB_CODE,
          'RJB',
        );

    const existing = await this.jobRepo.findByJobCode(jobCode);
    if (existing) {
      throw new ConflictAppException('reconciliation.jobCodeAlreadyExists', [{ jobCode }]);
    }

    const actorUserId = parseNumericUserId(actor?.id);
    const scheduleCron = input.scheduleCron?.trim() || null;
    const isEnabled = input.isEnabled ?? true;
    const matchingRules = input.matchingRules ?? adapter.defaultMatchingRules ?? {};

    const saved = await this.jobRepo.saveEntity({
      jobCode,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      adapterCode,
      targetModule: (input.targetModule?.trim() || adapter.targetModule).toLowerCase(),
      scheduleCron,
      isEnabled,
      defaultAssigneeUserId: input.defaultAssigneeUserId ?? null,
      matchingRulesJson: JSON.stringify(matchingRules),
      configJson: JSON.stringify(input.config ?? {}),
      lastRunId: null,
      lastRunAt: null,
      nextRunAt: isEnabled ? computeNextRunAt(scheduleCron) : null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const view = ReconciliationResponseMapper.toJobView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.JOBS,
      action: 'CREATE_JOB',
      resourceType: 'reconciliation_job',
      resourceId: String(view.id),
      beforeData: null,
      afterData: view as unknown as Record<string, unknown>,
      reason: `Created reconciliation job ${view.jobCode}`,
    });

    return view;
  }

  public async updateJob(
    id: number,
    input: UpdateReconciliationJobInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationJobView> {
    const entity = await this.getJobEntityOrThrow(id);
    const beforeView = ReconciliationResponseMapper.toJobView(entity);
    const actorUserId = parseNumericUserId(actor?.id);

    if (input.name !== undefined) {
      entity.name = input.name.trim();
    }
    if (input.description !== undefined) {
      entity.description = input.description?.trim() || null;
    }
    if (input.scheduleCron !== undefined) {
      entity.scheduleCron = input.scheduleCron?.trim() || null;
    }
    if (input.isEnabled !== undefined) {
      entity.isEnabled = input.isEnabled;
    }
    if (input.defaultAssigneeUserId !== undefined) {
      entity.defaultAssigneeUserId = input.defaultAssigneeUserId;
    }
    if (input.matchingRules !== undefined) {
      entity.matchingRulesJson = JSON.stringify(input.matchingRules);
    }
    if (input.config !== undefined) {
      entity.configJson = JSON.stringify(input.config);
    }

    entity.nextRunAt = entity.isEnabled ? computeNextRunAt(entity.scheduleCron) : null;
    entity.updatedBy = actorUserId;

    const saved = await this.jobRepo.saveEntity(entity);
    const afterView = ReconciliationResponseMapper.toJobView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.JOBS,
      action: 'UPDATE_JOB',
      resourceType: 'reconciliation_job',
      resourceId: String(afterView.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: `Updated reconciliation job ${afterView.jobCode}`,
    });

    return afterView;
  }

  public async listDueScheduledJobs(now = new Date()): Promise<ReconciliationJobEntity[]> {
    return this.jobRepo.listDueScheduledJobs(now);
  }
}
