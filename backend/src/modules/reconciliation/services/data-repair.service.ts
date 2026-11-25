import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  ReconciliationRegistryService,
  SequenceRegistryService,
  SettingRegistryService,
  defaultReconciliationRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  type DataRepairPreviewOutcome,
  type DataRepairTargetInfo,
  type IDataRepairHandler,
  type PaginatedResult,
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
import type { DataRepairRequestEntity } from '../entities/data-repair-request.entity.js';
import type { ReconciliationDiscrepancyEntity } from '../entities/reconciliation-discrepancy.entity.js';
import {
  DATA_REPAIR_ACTION_MODE,
  DATA_REPAIR_EXECUTION_MODE,
  DATA_REPAIR_EXECUTION_STATUS,
  DATA_REPAIR_STATUS,
  RECONCILIATION_AUDIT_META,
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_EVENTS,
  RECONCILIATION_SEQUENCE_KEYS,
  getReconciliationDiscrepancyTypeName,
  type DataRepairActionMode,
} from '../enum/reconciliation.enum.js';
import {
  allocateReconciliationCode,
  resolveReconciliationRuntimeConfig,
} from '../helpers/reconciliation-config.helper.js';
import { evaluateRepairSensitivity } from '../helpers/reconciliation-sensitivity.helper.js';
import { DataRepairExecutionRepository } from '../repositories/data-repair-execution.repository.js';
import { DataRepairRequestRepository } from '../repositories/data-repair-request.repository.js';
import { ReconciliationDiscrepancyRepository } from '../repositories/reconciliation-discrepancy.repository.js';
import type { ListDataRepairsQuery } from '../requests/reconciliation.requests.js';
import { ReconciliationResponseMapper } from '../responses/reconciliation.response.js';
import type {
  CreateCompensationInput,
  DataRepairRequestView,
  DecideDataRepairInput,
  PreviewDataRepairInput,
  ProposeDataRepairInput,
} from '../types/reconciliation.types.js';

/**
 * Dịch vụ sửa dữ liệu an toàn & hành động bù (11.5):
 * - Bắt buộc xem trước Dry-Run trước khi ghi.
 * - Phê duyệt tách người đề xuất và người duyệt (Maker-Checker) cho dữ liệu nhạy cảm.
 * - Ghi nhận dữ liệu trước & sau khi sửa (trên cả bảng lịch sử append-only và AuditLogService).
 * - Hỗ trợ hành động bù (`COMPENSATING_ACTION`) khi không thể rollback mà không làm mất lịch sử gốc.
 */
@Injectable()
export class DataRepairService {
  private readonly logger = new Logger(DataRepairService.name);
  private readonly registry: ReconciliationRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly repairRepo: DataRepairRequestRepository,
    private readonly executionRepo: DataRepairExecutionRepository,
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

