import { Injectable } from '@nestjs/common';
import {
  DATA_REPAIR_ACTION_MODE,
  type DataRepairApplyOutcome,
  type DataRepairCompensateContext,
  type DataRepairHandlerContext,
  type DataRepairPreviewOutcome,
  type IDataRepairHandler,
  type IReconciliationSourceAdapter,
  type ReconciliationAdapterContext,
  type ReconciliationComparableRecord,
  type ReconciliationDatasetPair,
} from '@packages/kernel/index.js';
import {
  RECONCILIATION_ADAPTER_CODES,
  RECONCILIATION_REPAIR_HANDLER_CODES,
} from '../enum/reconciliation.enum.js';
import { parseComparableRecordsFromCsv } from '../helpers/reconciliation-config.helper.js';
import { computeFieldDiffs } from '../helpers/reconciliation-sensitivity.helper.js';

function normalizeRecordArray(raw: unknown): ReconciliationComparableRecord[] {
  if (!Array.isArray(raw)) return [];
  const results: ReconciliationComparableRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const keyCandidate =
      rec.recordKey ?? rec.paymentCode ?? rec.orderCode ?? rec.code ?? rec.id ?? '';
    const recordKey = String(keyCandidate).trim();
    if (!recordKey) continue;
    const rawAmount = rec.amount;
    const amount =
      typeof rawAmount === 'number' && !Number.isNaN(rawAmount)
        ? Math.trunc(rawAmount)
        : typeof rawAmount === 'string' &&
            rawAmount.trim() !== '' &&
            !Number.isNaN(Number(rawAmount))
          ? Math.trunc(Number(rawAmount))
          : null;

    results.push({
      recordKey,
      entityType: typeof rec.entityType === 'string' ? rec.entityType : 'dataset_record',
      entityId:
        typeof rec.entityId === 'string' || typeof rec.entityId === 'number'
          ? String(rec.entityId)
          : recordKey,
      status: rec.status !== undefined && rec.status !== null ? String(rec.status) : null,
      amount,
      currency:
        typeof rec.currency === 'string' && rec.currency.trim()
          ? rec.currency.trim().toUpperCase()
          : null,
      occurredAt: typeof rec.occurredAt === 'string' ? rec.occurredAt : null,
      fields:
        rec.fields && typeof rec.fields === 'object' && !Array.isArray(rec.fields)
          ? (rec.fields as Record<string, unknown>)
          : undefined,
      raw: rec,
    });
  }
  return results;
}

/**
 * Built-in Adapter tổng quát (`generic-dataset`):
 * So sánh dữ liệu nội bộ và nguồn ngoài từ JSON payload hoặc CSV tải lên (hoặc từ cấu hình Job).
 */
@Injectable()
export class GenericDatasetReconciliationAdapter implements IReconciliationSourceAdapter {
  public readonly code = RECONCILIATION_ADAPTER_CODES.GENERIC_DATASET;
  public readonly name = 'Generic Dataset (JSON / CSV)';
  public readonly description =
    'Đối soát linh hoạt 2 tập bản ghi nội bộ và nguồn ngoài từ JSON/CSV hoặc cấu hình Job (hỗ trợ phát hiện thiếu, trùng, sai trạng thái, sai số tiền).';
  public readonly targetModule = 'reconciliation';
  public readonly supportsExternalUpload = true;
  public readonly defaultMatchingRules = {
    amountTolerance: 0,
    ignoreCaseOnStatus: true,
  };

