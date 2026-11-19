import { Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  AppException,
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
  PAYMENT_REFUND_STATUS,
  PAYMENT_REFUND_TYPE,
  PAYMENT_SEQUENCE_KEYS,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentRefundType,
} from '../enum/payments.enum.js';
import type { PaymentRefundEntity } from '../entities/payment-refund.entity.js';
import type { PaymentTransactionEntity } from '../entities/payment-transaction.entity.js';
import { assertSafeMinorAmount } from '../helpers/payment-bigint.helper.js';
import {
  allocatePaymentCode,
  resolvePaymentRuntimeConfig,
} from '../helpers/payment-config.helper.js';
import {
  computeIdempotencyFingerprint,
  resolveIdempotencyKey,
} from '../helpers/payment-idempotency.helper.js';
import {
  sanitizePaymentErrorMessage,
  serializeRedactedPaymentPayload,
} from '../helpers/payment-redaction.helper.js';
import { isRefundablePaymentStatus } from '../helpers/payment-state-machine.helper.js';
import { PaymentRefundRepository } from '../repositories/payment-refund.repository.js';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository.js';
import type { ListPaymentRefundsQuery } from '../requests/payments.requests.js';
import { PaymentResponseMapper } from '../responses/payments.response.js';
import type {
  PaymentRefundView,
  RefundPaymentInput,
  RefundPaymentResult,
} from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';
import { PaymentProvidersService } from './payment-providers.service.js';

