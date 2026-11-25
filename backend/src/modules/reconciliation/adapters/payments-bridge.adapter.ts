import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  DATA_REPAIR_ACTION_MODE,
  NotFoundAppException,
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
  PAYMENTS_PUBLIC_SERVICE,
  type IPaymentsPublicService,
  type PaymentTransactionView,
} from '@modules/payments/contracts/index.js';
import {
  RECONCILIATION_ADAPTER_CODES,
  RECONCILIATION_COMPENSATION_TYPES,
  RECONCILIATION_REPAIR_HANDLER_CODES,
} from '../enum/reconciliation.enum.js';
import { parseComparableRecordsFromCsv } from '../helpers/reconciliation-config.helper.js';
import { computeFieldDiffs } from '../helpers/reconciliation-sensitivity.helper.js';

function mapPaymentTxToComparable(tx: PaymentTransactionView): ReconciliationComparableRecord {
  return {
    recordKey: tx.paymentCode,
    entityType: 'payment_transaction',
    entityId: String(tx.id),
    status: tx.statusName,
    amount: Number(tx.amount),
    currency: tx.currency,
    occurredAt: tx.paidAt ?? tx.createdAt,
    fields: {
      providerCode: tx.providerCode,
      merchantOrderRef: tx.merchantOrderRef,
      providerTransactionId: tx.providerTransactionId,
      refundedAmount: Number(tx.refundedAmount ?? 0),
    },
    raw: {
      id: tx.id,
      paymentCode: tx.paymentCode,
      providerCode: tx.providerCode,
      merchantOrderRef: tx.merchantOrderRef,
      providerTransactionId: tx.providerTransactionId,
      status: tx.statusName,
      amount: Number(tx.amount),
      refundedAmount: Number(tx.refundedAmount ?? 0),
      currency: tx.currency,
    },
  };
}

/**
 * Built-in Bridge Adapter kết nối với `modules/payments` qua `IPaymentsPublicService` (một chiều, không phá vỡ ranh giới module).
 * Đọc giao dịch thanh toán nội bộ trong kỳ và đối soát chéo với sao kê nguồn ngoài (JSON/CSV).
 */
@Injectable()
export class PaymentsBridgeReconciliationAdapter implements IReconciliationSourceAdapter {
  public readonly code = RECONCILIATION_ADAPTER_CODES.PAYMENTS_BRIDGE;
  public readonly name = 'Payments Module Bridge';
  public readonly description =
    'Đọc giao dịch nội bộ từ module Payments qua Public Service và đối soát 2 chiều với sao kê bên ngoài (JSON/CSV).';
  public readonly targetModule = 'payments';
  public readonly supportsExternalUpload = true;
  public readonly defaultMatchingRules = {
    amountTolerance: 0,
    ignoreCaseOnStatus: true,
    statusAliases: {
      PAID: 'SUCCEEDED',
      SUCCESS: 'SUCCEEDED',
      COMPLETED: 'SUCCEEDED',
    },
  };

  constructor(
    @Optional()
    @Inject(PAYMENTS_PUBLIC_SERVICE)
    private readonly paymentsPublicService: IPaymentsPublicService | null = null,
  ) {}

  public async fetchData(
    context: ReconciliationAdapterContext,
  ): Promise<ReconciliationDatasetPair> {
    if (!this.paymentsPublicService) {
      throw new BadRequestAppException('reconciliation.paymentsBridgeUnavailable');
    }

    const providerCode =
      typeof context.parameters?.providerCode === 'string' && context.parameters.providerCode.trim()
        ? context.parameters.providerCode.trim()
        : typeof context.jobConfig.providerCode === 'string' &&
            context.jobConfig.providerCode.trim()
          ? context.jobConfig.providerCode.trim()
          : undefined;

    const internalRecords: ReconciliationComparableRecord[] = [];
    const pageLimit = Math.min(100, Math.max(10, context.maxRecords));
    let page = 1;
    const periodStartMs = context.periodStart.getTime();
    const periodEndMs = context.periodEnd.getTime();

    while (internalRecords.length < context.maxRecords) {
      const paged = await this.paymentsPublicService.listTransactions({
        page,
        limit: pageLimit,
        ...(providerCode ? { providerCode } : {}),
      });

      for (const tx of paged.data) {
        const createdMs = Date.parse(tx.createdAt);
        if (!Number.isNaN(createdMs) && (createdMs < periodStartMs || createdMs > periodEndMs)) {
          continue;
        }
        internalRecords.push(mapPaymentTxToComparable(tx));
        if (internalRecords.length >= context.maxRecords) break;
      }

      if (
        paged.data.length < pageLimit ||
        (paged.meta.total !== null && page * pageLimit >= paged.meta.total)
      ) {
        break;
      }
      page++;
    }

    const externalFromCsv = context.externalCsv?.trim()
      ? parseComparableRecordsFromCsv(context.externalCsv)
      : [];
    const externalRecords = [...(context.externalRecords ?? []), ...externalFromCsv].slice(
      0,
      context.maxRecords,
    );

    return {
      internalRecords,
      externalRecords,
      metadata: {
        adapter: this.code,
        providerCode: providerCode ?? 'ALL',
        fetchedInternalCount: internalRecords.length,
        fetchedExternalCount: externalRecords.length,
      },
    };
  }
}