  public async fetchData(
    context: ReconciliationAdapterContext,
  ): Promise<ReconciliationDatasetPair> {
    const internalFromCsv = context.internalCsv?.trim()
      ? parseComparableRecordsFromCsv(context.internalCsv)
      : [];
    const externalFromCsv = context.externalCsv?.trim()
      ? parseComparableRecordsFromCsv(context.externalCsv)
      : [];

    const internalFromConfig = normalizeRecordArray(context.jobConfig.defaultInternalRecords);
    const externalFromConfig = normalizeRecordArray(context.jobConfig.defaultExternalRecords);

    const internalRecords = [
      ...(context.internalRecords ?? []),
      ...internalFromCsv,
      ...(context.internalRecords?.length || internalFromCsv.length ? [] : internalFromConfig),
    ].slice(0, context.maxRecords);

    const externalRecords = [
      ...(context.externalRecords ?? []),
      ...externalFromCsv,
      ...(context.externalRecords?.length || externalFromCsv.length ? [] : externalFromConfig),
    ].slice(0, context.maxRecords);

    return {
      internalRecords,
      externalRecords,
      metadata: {
        adapter: this.code,
        internalSource:
          context.internalRecords?.length || internalFromCsv.length ? 'run_input' : 'job_config',
        externalSource:
          context.externalRecords?.length || externalFromCsv.length ? 'run_input' : 'job_config',
      },
    };
  }
}

/**
 * Built-in Repair & Compensation Handler cho `generic-dataset`:
 * - Hỗ trợ xem trước Dry-Run đầy đủ `beforeSnapshot` / `predictedAfterSnapshot` / `fieldDiffs`.
 * - Hỗ trợ sửa trực tiếp (`DIRECT_REPAIR`) lẫn hành động bù (`COMPENSATING_ACTION`) không làm mất lịch sử.
 */
@Injectable()
export class GenericDatasetRepairHandler implements IDataRepairHandler {
  public readonly code = RECONCILIATION_REPAIR_HANDLER_CODES.GENERIC_DATASET;
  public readonly name = 'Generic Dataset Repair & Compensation';
  public readonly description =
    'Công cụ sửa dữ liệu theo snapshot (Dry-Run trước khi ghi) và tạo bút toán/hành động bù khi bản ghi không thể rollback trực tiếp.';
  public readonly targetModule = 'reconciliation';
  public readonly supportedModes = [
    DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR,
    DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
  ] as const;
  public readonly alwaysSensitive = false;
  public readonly supportsRollback = true;

  public async preview(context: DataRepairHandlerContext): Promise<DataRepairPreviewOutcome> {
    const baseBefore: Record<string, unknown> = {
      entityType: context.target.targetEntityType,
      entityId: context.target.targetEntityId,
      ...(context.target.internalSnapshot ?? {}),
    };

    const patchFields = this.extractPatchFields(context);
    const isCompensating = context.actionMode === DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION;
    const canRollback = !isCompensating && context.payload.nonRollbackable !== true;

    const predictedAfter: Record<string, unknown> = isCompensating
      ? {
          ...baseBefore,
          compensationApplied: true,
          compensationType: String(context.payload.compensationType ?? 'ADJUSTMENT_ENTRY'),
          adjustmentAmount:
            typeof context.payload.adjustmentAmount === 'number'
              ? context.payload.adjustmentAmount
              : context.target.amountDiff !== null && context.target.amountDiff !== undefined
                ? -context.target.amountDiff
                : 0,
          compensationReason: context.reason,
          ...(patchFields.status !== undefined ? { status: patchFields.status } : {}),
        }
      : {
          ...baseBefore,
          ...patchFields,
          repairedByCode: context.repairCode,
        };

    const fieldDiffs = computeFieldDiffs(baseBefore, predictedAfter);
    const sensitivityReasons: string[] = [];
    if (isCompensating) {
      sensitivityReasons.push('Compensating action creates an immutable adjustment record');
    }
    if (patchFields.amount !== undefined || context.payload.adjustmentAmount !== undefined) {
      sensitivityReasons.push('Payload changes financial amount');
    }

    return {
      affectedCount: 1,
      summary: isCompensating
        ? `[DRY-RUN] Preview compensating action (${String(context.payload.compensationType ?? 'ADJUSTMENT_ENTRY')}) for ${context.target.targetEntityId}`
        : `[DRY-RUN] Preview direct repair (${fieldDiffs.length} field changes) for ${context.target.targetEntityId}`,
      beforeSnapshot: baseBefore,
      predictedAfterSnapshot: predictedAfter,
      fieldDiffs,
      isSensitive: sensitivityReasons.length > 0,
      sensitivityReasons,
      canRollback,
      dryRunRolledBack: true,
      warnings: !canRollback
        ? ['Record is marked non-rollbackable; future corrections must use a compensating action.']
        : undefined,
    };
  }

