import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  NotFoundAppException,
  ReconciliationRegistryService,
  SequenceRegistryService,
  SettingRegistryService,
  defaultReconciliationRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  type PaginatedResult,
  type ReconciliationMatchingRules,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';
import type { ScheduledReconciliationTickResult } from '../contracts/index.js';
import type { ReconciliationJobEntity } from '../entities/reconciliation-job.entity.js';
import type { ReconciliationRunEntity } from '../entities/reconciliation-run.entity.js';
import {
  RECONCILIATION_AUDIT_META,
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_EVENTS,
  RECONCILIATION_QUEUE_TOPICS,
  RECONCILIATION_RUN_STATUS,
  RECONCILIATION_SEQUENCE_KEYS,
  RECONCILIATION_SEVERITY,
  RECONCILIATION_TRIGGER_MODE,
  type ReconciliationTriggerMode,
} from '../enum/reconciliation.enum.js';
import {
  allocateReconciliationCode,
  computeNextRunAt,
  resolveReconciliationRuntimeConfig,
} from '../helpers/reconciliation-config.helper.js';
import { runReconciliationComparison } from '../helpers/reconciliation-engine.helper.js';
import { ReconciliationDiscrepancyRepository } from '../repositories/reconciliation-discrepancy.repository.js';
import { ReconciliationJobRepository } from '../repositories/reconciliation-job.repository.js';
import { ReconciliationRunRepository } from '../repositories/reconciliation-run.repository.js';
import type { ListReconciliationRunsQuery } from '../requests/reconciliation.requests.js';
import { ReconciliationResponseMapper } from '../responses/reconciliation.response.js';
import type {
  QueuedReconciliationRunJobPayload,
  ReconciliationRunView,
  TriggerReconciliationRunInput,
} from '../types/reconciliation.types.js';
import { ReconciliationJobsService } from './reconciliation-jobs.service.js';