  public async listRepairs(
    query: ListDataRepairsQuery,
  ): Promise<PaginatedResult<DataRepairRequestView>> {
    const paged = await this.repairRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => ReconciliationResponseMapper.toRepairRequestView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getRepairById(id: number): Promise<DataRepairRequestView> {
    const entity = await this.getRepairEntityOrThrow(id);
    const executions = await this.executionRepo.listByRepairRequestId(Number(entity.id));
    return ReconciliationResponseMapper.toRepairRequestView(entity, executions);
  }

  /** Chạy thử Dry-Run xem trước tác động, diff trước/sau và phân loại nhạy cảm mà KHÔNG ghi dữ liệu đích */
  public async previewRepair(
    input: PreviewDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairPreviewOutcome> {
    const actionMode: DataRepairActionMode =
      input.actionMode ?? DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR;
    const handler = this.resolveHandlerOrThrow(input.handlerCode, actionMode);
    const { target, discrepancy } = await this.resolveTarget(input, handler);
    const actorUserId = parseNumericUserId(actor?.id);
    const runtimeConfig = resolveReconciliationRuntimeConfig(this.settingRegistry);

    const rawPreview = await handler.preview({
      repairCode: 'DRY-RUN-PREVIEW',
      actionMode,
      target,
      payload: {
        ...(input.payload ?? {}),
        ...(input.compensationType ? { compensationType: input.compensationType } : {}),
      },
      reason: input.reason,
      actorUserId,
      dryRun: true,
    });

    const sensitivity = evaluateRepairSensitivity({
      actionMode,
      handlerAlwaysSensitive: handler.alwaysSensitive,
      previewIsSensitive: rawPreview.isSensitive,
      previewReasons: rawPreview.sensitivityReasons,
      discrepancyType: discrepancy?.discrepancyType ?? null,
      amountDiff: discrepancy?.amountDiff ?? null,
      payload: input.payload,
      fieldDiffs: rawPreview.fieldDiffs,
      runtimeConfig,
    });

    return {
      ...rawPreview,
      isSensitive: sensitivity.isSensitive,
      sensitivityReasons: sensitivity.reasons,
      canRollback: handler.supportsRollback ? rawPreview.canRollback : false,
    };
  }

  /** Tạo đề xuất sửa dữ liệu (tự động chạy Dry-Run preview + lưu nhật ký DRY_RUN + định tuyến phê duyệt nếu nhạy cảm) */
  public async proposeRepair(
    input: ProposeDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    const actionMode: DataRepairActionMode =
      input.actionMode ?? DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR;
    const handler = this.resolveHandlerOrThrow(input.handlerCode, actionMode);
    const { target, discrepancy } = await this.resolveTarget(input, handler);
    const actorUserId = parseNumericUserId(actor?.id);
    const runtimeConfig = resolveReconciliationRuntimeConfig(this.settingRegistry);

    const repairCode = await allocateReconciliationCode(
      this.sequenceRegistry,
      RECONCILIATION_SEQUENCE_KEYS.REPAIR_CODE,
      'RPR',
    );

    const startedMs = Date.now();
    const rawPreview = await handler.preview({
      repairCode,
      actionMode,
      target,
      payload: {
        ...(input.payload ?? {}),
        ...(input.compensationType ? { compensationType: input.compensationType } : {}),
      },
      reason: input.reason,
      actorUserId,
      dryRun: true,
    });
    const previewDurationMs = Date.now() - startedMs;

    const sensitivity = evaluateRepairSensitivity({
      actionMode,
      handlerAlwaysSensitive: handler.alwaysSensitive,
      previewIsSensitive: rawPreview.isSensitive,
      previewReasons: rawPreview.sensitivityReasons,
      discrepancyType: discrepancy?.discrepancyType ?? null,
      amountDiff: discrepancy?.amountDiff ?? null,
      payload: input.payload,
      fieldDiffs: rawPreview.fieldDiffs,
      forceSensitive: input.forceSensitive,
      runtimeConfig,
    });

    const enrichedPreview: DataRepairPreviewOutcome = {
      ...rawPreview,
      isSensitive: sensitivity.isSensitive,
      sensitivityReasons: sensitivity.reasons,
      canRollback: handler.supportsRollback ? rawPreview.canRollback : false,
    };

    const initialStatus = sensitivity.isSensitive
      ? DATA_REPAIR_STATUS.PENDING_APPROVAL
      : DATA_REPAIR_STATUS.DRAFT_PREVIEW;

    const persistWork = async (): Promise<DataRepairRequestView> => {
      const saved = await this.repairRepo.saveEntity({
        repairCode,
        discrepancyId: discrepancy ? Number(discrepancy.id) : (input.discrepancyId ?? null),
        parentRepairId: input.parentRepairId ?? null,
        actionMode,
        handlerCode: handler.code,
        targetModule: target.targetModule,
        targetEntityType: target.targetEntityType,
        targetEntityId: target.targetEntityId,
        isSensitive: sensitivity.isSensitive,
        sensitivityReasonsJson: JSON.stringify(sensitivity.reasons),
        canRollback: enrichedPreview.canRollback,
        status: initialStatus,
        reason: input.reason.trim(),
        payloadJson: JSON.stringify(input.payload ?? {}),
        dryRunPreviewJson: JSON.stringify(enrichedPreview),
        beforeSnapshotJson: JSON.stringify(enrichedPreview.beforeSnapshot),
        afterSnapshotJson: null,
        fieldDiffsJson: JSON.stringify(enrichedPreview.fieldDiffs),
        compensationType:
          actionMode === DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION
            ? (input.compensationType ?? 'ADJUSTMENT_ENTRY')
            : null,
        compensationDetailsJson: null,
        requestedBy: actorUserId,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        approvalNote: null,
        executedBy: null,
        executedAt: null,
        errorMessage: null,
      });

      const dryRunExecution = await this.executionRepo.saveEntity({
        repairRequestId: Number(saved.id),
        repairCode: saved.repairCode,
        executionMode: DATA_REPAIR_EXECUTION_MODE.DRY_RUN,
        executionStatus: DATA_REPAIR_EXECUTION_STATUS.SUCCEEDED,
        affectedCount: enrichedPreview.affectedCount,
        actorUserId,
        summary: enrichedPreview.summary,
        beforeDataJson: JSON.stringify(enrichedPreview.beforeSnapshot),
        afterDataJson: JSON.stringify(enrichedPreview.predictedAfterSnapshot),
        diffJson: JSON.stringify(enrichedPreview.fieldDiffs),
        errorMessage: null,
        durationMs: previewDurationMs,
        executedAt: new Date(),
      });

      if (
        discrepancy &&
        (discrepancy.status === RECONCILIATION_DISCREPANCY_STATUS.OPEN ||
          discrepancy.status === RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED)
      ) {
        discrepancy.status = RECONCILIATION_DISCREPANCY_STATUS.IN_REPAIR;
        await this.discrepancyRepo.saveEntity(discrepancy);
      }

      return ReconciliationResponseMapper.toRepairRequestView(saved, [dryRunExecution]);
    };

    const view = this.transactionManager
      ? await this.transactionManager.runInTransaction(persistWork)
      : await persistWork();

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.REPAIRS,
      action:
        actionMode === DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION
          ? 'PROPOSE_COMPENSATION'
          : 'PROPOSE_REPAIR',
      resourceType: 'data_repair_request',
      resourceId: String(view.id),
      beforeData: enrichedPreview.beforeSnapshot as Record<string, unknown>,
      afterData: {
        repairCode: view.repairCode,
        status: view.statusName,
        isSensitive: view.isSensitive,
        sensitivityReasons: view.sensitivityReasons,
        predictedAfter: enrichedPreview.predictedAfterSnapshot,
      },
      reason: input.reason.trim(),
    });

    await this.publishEventSafe(RECONCILIATION_EVENTS.REPAIR_PROPOSED, {
      repairId: view.id,
      repairCode: view.repairCode,
      actionMode: view.actionMode,
      isSensitive: view.isSensitive,
      status: view.statusName,
      requestedBy: actorUserId,
    });

    return view;
  }