/**
 * Built-in Repair & Compensation Handler cho `payments-bridge`:
 * - Giao dịch thanh toán đã hoàn tất không thể rollback trực tiếp (`supportsRollback = false`).
 * - Hỗ trợ Dry-Run preview đọc trạng thái giao dịch thật từ `IPaymentsPublicService`.
 * - Hỗ trợ hành động bù: `REFUND_COMPENSATION` (gọi `IPaymentsPublicService.refundPayment` khi có số tiền hoàn hợp lệ)
 *   hoặc `ADJUSTMENT_ENTRY` / `CREDIT_NOTE` / `DEBIT_NOTE` ghi sổ bù không làm mất lịch sử.
 */
@Injectable()
export class PaymentsBridgeRepairHandler implements IDataRepairHandler {
  public readonly code = RECONCILIATION_REPAIR_HANDLER_CODES.PAYMENTS_BRIDGE;
  public readonly name = 'Payments Bridge Compensation & Repair';
  public readonly description =
    'Xem trước Dry-Run và thực thi hành động bù cho giao dịch thanh toán (hoàn tiền bù qua Payments Public Service hoặc ghi bút toán điều chỉnh không mất lịch sử).';
  public readonly targetModule = 'payments';
  public readonly supportedModes = [
    DATA_REPAIR_ACTION_MODE.DIRECT_REPAIR,
    DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION,
  ] as const;
  public readonly alwaysSensitive = true;
  public readonly supportsRollback = false;

  constructor(
    @Optional()
    @Inject(PAYMENTS_PUBLIC_SERVICE)
    private readonly paymentsPublicService: IPaymentsPublicService | null = null,
  ) {}

  public async preview(context: DataRepairHandlerContext): Promise<DataRepairPreviewOutcome> {
    const tx = await this.resolvePaymentTransaction(context.target.targetEntityId);
    const beforeSnapshot: Record<string, unknown> = tx
      ? {
          id: tx.id,
          paymentCode: tx.paymentCode,
          providerCode: tx.providerCode,
          status: tx.statusName,
          amount: Number(tx.amount),
          refundedAmount: Number(tx.refundedAmount ?? 0),
          currency: tx.currency,
        }
      : {
          entityId: context.target.targetEntityId,
          ...(context.target.internalSnapshot ?? {}),
        };

    const compensationType = String(
      context.payload.compensationType ?? RECONCILIATION_COMPENSATION_TYPES.ADJUSTMENT_ENTRY,
    );
    const refundAmount =
      typeof context.payload.refundAmount === 'number' && context.payload.refundAmount > 0
        ? Math.trunc(context.payload.refundAmount)
        : typeof context.payload.adjustmentAmount === 'number' &&
            context.payload.adjustmentAmount > 0
          ? Math.trunc(context.payload.adjustmentAmount)
          : context.target.amountDiff
            ? Math.abs(Math.trunc(context.target.amountDiff))
            : 0;

    const predictedAfter: Record<string, unknown> =
      compensationType === RECONCILIATION_COMPENSATION_TYPES.REFUND_COMPENSATION && tx
        ? {
            ...beforeSnapshot,
            refundedAmount: Number(tx.refundedAmount ?? 0) + refundAmount,
            compensationType,
            compensationAmount: refundAmount,
          }
        : {
            ...beforeSnapshot,
            compensationType,
            adjustmentAmount:
              typeof context.payload.adjustmentAmount === 'number'
                ? Math.trunc(context.payload.adjustmentAmount)
                : refundAmount,
            reconciledStatus:
              typeof context.payload.status === 'string'
                ? context.payload.status
                : beforeSnapshot.status,
          };

    const fieldDiffs = computeFieldDiffs(beforeSnapshot, predictedAfter);
    return {
      affectedCount: 1,
      summary: `[DRY-RUN] Preview payment ${context.actionMode} (${compensationType}) on ${String(beforeSnapshot.paymentCode ?? context.target.targetEntityId)}`,
      beforeSnapshot,
      predictedAfterSnapshot: predictedAfter,
      fieldDiffs,
      isSensitive: true,
      sensitivityReasons: [
        'Payment financial records are immutable and require Maker-Checker approval',
      ],
      canRollback: false,
      dryRunRolledBack: true,
      warnings: [
        'Payment transactions cannot be rolled back directly; corrections are recorded as immutable compensating entries or refunds.',
      ],
    };
  }