@Injectable()
export class ReconciliationRunnerService {
  private readonly logger = new Logger(ReconciliationRunnerService.name);
  private readonly registry: ReconciliationRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly jobsService: ReconciliationJobsService,
    private readonly jobRepo: ReconciliationJobRepository,
    private readonly runRepo: ReconciliationRunRepository,
    private readonly discrepancyRepo: ReconciliationDiscrepancyRepository,
    @Optional() registry?: ReconciliationRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() private readonly transactionManager?: TransactionManager,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsService: INotificationsPublicService | null = null,
  ) {
    this.registry = registry ?? defaultReconciliationRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
  }

  public async listRuns(
    query: ListReconciliationRunsQuery,
  ): Promise<PaginatedResult<ReconciliationRunView>> {
    const paged = await this.runRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => ReconciliationResponseMapper.toRunView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getRunById(id: number): Promise<ReconciliationRunView> {
    const entity = await this.runRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.runNotFound', { id });
    }
    return ReconciliationResponseMapper.toRunView(entity);
  }

  /** Cho phép chạy đối soát thủ công (có kiểm tra quyền ở controller & ghi Audit Log đầy đủ) */
  public async triggerManualRun(
    jobId: number,
    input: TriggerReconciliationRunInput,
    actor?: UserIdentity,
  ): Promise<ReconciliationRunView> {
    const job = await this.jobsService.getJobEntityOrThrow(jobId);
    const adapter = this.registry.getAdapter(job.adapterCode);
    if (!adapter) {
      throw new BadRequestAppException('reconciliation.adapterNotFound', [
        { adapterCode: job.adapterCode },
      ]);
    }

    const { periodStart, periodEnd } = this.resolvePeriod(input.periodStart, input.periodEnd);
    const actorUserId = parseNumericUserId(actor?.id);
    const runCode = await allocateReconciliationCode(
      this.sequenceRegistry,
      RECONCILIATION_SEQUENCE_KEYS.RUN_CODE,
      'RRN',
    );
    const shouldQueue = Boolean(input.async && this.messagePublisher);

    const run = await this.runRepo.saveEntity({
      runCode,
      jobId: Number(job.id),
      jobCode: job.jobCode,
      adapterCode: job.adapterCode,
      targetModule: job.targetModule,
      triggerMode: RECONCILIATION_TRIGGER_MODE.MANUAL,
      status: shouldQueue ? RECONCILIATION_RUN_STATUS.QUEUED : RECONCILIATION_RUN_STATUS.RUNNING,
      periodStart,
      periodEnd,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      triggeredBy: actorUserId,
      startedAt: new Date(),
      completedAt: null,
      summaryJson: JSON.stringify({
        reason: input.reason?.trim() || 'Manual reconciliation run',
        queued: shouldQueue,
      }),
    });

    if (shouldQueue && this.messagePublisher) {
      const queuedPayload: QueuedReconciliationRunJobPayload = {
        runId: Number(run.id),
        jobId: Number(job.id),
        triggeredBy: actorUserId,
        reason: input.reason,
        internalRecords: input.internalRecords,
        externalRecords: input.externalRecords,
        internalCsv: input.internalCsv,
        externalCsv: input.externalCsv,
        parameters: input.parameters,
      };
      await this.messagePublisher.publish(
        RECONCILIATION_QUEUE_TOPICS.RUN_JOB,
        queuedPayload as unknown as Record<string, unknown>,
        QUEUES.SYSTEM_EVENTS,
        {
          idempotencyKey: input.idempotencyKey?.trim() || `recon-run:${run.runCode}`,
        },
      );

      const view = ReconciliationResponseMapper.toRunView(run);
      await this.recordManualRunAudit(view, actor, actorUserId, input.reason, true);
      return view;
    }

    const completed = await this.executeRunEntity(run, job, input, actor, actorUserId);
    await this.recordManualRunAudit(completed, actor, actorUserId, input.reason, false);
    return completed;
  }

  /** Xử lý phiên đối soát đã được đưa vào Worker Queue */
  public async processQueuedRun(
    payload: QueuedReconciliationRunJobPayload,
  ): Promise<ReconciliationRunView> {
    const run = await this.runRepo.findByIdSafe(payload.runId);
    if (!run) {
      throw new NotFoundAppException('reconciliation.runNotFound', { id: payload.runId });
    }
    const job = await this.jobsService.getJobEntityOrThrow(payload.jobId);
    return this.executeRunEntity(
      run,
      job,
      {
        internalRecords: payload.internalRecords,
        externalRecords: payload.externalRecords,
        internalCsv: payload.internalCsv,
        externalCsv: payload.externalCsv,
        parameters: payload.parameters,
        reason: payload.reason,
      },
      undefined,
      payload.triggeredBy ?? run.triggeredBy ?? null,
    );
  }

  /** Quét và thực thi các Job đối soát định kỳ đến hạn (được Scheduler kích hoạt) */
  public async triggerDueScheduledJobs(now = new Date()): Promise<ScheduledReconciliationTickResult> {
    const dueJobs = await this.jobsService.listDueScheduledJobs(now);
    const triggeredRunIds: number[] = [];

    for (const job of dueJobs) {
      const adapter = this.registry.getAdapter(job.adapterCode);
      if (!adapter) {
        this.logger.warn(
          `Skipping scheduled reconciliation job "${job.jobCode}": adapter "${job.adapterCode}" not registered`,
        );
        continue;
      }

      const periodEnd = now;
      const periodStart = job.lastRunAt ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const runCode = await allocateReconciliationCode(
        this.sequenceRegistry,
        RECONCILIATION_SEQUENCE_KEYS.RUN_CODE,
        'RRN',
      );

      const run = await this.runRepo.saveEntity({
        runCode,
        jobId: Number(job.id),
        jobCode: job.jobCode,
        adapterCode: job.adapterCode,
        targetModule: job.targetModule,
        triggerMode: RECONCILIATION_TRIGGER_MODE.SCHEDULED as ReconciliationTriggerMode,
        status: RECONCILIATION_RUN_STATUS.RUNNING,
        periodStart,
        periodEnd,
        idempotencyKey: `recon-sched:${job.jobCode}:${now.toISOString().slice(0, 16)}`,
        triggeredBy: null,
        startedAt: now,
        completedAt: null,
      });

      await this.executeRunEntity(run, job, {}, undefined, null);
      triggeredRunIds.push(Number(run.id));
    }

    return {
      checkedJobs: dueJobs.length,
      triggeredCount: triggeredRunIds.length,
      triggeredRunIds,
    };
  }

  private async executeRunEntity(
    run: ReconciliationRunEntity,
    job: ReconciliationJobEntity,
    input: TriggerReconciliationRunInput,
    _actor: UserIdentity | undefined,
    _actorUserId: number | null,
  ): Promise<ReconciliationRunView> {
    const adapter = this.registry.getAdapter(job.adapterCode);
    if (!adapter) {
      throw new BadRequestAppException('reconciliation.adapterNotFound', [
        { adapterCode: job.adapterCode },
      ]);
    }

    const runtimeConfig = resolveReconciliationRuntimeConfig(this.settingRegistry);
    const matchingRules = (safeJsonParseObject<Record<string, unknown>>(
      job.matchingRulesJson,
      {},
    ) ?? {}) as unknown as ReconciliationMatchingRules;
    const jobConfig = safeJsonParseObject<Record<string, unknown>>(job.configJson, {}) ?? {};

    run.status = RECONCILIATION_RUN_STATUS.RUNNING;
    await this.runRepo.saveEntity(run);

    try {
      const dataset = await adapter.fetchData({
        jobCode: job.jobCode,
        jobConfig,
        matchingRules,
        periodStart: new Date(run.periodStart),
        periodEnd: new Date(run.periodEnd),
        maxRecords: runtimeConfig.maxRecordsPerRun,
        internalRecords: input.internalRecords,
        externalRecords: input.externalRecords,
        internalCsv: input.internalCsv,
        externalCsv: input.externalCsv,
        parameters: input.parameters,
      });

      const comparison = runReconciliationComparison({
        internalRecords: dataset.internalRecords,
        externalRecords: dataset.externalRecords,
        matchingRules,
        runtimeConfig,
      });

      const completedAt = new Date();
      const discrepancyCodes: string[] = [];
      for (let i = 0; i < comparison.discrepancies.length; i++) {
        discrepancyCodes.push(
          await allocateReconciliationCode(
            this.sequenceRegistry,
            RECONCILIATION_SEQUENCE_KEYS.DISCREPANCY_CODE,
            'RDS',
          ),
        );
      }

      const persistWork = async (): Promise<ReconciliationRunEntity> => {
        run.status = RECONCILIATION_RUN_STATUS.COMPLETED;
        run.totalInternalCount = comparison.totalInternalCount;
        run.totalExternalCount = comparison.totalExternalCount;
        run.matchedCount = comparison.matchedCount;
        run.discrepancyCount = comparison.discrepancyCount;
        run.missingInternalCount = comparison.missingInternalCount;
        run.missingExternalCount = comparison.missingExternalCount;
        run.duplicateCount = comparison.duplicateCount;
        run.statusMismatchCount = comparison.statusMismatchCount;
        run.amountMismatchCount = comparison.amountMismatchCount;
        run.dataMismatchCount = comparison.dataMismatchCount;
        run.internalTotalAmount = comparison.internalTotalAmount;
        run.externalTotalAmount = comparison.externalTotalAmount;
        run.amountDiffTotal = comparison.amountDiffTotal;
        run.currency = comparison.currency;
        run.errorMessage = null;
        run.completedAt = completedAt;
        run.summaryJson = JSON.stringify({
          reason: input.reason?.trim() || null,
          adapterMetadata: dataset.metadata ?? {},
          highOrCriticalCount: comparison.discrepancies.filter(
            (d) => d.severity >= RECONCILIATION_SEVERITY.HIGH,
          ).length,
        });
        const savedRun = await this.runRepo.saveEntity(run);

        for (let idx = 0; idx < comparison.discrepancies.length; idx++) {
          const item = comparison.discrepancies[idx]!;
          const defaultAssignee = job.defaultAssigneeUserId ?? null;
          await this.discrepancyRepo.saveEntity({
            discrepancyCode: discrepancyCodes[idx]!,
            runId: Number(savedRun.id),
            jobId: Number(job.id),
            targetModule: job.targetModule,
            entityType: item.entityType,
            entityId: item.entityId,
            recordKey: item.recordKey,
            discrepancyType: item.discrepancyType,
            severity: item.severity,
            status: defaultAssignee
              ? RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED
              : RECONCILIATION_DISCREPANCY_STATUS.OPEN,
            assigneeUserId: defaultAssignee,
            internalStatus: item.internalStatus,
            externalStatus: item.externalStatus,
            internalAmount: item.internalAmount,
            externalAmount: item.externalAmount,
            amountDiff: item.amountDiff,
            currency: item.currency,
            internalSnapshotJson: item.internalSnapshot
              ? JSON.stringify(item.internalSnapshot)
              : null,
            externalSnapshotJson: item.externalSnapshot
              ? JSON.stringify(item.externalSnapshot)
              : null,
            diffFieldsJson: JSON.stringify(item.diffFields),
            resolutionNote: null,
            resolvedBy: null,
            resolvedAt: null,
          });
        }

        job.lastRunId = Number(savedRun.id);
        job.lastRunAt = completedAt;
        job.nextRunAt = job.isEnabled ? computeNextRunAt(job.scheduleCron, completedAt) : null;
        await this.jobRepo.saveEntity(job);

        return savedRun;
      };

      const savedRun = this.transactionManager
        ? await this.transactionManager.runInTransaction(persistWork)
        : await persistWork();

      const highOrCriticalCount = comparison.discrepancies.filter(
        (d) => d.severity >= RECONCILIATION_SEVERITY.HIGH,
      ).length;

      if (highOrCriticalCount > 0 && job.defaultAssigneeUserId && this.notificationsService) {
        await this.notificationsService
          .dispatch({
            title: `[Đối soát] Phát hiện ${highOrCriticalCount} sai lệch mức Cao/Nghiêm trọng`,
            content: `Phiên đối soát ${savedRun.runCode} (Job ${job.jobCode}) phát hiện ${comparison.discrepancyCount} sai lệch (chênh lệch tiền: ${comparison.amountDiffTotal}).`,
            category: NOTIFICATION_CATEGORY.SYSTEM,
            priority: NOTIFICATION_PRIORITY.HIGH,
            targetType: NOTIFICATION_TARGET_TYPE.SINGLE_USER,
            userId: job.defaultAssigneeUserId,
            referenceModule: 'reconciliation',
            referenceType: 'reconciliation_run',
            referenceId: String(savedRun.id),
            actionUrl: '/reconciliation',
          })
          .catch(() => undefined);
      }

      const view = ReconciliationResponseMapper.toRunView(savedRun);
      await this.publishEventSafe(RECONCILIATION_EVENTS.RUN_COMPLETED, {
        runId: view.id,
        runCode: view.runCode,
        jobCode: view.jobCode,
        triggerMode: view.triggerMode,
        matchedCount: view.matchedCount,
        discrepancyCount: view.discrepancyCount,
        amountDiffTotal: view.amountDiffTotal,
      });

      return view;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      run.status = RECONCILIATION_RUN_STATUS.FAILED;
      run.errorMessage = errorMessage.slice(0, 1000);
      run.completedAt = new Date();
      await this.runRepo.saveEntity(run);

      await this.publishEventSafe(RECONCILIATION_EVENTS.RUN_FAILED, {
        runId: Number(run.id),
        runCode: run.runCode,
        jobCode: run.jobCode,
        errorMessage: run.errorMessage,
      });
      throw err;
    }
  }

  private resolvePeriod(
    rawStart?: string | Date,
    rawEnd?: string | Date,
  ): { readonly periodStart: Date; readonly periodEnd: Date } {
    const periodEnd =
      rawEnd instanceof Date
        ? rawEnd
        : typeof rawEnd === 'string' && rawEnd.trim()
          ? new Date(rawEnd)
          : new Date();
    const periodStart =
      rawStart instanceof Date
        ? rawStart
        : typeof rawStart === 'string' && rawStart.trim()
          ? new Date(rawStart)
          : new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodStart.getTime() > periodEnd.getTime()
    ) {
      throw new BadRequestAppException('reconciliation.invalidPeriod');
    }
    return { periodStart, periodEnd };
  }

  private async recordManualRunAudit(
    view: ReconciliationRunView,
    actor: UserIdentity | undefined,
    actorUserId: number | null,
    reason: string | undefined,
    queued: boolean,
  ): Promise<void> {
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.RUNS,
      action: queued ? 'MANUAL_RUN_QUEUED' : 'MANUAL_RUN',
      resourceType: 'reconciliation_run',
      resourceId: String(view.id),
      beforeData: null,
      afterData: {
        runCode: view.runCode,
        jobCode: view.jobCode,
        status: view.statusName,
        totalInternalCount: view.totalInternalCount,
        totalExternalCount: view.totalExternalCount,
        matchedCount: view.matchedCount,
        discrepancyCount: view.discrepancyCount,
        amountDiffTotal: view.amountDiffTotal,
      },
      reason: reason?.trim() || `Triggered manual reconciliation for job ${view.jobCode}`,
    });
  }

  private async publishEventSafe(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.messagePublisher) return;
    try {
      await this.messagePublisher.publish(topic, payload, QUEUES.SYSTEM_EVENTS);
    } catch (err) {
      this.logger.warn(
        `Failed to publish event ${topic}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