  /** Phê duyệt yêu cầu sửa dữ liệu nhạy cảm — CHẶN CỨNG tự duyệt (Maker !== Checker) */
  public async approveRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    const entity = await this.getRepairEntityOrThrow(id);
    if (entity.status !== DATA_REPAIR_STATUS.PENDING_APPROVAL) {
      throw new ConflictAppException('reconciliation.repairPendingApprovalRequired', [{ id }]);
    }

    const approverUserId = this.assertIndependentChecker(entity.requestedBy, actor);
    const beforeView = ReconciliationResponseMapper.toRepairRequestView(entity);

    entity.status = DATA_REPAIR_STATUS.APPROVED;
    entity.approvedBy = approverUserId;
    entity.approvedAt = new Date();
    entity.approvalNote = input.note?.trim() || 'Approved by independent reviewer';

    const saved = await this.repairRepo.saveEntity(entity);
    const executions = await this.executionRepo.listByRepairRequestId(Number(saved.id));
    const afterView = ReconciliationResponseMapper.toRepairRequestView(saved, executions);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId: approverUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.REPAIRS,
      action: 'APPROVE_REPAIR',
      resourceType: 'data_repair_request',
      resourceId: String(afterView.id),
      beforeData: {
        status: beforeView.statusName,
        requestedBy: beforeView.requestedBy,
      },
      afterData: {
        status: afterView.statusName,
        approvedBy: afterView.approvedBy,
        approvalNote: afterView.approvalNote,
      },
      reason: afterView.approvalNote ?? 'Approved sensitive data repair',
    });

    if (entity.requestedBy && this.notificationsService) {
      await this.notificationsService
        .dispatch({
          title: `Yêu cầu sửa dữ liệu ${afterView.repairCode} đã được phê duyệt`,
          content: `Người duyệt #${approverUserId} đã phê duyệt lệnh ${afterView.repairCode}. Bạn có thể tiến hành thực thi (Apply).`,
          category: NOTIFICATION_CATEGORY.WORK,
          priority: NOTIFICATION_PRIORITY.NORMAL,
          targetType: NOTIFICATION_TARGET_TYPE.SINGLE_USER,
          userId: entity.requestedBy,
          referenceModule: 'reconciliation',
          referenceType: 'data_repair_request',
          referenceId: String(afterView.id),
          actionUrl: '/reconciliation',
        })
        .catch(() => undefined);
    }

    await this.publishEventSafe(RECONCILIATION_EVENTS.REPAIR_APPROVED, {
      repairId: afterView.id,
      repairCode: afterView.repairCode,
      requestedBy: afterView.requestedBy,
      approvedBy: approverUserId,
    });

    return afterView;
  }

  /** Từ chối yêu cầu sửa dữ liệu nhạy cảm (cũng yêu cầu tách người đề xuất và người duyệt) */
  public async rejectRepair(
    id: number,
    input: DecideDataRepairInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    const entity = await this.getRepairEntityOrThrow(id);
    if (entity.status !== DATA_REPAIR_STATUS.PENDING_APPROVAL) {
      throw new ConflictAppException('reconciliation.repairPendingApprovalRequired', [{ id }]);
    }

    const reviewerUserId = this.assertIndependentChecker(entity.requestedBy, actor);
    const beforeView = ReconciliationResponseMapper.toRepairRequestView(entity);

    entity.status = DATA_REPAIR_STATUS.REJECTED;
    entity.rejectedBy = reviewerUserId;
    entity.rejectedAt = new Date();
    entity.approvalNote = input.note?.trim() || 'Rejected by independent reviewer';

    const saved = await this.repairRepo.saveEntity(entity);
    const executions = await this.executionRepo.listByRepairRequestId(Number(saved.id));
    const afterView = ReconciliationResponseMapper.toRepairRequestView(saved, executions);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId: reviewerUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.REPAIRS,
      action: 'REJECT_REPAIR',
      resourceType: 'data_repair_request',
      resourceId: String(afterView.id),
      beforeData: {
        status: beforeView.statusName,
        requestedBy: beforeView.requestedBy,
      },
      afterData: {
        status: afterView.statusName,
        rejectedBy: afterView.rejectedBy,
        approvalNote: afterView.approvalNote,
      },
      reason: afterView.approvalNote ?? 'Rejected sensitive data repair',
    });

    await this.publishEventSafe(RECONCILIATION_EVENTS.REPAIR_REJECTED, {
      repairId: afterView.id,
      repairCode: afterView.repairCode,
      rejectedBy: reviewerUserId,
    });

    return afterView;
  }

  /** Thực thi sửa dữ liệu / hành động bù sau khi đã qua Dry-Run (và đã duyệt nếu nhạy cảm), ghi rõ trước & sau */
  public async applyRepair(id: number, actor?: UserIdentity): Promise<DataRepairRequestView> {
    const entity = await this.getRepairEntityOrThrow(id);
    if (
      entity.status === DATA_REPAIR_STATUS.EXECUTED ||
      entity.status === DATA_REPAIR_STATUS.COMPENSATED
    ) {
      throw new ConflictAppException('reconciliation.repairAlreadyExecuted', [{ id }]);
    }
    if (entity.status === DATA_REPAIR_STATUS.REJECTED) {
      throw new BadRequestAppException('reconciliation.repairRejected', [{ id }]);
    }

    const runtimeConfig = resolveReconciliationRuntimeConfig(this.settingRegistry);
    if (runtimeConfig.requireDryRunBeforeApply && !entity.dryRunPreviewJson) {
      throw new BadRequestAppException('reconciliation.repairDryRunRequired', [{ id }]);
    }
    if (entity.isSensitive && entity.status !== DATA_REPAIR_STATUS.APPROVED) {
      throw new ForbiddenAppException('reconciliation.repairApprovalRequired');
    }

    const handler = this.resolveHandlerOrThrow(entity.handlerCode, entity.actionMode);
    const actorUserId = parseNumericUserId(actor?.id);
    const payload = safeJsonParseObject<Record<string, unknown>>(entity.payloadJson, {}) ?? {};
    const discrepancy = entity.discrepancyId
      ? await this.discrepancyRepo.findByIdSafe(entity.discrepancyId)
      : null;
    const parentRepair = entity.parentRepairId
      ? await this.repairRepo.findByIdSafe(entity.parentRepairId)
      : null;

    const target: DataRepairTargetInfo = {
      targetModule: entity.targetModule,
      targetEntityType: entity.targetEntityType,
      targetEntityId: entity.targetEntityId,
      discrepancyId: discrepancy ? Number(discrepancy.id) : entity.discrepancyId,
      discrepancyCode: discrepancy?.discrepancyCode ?? null,
      discrepancyType: discrepancy
        ? getReconciliationDiscrepancyTypeName(discrepancy.discrepancyType)
        : null,
      internalSnapshot: discrepancy?.internalSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(discrepancy.internalSnapshotJson)
        : entity.beforeSnapshotJson
          ? safeJsonParseObject<Record<string, unknown>>(entity.beforeSnapshotJson)
          : null,
      externalSnapshot: discrepancy?.externalSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(discrepancy.externalSnapshotJson)
        : null,
      amountDiff: discrepancy?.amountDiff ?? null,
    };

    const startedMs = Date.now();
    const isCompensation = entity.actionMode === DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION;

    try {
      const executeWork = async (): Promise<DataRepairRequestView> => {
        const outcome = isCompensation
          ? await (handler.compensate
              ? handler.compensate({
                  repairCode: entity.repairCode,
                  actionMode: entity.actionMode,
                  target,
                  payload,
                  reason: entity.reason,
                  actorUserId,
                  dryRun: false,
                  parentRepairCode: parentRepair?.repairCode ?? null,
                  parentBeforeSnapshot: parentRepair?.beforeSnapshotJson
                    ? safeJsonParseObject<Record<string, unknown>>(parentRepair.beforeSnapshotJson)
                    : null,
                  parentAfterSnapshot: parentRepair?.afterSnapshotJson
                    ? safeJsonParseObject<Record<string, unknown>>(parentRepair.afterSnapshotJson)
                    : null,
                  compensationType: entity.compensationType ?? 'ADJUSTMENT_ENTRY',
                })
              : handler.apply({
                  repairCode: entity.repairCode,
                  actionMode: entity.actionMode,
                  target,
                  payload,
                  reason: entity.reason,
                  actorUserId,
                  dryRun: false,
                }))
          : await handler.apply({
              repairCode: entity.repairCode,
              actionMode: entity.actionMode,
              target,
              payload,
              reason: entity.reason,
              actorUserId,
              dryRun: false,
            });

        const durationMs = Date.now() - startedMs;
        const executedAt = new Date();

        entity.status = DATA_REPAIR_STATUS.EXECUTED;
        entity.beforeSnapshotJson = JSON.stringify(outcome.beforeSnapshot);
        entity.afterSnapshotJson = JSON.stringify(outcome.afterSnapshot);
        entity.fieldDiffsJson = JSON.stringify(outcome.fieldDiffs);
        entity.canRollback = outcome.canRollback;
        entity.compensationDetailsJson = outcome.compensationDetails
          ? JSON.stringify(outcome.compensationDetails)
          : entity.compensationDetailsJson;
        entity.executedBy = actorUserId;
        entity.executedAt = executedAt;
        entity.errorMessage = null;
        const saved = await this.repairRepo.saveEntity(entity);

        await this.executionRepo.saveEntity({
          repairRequestId: Number(saved.id),
          repairCode: saved.repairCode,
          executionMode: isCompensation
            ? DATA_REPAIR_EXECUTION_MODE.COMPENSATE
            : DATA_REPAIR_EXECUTION_MODE.APPLY,
          executionStatus: DATA_REPAIR_EXECUTION_STATUS.SUCCEEDED,
          affectedCount: outcome.affectedCount,
          actorUserId,
          summary: outcome.summary,
          beforeDataJson: JSON.stringify(outcome.beforeSnapshot),
          afterDataJson: JSON.stringify(outcome.afterSnapshot),
          diffJson: JSON.stringify(outcome.fieldDiffs),
          errorMessage: null,
          durationMs,
          executedAt,
        });

        // Nếu là hành động bù cho lệnh gốc không thể rollback -> đánh dấu lệnh gốc đã có hành động bù,
        // TUYỆT ĐỐI giữ nguyên before/after và nhật ký lịch sử của lệnh gốc.
        if (parentRepair && parentRepair.status === DATA_REPAIR_STATUS.EXECUTED) {
          parentRepair.status = DATA_REPAIR_STATUS.COMPENSATED;
          await this.repairRepo.saveEntity(parentRepair);
        }

        if (discrepancy) {
          discrepancy.status = isCompensation
            ? RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED
            : RECONCILIATION_DISCREPANCY_STATUS.RESOLVED;
          discrepancy.resolutionNote = outcome.summary.slice(0, 500);
          discrepancy.resolvedBy = actorUserId;
          discrepancy.resolvedAt = executedAt;
          await this.discrepancyRepo.saveEntity(discrepancy);
        }

        const executions = await this.executionRepo.listByRepairRequestId(Number(saved.id));
        return ReconciliationResponseMapper.toRepairRequestView(saved, executions);
      };

      const view = this.transactionManager
        ? await this.transactionManager.runInTransaction(executeWork)
        : await executeWork();

      await this.auditLogService?.record({
        actor: actor ?? null,
        actorUserId,
        module: RECONCILIATION_AUDIT_META.MODULE,
        feature: RECONCILIATION_AUDIT_META.FEATURES.REPAIRS,
        action: isCompensation ? 'EXECUTE_COMPENSATION' : 'APPLY_REPAIR',
        resourceType: 'data_repair_request',
        resourceId: String(view.id),
        beforeData: view.beforeSnapshot,
        afterData: view.afterSnapshot,
        reason: view.reason,
      });

      await this.publishEventSafe(
        isCompensation
          ? RECONCILIATION_EVENTS.REPAIR_COMPENSATED
          : RECONCILIATION_EVENTS.REPAIR_EXECUTED,
        {
          repairId: view.id,
          repairCode: view.repairCode,
          parentRepairId: view.parentRepairId,
          discrepancyId: view.discrepancyId,
          actionMode: view.actionMode,
          executedBy: actorUserId,
        },
      );

      return view;
    } catch (err: unknown) {
      const durationMs = Date.now() - startedMs;
      const errorMessage = err instanceof Error ? err.message : String(err);
      entity.status = DATA_REPAIR_STATUS.FAILED;
      entity.errorMessage = errorMessage.slice(0, 1000);
      await this.repairRepo.saveEntity(entity);

      await this.executionRepo.saveEntity({
        repairRequestId: Number(entity.id),
        repairCode: entity.repairCode,
        executionMode: isCompensation
          ? DATA_REPAIR_EXECUTION_MODE.COMPENSATE
          : DATA_REPAIR_EXECUTION_MODE.APPLY,
        executionStatus: DATA_REPAIR_EXECUTION_STATUS.FAILED,
        affectedCount: 0,
        actorUserId,
        summary: `Failed to execute ${entity.actionMode}`,
        beforeDataJson: entity.beforeSnapshotJson,
        afterDataJson: null,
        diffJson: null,
        errorMessage: errorMessage.slice(0, 1000),
        durationMs,
        executedAt: new Date(),
      });
      throw err;
    }
  }

  /**
   * Tạo hành động bù mới liên kết tới lệnh sửa gốc khi không thể rollback trực tiếp.
   * Không bao giờ xóa hoặc ghi đè lịch sử của lệnh gốc; hành động bù đi qua Dry-Run & Maker-Checker đầy đủ.
   */
  public async proposeCompensation(
    parentRepairId: number,
    input: CreateCompensationInput,
    actor?: UserIdentity,
  ): Promise<DataRepairRequestView> {
    const parent = await this.getRepairEntityOrThrow(parentRepairId);
    if (
      parent.status !== DATA_REPAIR_STATUS.EXECUTED &&
      parent.status !== DATA_REPAIR_STATUS.COMPENSATED &&
      parent.canRollback
    ) {
      throw new BadRequestAppException('reconciliation.compensationParentInvalid', [
        { parentRepairId },
      ]);
    }

    const handlerCode = input.handlerCode?.trim() || parent.handlerCode;
    const handler = this.resolveHandlerOrThrow(
      handlerCode,
      DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
    );
    if (!handler.compensate) {
      throw new BadRequestAppException('reconciliation.compensationNotSupported', [
        { handlerCode },
      ]);
    }

    return this.proposeRepair(
      {
        discrepancyId: parent.discrepancyId,
        parentRepairId: Number(parent.id),
        actionMode: DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
        handlerCode,
        targetModule: parent.targetModule,
        targetEntityType: parent.targetEntityType,
        targetEntityId: parent.targetEntityId,
        compensationType: input.compensationType,
        payload: {
          ...(input.payload ?? {}),
          parentRepairCode: parent.repairCode,
          compensationType: input.compensationType,
        },
        reason: input.reason,
        forceSensitive: true,
      },
      actor,
    );
  }

  private async getRepairEntityOrThrow(id: number): Promise<DataRepairRequestEntity> {
    const entity = await this.repairRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.repairNotFound', { id });
    }
    return entity;
  }

  private resolveHandlerOrThrow(
    handlerCode: string,
    actionMode: DataRepairActionMode,
  ): IDataRepairHandler {
    const handler = this.registry.getRepairHandler(handlerCode);
    if (!handler) {
      throw new BadRequestAppException('reconciliation.repairHandlerNotFound', [{ handlerCode }]);
    }
    if (!handler.supportedModes.includes(actionMode)) {
      throw new BadRequestAppException('reconciliation.repairModeNotSupported', [
        { handlerCode, actionMode },
      ]);
    }
    return handler;
  }

  private async resolveTarget(
    input: PreviewDataRepairInput,
    handler: IDataRepairHandler,
  ): Promise<{
    readonly target: DataRepairTargetInfo;
    readonly discrepancy: ReconciliationDiscrepancyEntity | null;
  }> {
    let discrepancy: ReconciliationDiscrepancyEntity | null = null;
    if (input.discrepancyId) {
      discrepancy = await this.discrepancyRepo.findByIdSafe(input.discrepancyId);
      if (!discrepancy) {
        throw new NotFoundAppException('reconciliation.discrepancyNotFound', {
          id: input.discrepancyId,
        });
      }
    }

    const targetModule = (
      input.targetModule?.trim() ||
      discrepancy?.targetModule ||
      handler.targetModule
    ).toLowerCase();
    const targetEntityType =
      input.targetEntityType?.trim() || discrepancy?.entityType || 'reconciliation_record';
    const targetEntityId =
      input.targetEntityId?.trim() || discrepancy?.entityId || discrepancy?.recordKey || '';

    if (!targetEntityId) {
      throw new BadRequestAppException('reconciliation.repairMissingTarget');
    }

    return {
      discrepancy,
      target: {
        targetModule,
        targetEntityType,
        targetEntityId,
        discrepancyId: discrepancy ? Number(discrepancy.id) : null,
        discrepancyCode: discrepancy?.discrepancyCode ?? null,
        discrepancyType: discrepancy
          ? getReconciliationDiscrepancyTypeName(discrepancy.discrepancyType)
          : null,
        internalSnapshot: discrepancy?.internalSnapshotJson
          ? safeJsonParseObject<Record<string, unknown>>(discrepancy.internalSnapshotJson)
          : null,
        externalSnapshot: discrepancy?.externalSnapshotJson
          ? safeJsonParseObject<Record<string, unknown>>(discrepancy.externalSnapshotJson)
          : null,
        amountDiff: discrepancy?.amountDiff ?? null,
      },
    };
  }

  private assertIndependentChecker(
    requestedBy: number | null,
    actor?: UserIdentity,
  ): number {
    const checkerUserId = parseNumericUserId(actor?.id);
    if (checkerUserId === null) {
      throw new ForbiddenAppException('reconciliation.invalidActorForApproval');
    }
    if (requestedBy !== null && Number(requestedBy) === Number(checkerUserId)) {
      throw new ForbiddenAppException('reconciliation.selfApprovalForbidden');
    }
    return checkerUserId;
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