  public async apply(context: DataRepairHandlerContext): Promise<DataRepairApplyOutcome> {
    return this.compensate({
      ...context,
      compensationType: String(
        context.payload.compensationType ?? RECONCILIATION_COMPENSATION_TYPES.ADJUSTMENT_ENTRY,
      ),
    });
  }

  public async compensate(context: DataRepairCompensateContext): Promise<DataRepairApplyOutcome> {
    const tx = await this.resolvePaymentTransaction(context.target.targetEntityId);
    const beforeSnapshot: Record<string, unknown> = tx
      ? {
          id: tx.id,
          paymentCode: tx.paymentCode,
          providerCode: tx.providerCode,
          status: tx.statusName,
          amount: Number(tx.amount),
          refundedAmount: Number(tx.refundedAmount ?? 0),
          currency: tx.currency,
        }
      : {
          entityId: context.target.targetEntityId,
          ...(context.target.internalSnapshot ?? {}),
        };

    if (context.compensationType === RECONCILIATION_COMPENSATION_TYPES.REFUND_COMPENSATION) {
      if (!this.paymentsPublicService) {
        throw new BadRequestAppException('reconciliation.paymentsBridgeUnavailable');
      }
      if (!tx) {
        throw new NotFoundAppException('reconciliation.paymentsTransactionMissing', {
          targetEntityId: context.target.targetEntityId,
        });
      }
      const refundAmount =
        typeof context.payload.refundAmount === 'number' && context.payload.refundAmount > 0
          ? Math.trunc(context.payload.refundAmount)
          : Math.max(1, Math.abs(Math.trunc(context.target.amountDiff ?? tx.amount)));

      const refundRes = await this.paymentsPublicService.refundPayment(tx.id, {
        amount: refundAmount,
        reason: `[Reconciliation ${context.repairCode}] ${context.reason}`,
        idempotencyKey: `recon-comp-${context.repairCode}`,
        metadata: {
          reconciliationRepairCode: context.repairCode,
          parentRepairCode: context.parentRepairCode ?? null,
        },
      });

      const afterSnapshot: Record<string, unknown> = {
        ...beforeSnapshot,
        status: refundRes.transaction.statusName,
        refundedAmount: Number(refundRes.transaction.refundedAmount ?? 0),
        compensationRefundCode: refundRes.refund.refundCode,
      };

      return {
        affectedCount: 1,
        summary: `Executed refund compensation ${refundRes.refund.refundCode} (${refundAmount} ${tx.currency}) for payment ${tx.paymentCode}`,
        beforeSnapshot,
        afterSnapshot,
        fieldDiffs: computeFieldDiffs(beforeSnapshot, afterSnapshot),
        canRollback: false,
        compensationDetails: {
          compensationType: context.compensationType,
          refundCode: refundRes.refund.refundCode,
          refundId: refundRes.refund.id,
          refundAmount,
          currency: tx.currency,
        },
      };
    }

    const adjustmentAmount =
      typeof context.payload.adjustmentAmount === 'number'
        ? Math.trunc(context.payload.adjustmentAmount)
        : context.target.amountDiff !== null && context.target.amountDiff !== undefined
          ? -Math.trunc(context.target.amountDiff)
          : 0;

    const compensationDetails = {
      compensationType: context.compensationType,
      paymentCode: tx?.paymentCode ?? context.target.targetEntityId,
      adjustmentAmount,
      currency:
        tx?.currency ??
        (typeof context.payload.currency === 'string' ? context.payload.currency : 'VND'),
      referenceCode: `PAY-COMP-${context.repairCode}`,
      reason: context.reason,
      recordedAt: new Date().toISOString(),
    };

    const afterSnapshot: Record<string, unknown> = {
      ...beforeSnapshot,
      compensationApplied: true,
      compensationEntry: compensationDetails,
    };

    return {
      affectedCount: 1,
      summary: `Recorded payment compensating ledger entry ${compensationDetails.referenceCode} (${adjustmentAmount} ${compensationDetails.currency})`,
      beforeSnapshot,
      afterSnapshot,
      fieldDiffs: computeFieldDiffs(beforeSnapshot, afterSnapshot),
      canRollback: false,
      compensationDetails,
    };
  }

  private async resolvePaymentTransaction(
    targetId: string,
  ): Promise<PaymentTransactionView | null> {
    if (!this.paymentsPublicService) return null;
    const trimmed = targetId.trim();
    if (!trimmed) return null;
    try {
      if (/^\d+$/.test(trimmed)) {
        return await this.paymentsPublicService.getTransactionById(Number(trimmed));
      }
      return await this.paymentsPublicService.getTransactionByCode(trimmed);
    } catch {
      return null;
    }
  }
}