  public async apply(context: DataRepairHandlerContext): Promise<DataRepairApplyOutcome> {
    const preview = await this.preview({ ...context, dryRun: false });
    return {
      affectedCount: preview.affectedCount,
      summary: preview.summary.replace('[DRY-RUN] Preview', 'Applied'),
      beforeSnapshot: preview.beforeSnapshot,
      afterSnapshot: {
        ...preview.predictedAfterSnapshot,
        appliedAt: new Date().toISOString(),
        appliedBy: context.actorUserId,
      },
      fieldDiffs: preview.fieldDiffs,
      canRollback: preview.canRollback,
    };
  }

  public async compensate(context: DataRepairCompensateContext): Promise<DataRepairApplyOutcome> {
    const baseBefore: Record<string, unknown> = {
      entityType: context.target.targetEntityType,
      entityId: context.target.targetEntityId,
      ...(context.parentAfterSnapshot ?? context.target.internalSnapshot ?? {}),
    };
    const adjustmentAmount =
      typeof context.payload.adjustmentAmount === 'number'
        ? Math.trunc(context.payload.adjustmentAmount)
        : context.target.amountDiff !== null && context.target.amountDiff !== undefined
          ? -Math.trunc(context.target.amountDiff)
          : 0;

    const compensationEntry = {
      compensationType: context.compensationType,
      parentRepairCode: context.parentRepairCode ?? null,
      adjustmentAmount,
      currency:
        typeof context.payload.currency === 'string'
          ? context.payload.currency.toUpperCase()
          : (baseBefore.currency ?? 'VND'),
      referenceCode:
        typeof context.payload.referenceCode === 'string' && context.payload.referenceCode.trim()
          ? context.payload.referenceCode.trim()
          : `COMP-${context.repairCode}`,
      reason: context.reason,
      recordedAt: new Date().toISOString(),
      recordedBy: context.actorUserId,
    };

    const afterSnapshot: Record<string, unknown> = {
      ...baseBefore,
      compensationApplied: true,
      lastCompensation: compensationEntry,
      ...(typeof context.payload.status === 'string' ? { status: context.payload.status } : {}),
    };

    return {
      affectedCount: 1,
      summary: `Executed compensating action "${context.compensationType}" (${compensationEntry.referenceCode}) without altering historical snapshots`,
      beforeSnapshot: baseBefore,
      afterSnapshot,
      fieldDiffs: computeFieldDiffs(baseBefore, afterSnapshot),
      canRollback: false,
      compensationDetails: compensationEntry,
    };
  }

  private extractPatchFields(context: DataRepairHandlerContext): Record<string, unknown> {
    const payload = context.payload;
    if (payload.patch && typeof payload.patch === 'object' && !Array.isArray(payload.patch)) {
      return { ...(payload.patch as Record<string, unknown>) };
    }
    const result: Record<string, unknown> = {};
    if (payload.syncFromExternal === true && context.target.externalSnapshot) {
      if (context.target.externalSnapshot.status !== undefined) {
        result.status = context.target.externalSnapshot.status;
      }
      if (context.target.externalSnapshot.amount !== undefined) {
        result.amount = context.target.externalSnapshot.amount;
      }
      if (context.target.externalSnapshot.currency !== undefined) {
        result.currency = context.target.externalSnapshot.currency;
      }
    }
    for (const key of ['status', 'amount', 'currency', 'note'] as const) {
      if (payload[key] !== undefined) {
        result[key] = payload[key];
      }
    }
    return result;
  }
}