@Injectable()
export class PaymentRefundsService {
  private readonly logger = new Logger(PaymentRefundsService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;

  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly refundRepo: PaymentRefundRepository,
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

  public async refundPayment(
    transactionId: number,
    input: RefundPaymentInput,
    options?: {
      readonly headerIdempotencyKey?: string | undefined;
      readonly actor?: UserIdentity | undefined;
    },
  ): Promise<RefundPaymentResult> {
    const idempotencyKey = resolveIdempotencyKey(
      options?.headerIdempotencyKey,
      input.idempotencyKey,
    );
    const runtimeConfig = resolvePaymentRuntimeConfig(this.settingRegistry);
    const actorUserId = parseNumericUserId(options?.actor?.id);
    const requestFingerprint = computeIdempotencyFingerprint({
      transactionId: Number(transactionId),
      amount: input.amount ?? null,
      reason: input.reason?.trim() ?? null,
      metadata: input.metadata ?? {},
    });

    const existingRefund = await this.refundRepo.findByIdempotencyKey(idempotencyKey);
    if (existingRefund) {
      if (existingRefund.requestFingerprint !== requestFingerprint) {
        throw new ConflictAppException('payments.idempotencyConflict', [{ idempotencyKey }]);
      }
      const existingTx = await this.transactionRepo.findByIdSafe(
        existingRefund.paymentTransactionId,
      );
      if (!existingTx) {
        throw new NotFoundAppException('payments.transactionNotFound', {
          id: existingRefund.paymentTransactionId,
        });
      }
      return {
        idempotentReplay: true,
        refund: PaymentResponseMapper.toRefundView(existingRefund),
        transaction: PaymentResponseMapper.toTransactionView(existingTx),
      };
    }

    const reserveWork = async (): Promise<{
      readonly refund: PaymentRefundEntity;
      readonly tx: PaymentTransactionEntity;
    }> => {
      const lockedTx = await this.transactionRepo.findByIdForUpdate(transactionId);
      if (!lockedTx) {
        throw new NotFoundAppException('payments.transactionNotFound', { id: transactionId });
      }
      if (!isRefundablePaymentStatus(lockedTx.status)) {
        throw new BadRequestAppException('payments.transactionNotRefundable', [
          {
            status: lockedTx.status,
          },
        ]);
      }

      const remaining = Number(lockedTx.amount) - Number(lockedTx.refundedAmount);
      const inFlight = await this.refundRepo.getPendingOrProcessingAmount(lockedTx.id);
      const available = remaining - inFlight;

      const requestedAmount =
        input.amount !== undefined ? assertSafeMinorAmount(input.amount) : remaining;
      if (requestedAmount <= 0 || requestedAmount > available) {
        throw new ConflictAppException('payments.refundAmountExceeded', [
          {
            requestedAmount,
            availableRefundableAmount: available,
          },
        ]);
      }

      const refundType: PaymentRefundType =
        Number(lockedTx.refundedAmount) === 0 && requestedAmount === Number(lockedTx.amount)
          ? PAYMENT_REFUND_TYPE.FULL
          : PAYMENT_REFUND_TYPE.PARTIAL;

      const providerEntity = await this.providersService.resolveProviderEntityByCode(
        lockedTx.providerCode,
      );
      const adapterMeta = this.adapterRegistry
        .getAdapterOrThrow(providerEntity.driverCode)
        .getMetadata();
      if (
        refundType === PAYMENT_REFUND_TYPE.PARTIAL &&
        (!providerEntity.supportsPartialRefund || !adapterMeta.supportsPartialRefund)
      ) {
        throw new BadRequestAppException('payments.partialRefundNotSupported', [
          {
            providerCode: providerEntity.providerCode,
          },
        ]);
      }

      const refundCode = await allocatePaymentCode(
        this.sequenceRegistry,
        PAYMENT_SEQUENCE_KEYS.REFUND_CODE,
        'RFD',
        lockedTx.organizationUnitId,
      );

      const createdRefund = await this.refundRepo.saveEntity({
        refundCode,
        paymentTransactionId: Number(lockedTx.id),
        paymentCode: lockedTx.paymentCode,
        providerCode: lockedTx.providerCode,
        idempotencyKey,
        requestFingerprint,
        refundType,
        amount: requestedAmount,
        currency: lockedTx.currency,
        status: PAYMENT_REFUND_STATUS.PROCESSING,
        providerRefundId: null,
        reason: input.reason?.trim() || null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        providerRawResponseRedactedJson: null,
        refundedAt: null,
        failureCode: null,
        failureMessage: null,
        createdBy: actorUserId,
      });

      return { refund: createdRefund, tx: lockedTx };
    };

    const reserved = this.transactionManager
      ? await this.transactionManager.runInTransaction(reserveWork)
      : await reserveWork();

    const providerEntity = await this.providersService.resolveProviderEntityByCode(
      reserved.tx.providerCode,
    );
    const resolvedConfig = this.providersService.buildAdapterResolvedConfig(providerEntity);
    const adapter = this.adapterRegistry.getAdapterOrThrow(providerEntity.driverCode);

    try {
      const adapterResult = await adapter.refund({
        config: resolvedConfig,
        paymentCode: reserved.tx.paymentCode,
        refundCode: reserved.refund.refundCode,
        idempotencyKey,
        refundType: reserved.refund.refundType,
        refundAmount: Number(reserved.refund.amount),
        originalAmount: Number(reserved.tx.amount),
        currency: reserved.tx.currency,
        providerTransactionId: reserved.tx.providerTransactionId,
        merchantOrderRef: reserved.tx.merchantOrderRef,
        paidAt: reserved.tx.paidAt,
        reason: reserved.refund.reason,
        actorIdentifier:
          options?.actor?.email ??
          options?.actor?.username ??
          (actorUserId ? `user:${actorUserId}` : 'system'),
      });

      const finalizeWork = async (): Promise<{
        readonly finalizedRefund: PaymentRefundEntity;
        readonly finalizedTx: PaymentTransactionEntity;
      }> => {
        const lockedTx =
          (await this.transactionRepo.findByIdForUpdate(reserved.tx.id)) ?? reserved.tx;
        const refundEntity =
          (await this.refundRepo.findByIdSafe(reserved.refund.id)) ?? reserved.refund;

        refundEntity.status = adapterResult.status;
        refundEntity.providerRefundId = adapterResult.providerRefundId;
        refundEntity.refundedAt = adapterResult.refundedAt;
        refundEntity.failureCode = adapterResult.failureCode;
        refundEntity.failureMessage = sanitizePaymentErrorMessage(adapterResult.failureMessage);
        refundEntity.providerRawResponseRedactedJson = serializeRedactedPaymentPayload(
          adapterResult.rawResponse,
          runtimeConfig.maxStoredPayloadBytes,
        );

        if (adapterResult.status === PAYMENT_REFUND_STATUS.SUCCEEDED) {
          const nextRefunded = Number(lockedTx.refundedAmount) + Number(refundEntity.amount);
          lockedTx.refundedAmount = nextRefunded;
          lockedTx.status =
            nextRefunded >= Number(lockedTx.amount)
              ? PAYMENT_TRANSACTION_STATUS.REFUNDED
              : PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED;
        }

        const finalizedRefund = await this.refundRepo.saveEntity(refundEntity);
        const finalizedTx = await this.transactionRepo.saveEntity(lockedTx);
        return { finalizedRefund, finalizedTx };
      };

      const finalized = this.transactionManager
        ? await this.transactionManager.runInTransaction(finalizeWork)
        : await finalizeWork();

      const refundView = PaymentResponseMapper.toRefundView(finalized.finalizedRefund);
      const txView = PaymentResponseMapper.toTransactionView(finalized.finalizedTx);

      await this.auditLogService?.record({
        actor: options?.actor ?? null,
        actorUserId,
        module: PAYMENT_AUDIT_META.MODULE,
        feature: PAYMENT_AUDIT_META.FEATURES.REFUNDS,
        action: refundView.status === PAYMENT_REFUND_STATUS.SUCCEEDED ? 'REFUND' : 'REFUND_FAILED',
        resourceType: 'payment_refund',
        resourceId: String(refundView.id),
        beforeData: {
          paymentTransactionId: txView.id,
          refundType: refundView.refundType,
        },
        afterData: {
          refundCode: refundView.refundCode,
          amount: refundView.amount,
          status: refundView.statusName,
          txRefundedAmount: txView.refundedAmount,
          txStatus: txView.statusName,
        },
        reason: refundView.reason ?? `${refundView.refundType} refund for ${txView.paymentCode}`,
      });

      const eventName =
        refundView.status === PAYMENT_REFUND_STATUS.SUCCEEDED
          ? PAYMENT_EVENTS.REFUND_SUCCEEDED
          : PAYMENT_EVENTS.REFUND_FAILED;
      await this.publishEventSafe(eventName, {
        refundId: refundView.id,
        refundCode: refundView.refundCode,
        paymentCode: txView.paymentCode,
        refundType: refundView.refundType,
        amount: refundView.amount,
        currency: refundView.currency,
        status: refundView.statusName,
      });

      return { idempotentReplay: false, refund: refundView, transaction: txView };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reserved.refund.status = PAYMENT_REFUND_STATUS.FAILED;
      reserved.refund.failureCode = err instanceof AppException ? err.code : 'GATEWAY_ERROR';
      reserved.refund.failureMessage = sanitizePaymentErrorMessage(msg);
      await this.refundRepo.saveEntity(reserved.refund);

      if (err instanceof AppException) {
        throw err;
      }
      throw new BadRequestAppException('payments.providerGatewayError', [
        {
          message: reserved.refund.failureMessage ?? 'Refund gateway error',
        },
      ]);
    }
  }

  public async listRefunds(
    query: ListPaymentRefundsQuery,
  ): Promise<PaginatedResult<PaymentRefundView>> {
    const paged = await this.refundRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((r) => PaymentResponseMapper.toRefundView(r)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
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
