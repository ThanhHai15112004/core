import { Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  SequenceRegistryService,
  SettingRegistryService,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  PAYMENT_AUDIT_META,
  PAYMENT_EVENTS,
  PAYMENT_RECONCILIATION_DISCREPANCY,
  PAYMENT_RECONCILIATION_RESOLUTION,
  PAYMENT_RECONCILIATION_RESOLVE_ACTION,
  PAYMENT_RECONCILIATION_RUN_STATUS,
  PAYMENT_RECONCILIATION_SOURCE,
  PAYMENT_SEQUENCE_KEYS,
  PAYMENT_TRANSACTION_STATUS,
  getPaymentDiscrepancyName,
  type PaymentReconciliationDiscrepancyCode,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import type { PaymentReconciliationItemEntity } from '../entities/payment-reconciliation-item.entity.js';
import type { PaymentTransactionEntity } from '../entities/payment-transaction.entity.js';
import {
  allocatePaymentCode,
  parseProviderStatementCsv,
  parseProviderStatusInput,
  resolvePaymentRuntimeConfig,
} from '../helpers/payment-config.helper.js';
import { canTransitionPaymentStatus } from '../helpers/payment-state-machine.helper.js';
import { PaymentReconciliationItemRepository } from '../repositories/payment-reconciliation-item.repository.js';
import { PaymentReconciliationRepository } from '../repositories/payment-reconciliation.repository.js';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository.js';
import type {
  GetReconciliationDetailQuery,
  ListPaymentReconciliationsQuery,
  ResolveReconciliationItemRequest,
} from '../requests/payments.requests.js';
import { PaymentResponseMapper } from '../responses/payments.response.js';
import type {
  PaymentReconciliationItemView,
  PaymentReconciliationView,
  ProviderTransactionSnapshot,
  RunReconciliationInput,
} from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';
import { PaymentProvidersService } from './payment-providers.service.js';

interface ReconciliationDraftItem {
  readonly paymentTransactionId: number | null;
  readonly paymentCode: string | null;
  readonly merchantOrderRef: string | null;
  readonly providerTransactionId: string | null;
  readonly discrepancyStatus: PaymentReconciliationDiscrepancyCode;
  readonly internalStatus: PaymentTransactionStatusCode | null;
  readonly providerStatus: PaymentTransactionStatusCode | null;
  readonly internalAmount: number | null;
  readonly providerAmount: number | null;
  readonly internalRefundedAmount: number | null;
  readonly providerRefundedAmount: number | null;
  readonly currency: string | null;
  readonly diffDetails: Record<string, unknown>;
}

const FINANCIAL_INCLUDED_STATUSES = new Set<number>([
  PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
  PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_TRANSACTION_STATUS.REFUNDED,
]);

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly reconRepo: PaymentReconciliationRepository,
    private readonly reconItemRepo: PaymentReconciliationItemRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly providersService: PaymentProvidersService,
    private readonly adapterRegistry: PaymentAdapterRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() private readonly transactionManager?: TransactionManager,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
  }

  public async runReconciliation(
    input: RunReconciliationInput,
    actor?: UserIdentity,
  ): Promise<PaymentReconciliationView> {
    const periodStart =
      input.periodStart instanceof Date ? input.periodStart : new Date(input.periodStart);
    const periodEnd = input.periodEnd instanceof Date ? input.periodEnd : new Date(input.periodEnd);
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodStart.getTime() > periodEnd.getTime()
    ) {
      throw new BadRequestAppException('payments.invalidReconciliationPeriod');
    }

    const providerCode = input.providerCode.trim().toLowerCase();
    const provider = await this.providersService.resolveProviderEntityByCode(providerCode);
    const resolvedConfig = this.providersService.buildAdapterResolvedConfig(provider);
    const adapter = this.adapterRegistry.getAdapterOrThrow(provider.driverCode);
    const runtimeConfig = resolvePaymentRuntimeConfig(this.settingRegistry);
    const actorUserId = parseNumericUserId(actor?.id);

    const internalTxs = await this.transactionRepo.listForReconciliationWindow({
      providerCode,
      periodStart,
      periodEnd,
    });

    const providerSnapshots: ProviderTransactionSnapshot[] = [];

    if (input.sourceMode === PAYMENT_RECONCILIATION_SOURCE.STATEMENT) {
      const parsedCsv = input.statementCsv?.trim()
        ? parseProviderStatementCsv(input.statementCsv)
        : [];
      const combined = [...(input.statementItems ?? []), ...parsedCsv];
      if (combined.length === 0) {
        throw new BadRequestAppException('payments.statementInputRequired');
      }
      for (const rec of combined) {
        providerSnapshots.push({
          providerCode,
          paymentCode: rec.paymentCode?.trim() || null,
          merchantOrderRef: rec.merchantOrderRef?.trim() || null,
          providerTransactionId: rec.providerTransactionId?.trim() || null,
          status: parseProviderStatusInput(rec.status),
          amount: Math.trunc(Number(rec.amount)),
          refundedAmount: Math.trunc(Number(rec.refundedAmount ?? 0)),
          currency: rec.currency.trim().toUpperCase(),
          paidAt: rec.paidAt && !Number.isNaN(Date.parse(rec.paidAt)) ? new Date(rec.paidAt) : null,
          rawSnapshot: rec.raw ?? { ...rec },
        });
      }
    } else {
      const limit = Math.max(1, runtimeConfig.reconcileMaxLiveQueries);
      for (const tx of internalTxs.slice(0, limit)) {
        const snapshot = await adapter.queryTransaction({
          config: resolvedConfig,
          paymentCode: tx.paymentCode,
          merchantOrderRef: tx.merchantOrderRef,
          providerTransactionId: tx.providerTransactionId,
          amount: Number(tx.amount),
          currency: tx.currency,
          createdAt: tx.createdAt,
        });
        if (snapshot) {
          providerSnapshots.push(snapshot);
        }
      }
    }

    const usedProviderIndexes = new Set<number>();
    const byPaymentCode = new Map<string, number>();
    const byProviderTxId = new Map<string, number>();
    const byOrderRef = new Map<string, number>();

    providerSnapshots.forEach((snap, idx) => {
      if (snap.paymentCode && !byPaymentCode.has(snap.paymentCode)) {
        byPaymentCode.set(snap.paymentCode, idx);
      }
      if (snap.providerTransactionId && !byProviderTxId.has(snap.providerTransactionId)) {
        byProviderTxId.set(snap.providerTransactionId, idx);
      }
      if (snap.merchantOrderRef && !byOrderRef.has(snap.merchantOrderRef)) {
        byOrderRef.set(snap.merchantOrderRef, idx);
      }
    });

    const draftItems: ReconciliationDraftItem[] = [];
    const matchedInternalIds = new Set<number>();
    let matchedCount = 0;
    let mismatchCount = 0;
    let missingAtProviderCount = 0;
    let missingInternallyCount = 0;
    let internalTotalAmount = 0;
    let providerTotalAmount = 0;
    const currencies = new Set<string>();

    for (const tx of internalTxs) {
      matchedInternalIds.add(Number(tx.id));
      currencies.add(tx.currency);
      if (FINANCIAL_INCLUDED_STATUSES.has(tx.status)) {
        internalTotalAmount += Number(tx.amount);
      }

      const matchedIdx = this.findMatchingProviderIndex(tx, {
        byPaymentCode,
        byProviderTxId,
        byOrderRef,
        usedProviderIndexes,
      });

      if (matchedIdx === null) {
        missingAtProviderCount++;
        draftItems.push({
          paymentTransactionId: Number(tx.id),
          paymentCode: tx.paymentCode,
          merchantOrderRef: tx.merchantOrderRef,
          providerTransactionId: tx.providerTransactionId,
          discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_AT_PROVIDER,
          internalStatus: tx.status,
          providerStatus: null,
          internalAmount: Number(tx.amount),
          providerAmount: null,
          internalRefundedAmount: Number(tx.refundedAmount ?? 0),
          providerRefundedAmount: null,
          currency: tx.currency,
          diffDetails: { reason: 'Transaction exists internally but missing in provider data' },
        });
        continue;
      }

      usedProviderIndexes.add(matchedIdx);
      const snap = providerSnapshots[matchedIdx]!;
      const comparison = this.comparePair(tx, snap);
      if (comparison.discrepancyStatus === PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED) {
        matchedCount++;
      } else {
        mismatchCount++;
      }

      draftItems.push({
        paymentTransactionId: Number(tx.id),
        paymentCode: tx.paymentCode,
        merchantOrderRef: tx.merchantOrderRef,
        providerTransactionId: snap.providerTransactionId ?? tx.providerTransactionId,
        discrepancyStatus: comparison.discrepancyStatus,
        internalStatus: tx.status,
        providerStatus: snap.status,
        internalAmount: Number(tx.amount),
        providerAmount: Number(snap.amount),
        internalRefundedAmount: Number(tx.refundedAmount ?? 0),
        providerRefundedAmount: Number(snap.refundedAmount ?? 0),
        currency: tx.currency,
        diffDetails: comparison.diffDetails,
      });
    }

    for (let i = 0; i < providerSnapshots.length; i++) {
      const snap = providerSnapshots[i]!;
      currencies.add(snap.currency);
      if (FINANCIAL_INCLUDED_STATUSES.has(snap.status)) {
        providerTotalAmount += Number(snap.amount);
      }
      if (usedProviderIndexes.has(i)) continue;

      const outsideTx = await this.findOutsideWindowInternalTx(providerCode, snap);
      if (outsideTx && !matchedInternalIds.has(Number(outsideTx.id))) {
        matchedInternalIds.add(Number(outsideTx.id));
        if (FINANCIAL_INCLUDED_STATUSES.has(outsideTx.status)) {
          internalTotalAmount += Number(outsideTx.amount);
        }
        const comparison = this.comparePair(outsideTx, snap);
        if (comparison.discrepancyStatus === PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED) {
          matchedCount++;
        } else {
          mismatchCount++;
        }
        draftItems.push({
          paymentTransactionId: Number(outsideTx.id),
          paymentCode: outsideTx.paymentCode,
          merchantOrderRef: outsideTx.merchantOrderRef,
          providerTransactionId: snap.providerTransactionId ?? outsideTx.providerTransactionId,
          discrepancyStatus: comparison.discrepancyStatus,
          internalStatus: outsideTx.status,
          providerStatus: snap.status,
          internalAmount: Number(outsideTx.amount),
          providerAmount: Number(snap.amount),
          internalRefundedAmount: Number(outsideTx.refundedAmount ?? 0),
          providerRefundedAmount: Number(snap.refundedAmount ?? 0),
          currency: outsideTx.currency,
          diffDetails: { ...comparison.diffDetails, matchedOutsidePeriodWindow: true },
        });
        continue;
      }

      missingInternallyCount++;
      draftItems.push({
        paymentTransactionId: null,
        paymentCode: snap.paymentCode,
        merchantOrderRef: snap.merchantOrderRef,
        providerTransactionId: snap.providerTransactionId,
        discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_INTERNALLY,
        internalStatus: null,
        providerStatus: snap.status,
        internalAmount: null,
        providerAmount: Number(snap.amount),
        internalRefundedAmount: null,
        providerRefundedAmount: Number(snap.refundedAmount ?? 0),
        currency: snap.currency,
        diffDetails: { reason: 'Transaction exists at provider but missing in internal database' },
      });
    }

    const reconciliationCode = await allocatePaymentCode(
      this.sequenceRegistry,
      PAYMENT_SEQUENCE_KEYS.RECONCILIATION_CODE,
      'REC',
    );
    const startedAt = new Date();
    const completedAt = new Date();
    const singleCurrency = currencies.size === 1 ? Array.from(currencies)[0]! : 'MULTI';

    const persistRun = async () => {
      const recon = await this.reconRepo.saveEntity({
        reconciliationCode,
        providerCode,
        sourceMode: input.sourceMode,
        periodStart,
        periodEnd,
        status: PAYMENT_RECONCILIATION_RUN_STATUS.COMPLETED,
        totalInternalCount: matchedInternalIds.size,
        totalProviderCount: providerSnapshots.length,
        matchedCount,
        mismatchCount,
        missingAtProviderCount,
        missingInternallyCount,
        internalTotalAmount,
        providerTotalAmount,
        amountDifference: internalTotalAmount - providerTotalAmount,
        currency: singleCurrency,
        summaryJson: JSON.stringify({
          sourceMode: input.sourceMode,
          totalItems: draftItems.length,
          discrepancyTotal: mismatchCount + missingAtProviderCount + missingInternallyCount,
        }),
        startedAt,
        completedAt,
        createdBy: actorUserId,
      });

      const savedItems: PaymentReconciliationItemEntity[] = [];
      for (const item of draftItems) {
        const isMatched = item.discrepancyStatus === PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED;
        const savedItem = await this.reconItemRepo.saveEntity({
          reconciliationId: Number(recon.id),
          providerCode,
          paymentTransactionId: item.paymentTransactionId,
          paymentCode: item.paymentCode,
          merchantOrderRef: item.merchantOrderRef,
          providerTransactionId: item.providerTransactionId,
          discrepancyStatus: item.discrepancyStatus,
          resolutionStatus: isMatched
            ? PAYMENT_RECONCILIATION_RESOLUTION.RESOLVED
            : PAYMENT_RECONCILIATION_RESOLUTION.OPEN,
          internalStatus: item.internalStatus,
          providerStatus: item.providerStatus,
          internalAmount: item.internalAmount,
          providerAmount: item.providerAmount,
          internalRefundedAmount: item.internalRefundedAmount,
          providerRefundedAmount: item.providerRefundedAmount,
          currency: item.currency,
          diffDetailsJson: JSON.stringify(item.diffDetails),
          resolutionNote: isMatched ? 'Auto-matched' : null,
          resolvedBy: null,
          resolvedAt: isMatched ? completedAt : null,
        });
        savedItems.push(savedItem);
      }

      return { recon, savedItems };
    };

    const persisted = this.transactionManager
      ? await this.transactionManager.runInTransaction(persistRun)
      : await persistRun();

    const view = PaymentResponseMapper.toReconciliationView(persisted.recon, persisted.savedItems);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.RECONCILIATION,
      action: 'RECONCILE',
      resourceType: 'payment_reconciliation',
      resourceId: String(view.id),
      beforeData: null,
      afterData: {
        reconciliationCode: view.reconciliationCode,
        providerCode: view.providerCode,
        matchedCount: view.matchedCount,
        mismatchCount: view.mismatchCount,
        missingAtProviderCount: view.missingAtProviderCount,
        missingInternallyCount: view.missingInternallyCount,
        amountDifference: view.amountDifference,
      },
      reason: `Ran ${input.sourceMode} reconciliation for ${providerCode}`,
    });

    await this.publishEventSafe(PAYMENT_EVENTS.RECONCILIATION_COMPLETED, {
      reconciliationId: view.id,
      reconciliationCode: view.reconciliationCode,
      providerCode: view.providerCode,
      matchedCount: view.matchedCount,
      mismatchCount: view.mismatchCount,
      missingAtProviderCount: view.missingAtProviderCount,
      missingInternallyCount: view.missingInternallyCount,
    });

    return view;
  }

  public async listReconciliations(
    query: ListPaymentReconciliationsQuery,
  ): Promise<PaginatedResult<PaymentReconciliationView>> {
    const paged = await this.reconRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((r) => PaymentResponseMapper.toReconciliationView(r)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getReconciliationDetail(
    id: number,
    query?: GetReconciliationDetailQuery,
  ): Promise<PaymentReconciliationView> {
    const recon = await this.reconRepo.findByIdSafe(id);
    if (!recon) {
      throw new NotFoundAppException('payments.reconciliationNotFound', { id });
    }
    const items = await this.reconItemRepo.listByReconciliationId(recon.id, {
      discrepancyStatus: query?.discrepancyStatus as
        PaymentReconciliationDiscrepancyCode | undefined,
      resolutionStatus: query?.resolutionStatus as 1 | 2 | 3 | undefined,
    });
    return PaymentResponseMapper.toReconciliationView(recon, items);
  }

  public async resolveReconciliationItem(
    reconciliationId: number,
    itemId: number,
    input: ResolveReconciliationItemRequest,
    actor?: UserIdentity,
  ): Promise<PaymentReconciliationItemView> {
    const item = await this.reconItemRepo.findByIdAndReconciliationId(itemId, reconciliationId);
    if (!item) {
      throw new NotFoundAppException('payments.reconciliationItemNotFound', {
        reconciliationId,
        itemId,
      });
    }
    if (item.resolutionStatus !== PAYMENT_RECONCILIATION_RESOLUTION.OPEN) {
      throw new ConflictAppException('payments.reconciliationItemAlreadyResolved', [{ itemId }]);
    }

    const actorUserId = parseNumericUserId(actor?.id);
    const beforeState = PaymentResponseMapper.toReconciliationItemView(item);

    const resolveWork = async (): Promise<PaymentReconciliationItemEntity> => {
      if (input.action === PAYMENT_RECONCILIATION_RESOLVE_ACTION.SYNC_FROM_PROVIDER) {
        if (
          item.discrepancyStatus !== PAYMENT_RECONCILIATION_DISCREPANCY.STATUS_MISMATCH ||
          !item.paymentTransactionId ||
          item.providerStatus === null ||
          item.internalAmount === null ||
          item.providerAmount === null ||
          Number(item.internalAmount) !== Number(item.providerAmount)
        ) {
          throw new BadRequestAppException('payments.unsafeSyncFromProvider', [
            {
              discrepancyStatus: getPaymentDiscrepancyName(item.discrepancyStatus),
            },
          ]);
        }

        const tx = await this.transactionRepo.findByIdForUpdate(item.paymentTransactionId);
        if (!tx) {
          throw new NotFoundAppException('payments.transactionNotFound', {
            id: item.paymentTransactionId,
          });
        }
        if (!canTransitionPaymentStatus(tx.status, item.providerStatus)) {
          throw new ConflictAppException('payments.invalidStatusTransition', [
            {
              fromStatus: tx.status,
              toStatus: item.providerStatus,
            },
          ]);
        }

        tx.status = item.providerStatus;
        if (item.providerTransactionId && !tx.providerTransactionId) {
          tx.providerTransactionId = item.providerTransactionId;
        }
        if (item.providerStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED && !tx.paidAt) {
          tx.paidAt = new Date();
        }
        await this.transactionRepo.saveEntity(tx);

        item.resolutionStatus = PAYMENT_RECONCILIATION_RESOLUTION.RESOLVED;
        item.resolutionNote =
          input.note?.trim() || `Synced internal status to ${item.providerStatus}`;
      } else if (input.action === PAYMENT_RECONCILIATION_RESOLVE_ACTION.MARK_RESOLVED) {
        item.resolutionStatus = PAYMENT_RECONCILIATION_RESOLUTION.RESOLVED;
        item.resolutionNote = input.note?.trim() || 'Marked resolved manually';
      } else {
        item.resolutionStatus = PAYMENT_RECONCILIATION_RESOLUTION.IGNORED;
        item.resolutionNote = input.note?.trim() || 'Ignored discrepancy';
      }

      item.resolvedBy = actorUserId;
      item.resolvedAt = new Date();
      return this.reconItemRepo.saveEntity(item);
    };

    const saved = this.transactionManager
      ? await this.transactionManager.runInTransaction(resolveWork)
      : await resolveWork();

    const afterState = PaymentResponseMapper.toReconciliationItemView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.RECONCILIATION,
      action: `RESOLVE_${input.action}`,
      resourceType: 'payment_reconciliation_item',
      resourceId: String(saved.id),
      beforeData: beforeState as unknown as Record<string, unknown>,
      afterData: afterState as unknown as Record<string, unknown>,
      reason: afterState.resolutionNote ?? `Reconciliation item ${saved.id} resolved`,
    });

    return afterState;
  }

  private findMatchingProviderIndex(
    tx: PaymentTransactionEntity,
    indexes: {
      readonly byPaymentCode: Map<string, number>;
      readonly byProviderTxId: Map<string, number>;
      readonly byOrderRef: Map<string, number>;
      readonly usedProviderIndexes: Set<number>;
    },
  ): number | null {
    const candidates: Array<number | undefined> = [
      indexes.byPaymentCode.get(tx.paymentCode),
      tx.providerTransactionId ? indexes.byProviderTxId.get(tx.providerTransactionId) : undefined,
      indexes.byOrderRef.get(tx.merchantOrderRef),
    ];
    for (const idx of candidates) {
      if (idx !== undefined && !indexes.usedProviderIndexes.has(idx)) {
        return idx;
      }
    }
    return null;
  }

  private async findOutsideWindowInternalTx(
    providerCode: string,
    snap: ProviderTransactionSnapshot,
  ): Promise<PaymentTransactionEntity | null> {
    if (snap.paymentCode) {
      const byCode = await this.transactionRepo.findByPaymentCode(snap.paymentCode);
      if (byCode && byCode.providerCode === providerCode) return byCode;
    }
    if (snap.providerTransactionId) {
      const byProviderTx = await this.transactionRepo.findByProviderTransactionId(
        providerCode,
        snap.providerTransactionId,
      );
      if (byProviderTx) return byProviderTx;
    }
    return null;
  }

  private comparePair(
    tx: PaymentTransactionEntity,
    snap: ProviderTransactionSnapshot,
  ): {
    readonly discrepancyStatus: PaymentReconciliationDiscrepancyCode;
    readonly diffDetails: Record<string, unknown>;
  } {
    const amountDiff = Number(tx.amount) !== Number(snap.amount);
    const currencyDiff = tx.currency.toUpperCase() !== snap.currency.toUpperCase();
    const refundDiff = Number(tx.refundedAmount ?? 0) !== Number(snap.refundedAmount ?? 0);
    const statusDiff = tx.status !== snap.status;

    if (amountDiff || currencyDiff) {
      return {
        discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.AMOUNT_MISMATCH,
        diffDetails: {
          amountMismatch: amountDiff,
          currencyMismatch: currencyDiff,
          internalAmount: Number(tx.amount),
          providerAmount: Number(snap.amount),
          internalCurrency: tx.currency,
          providerCurrency: snap.currency,
        },
      };
    }

    if (refundDiff) {
      return {
        discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.REFUND_MISMATCH,
        diffDetails: {
          internalRefundedAmount: Number(tx.refundedAmount ?? 0),
          providerRefundedAmount: Number(snap.refundedAmount ?? 0),
        },
      };
    }

    if (statusDiff) {
      return {
        discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.STATUS_MISMATCH,
        diffDetails: {
          internalStatus: tx.status,
          providerStatus: snap.status,
        },
      };
    }

    return {
      discrepancyStatus: PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED,
      diffDetails: {},
    };
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
