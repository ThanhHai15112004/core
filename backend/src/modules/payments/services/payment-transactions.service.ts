import { performance } from 'node:perf_hooks';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { isUniqueConstraintError } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  AppException,
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  PROVIDER_TYPE,
  ProviderRegistryService,
  SequenceRegistryService,
  SettingRegistryService,
  defaultProviderRegistry,
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
  PAYMENT_SEQUENCE_KEYS,
  PAYMENT_TRANSACTION_STATUS,
} from '../enum/payments.enum.js';
import { assertSafeMinorAmount } from '../helpers/payment-bigint.helper.js';
import {
  allocatePaymentCode,
  normalizeCurrencyCode,
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
import { PaymentCallbackRepository } from '../repositories/payment-callback.repository.js';
import { PaymentProviderRepository } from '../repositories/payment-provider.repository.js';
import { PaymentRefundRepository } from '../repositories/payment-refund.repository.js';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository.js';
import type { ListPaymentTransactionsQuery } from '../requests/payments.requests.js';
import { PaymentResponseMapper } from '../responses/payments.response.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  ListPaymentTransactionsInput,
  PaymentTransactionView,
} from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';
import { PaymentProvidersService } from './payment-providers.service.js';

@Injectable()
export class PaymentTransactionsService {
  private readonly logger = new Logger(PaymentTransactionsService.name);
  private readonly settingRegistry: SettingRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly providerRegistry: ProviderRegistryService;

  constructor(
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly providerRepo: PaymentProviderRepository,
    private readonly refundRepo: PaymentRefundRepository,
    private readonly callbackRepo: PaymentCallbackRepository,
    private readonly providersService: PaymentProvidersService,
    private readonly adapterRegistry: PaymentAdapterRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional() providerRegistry?: ProviderRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.providerRegistry = providerRegistry ?? defaultProviderRegistry;
  }

  public async createPayment(
    input: CreatePaymentInput,
    options?: {
      readonly headerIdempotencyKey?: string | undefined;
      readonly actor?: UserIdentity | undefined;
    },
  ): Promise<CreatePaymentResult> {
    const idempotencyKey = resolveIdempotencyKey(
      options?.headerIdempotencyKey,
      input.idempotencyKey,
    );
    const amount = assertSafeMinorAmount(input.amount);
    const runtimeConfig = resolvePaymentRuntimeConfig(this.settingRegistry);
    const currency = normalizeCurrencyCode(input.currency ?? runtimeConfig.defaultCurrency);
    const provider = await this.providersService.resolveActiveProviderEntity(
      input.providerCode,
      input.organizationUnitId ?? null,
    );
    const resolvedConfig = this.providersService.buildAdapterResolvedConfig(provider);

    if (!resolvedConfig.allowedCurrencies.includes(currency)) {
      throw new BadRequestAppException('payments.currencyNotSupported', [
        {
          currency,
          providerCode: provider.providerCode,
        },
      ]);
    }

    const requestFingerprint = computeIdempotencyFingerprint({
      providerCode: provider.providerCode,
      merchantOrderRef: input.merchantOrderRef.trim(),
      amount,
      currency,
      description: input.description?.trim() ?? null,
      returnUrl: input.returnUrl?.trim() ?? null,
      cancelUrl: input.cancelUrl?.trim() ?? null,
      customer: input.customer ?? null,
      metadata: input.metadata ?? {},
      organizationUnitId: input.organizationUnitId ?? null,
    });

    const existing = await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ConflictAppException('payments.idempotencyConflict', [{ idempotencyKey }]);
      }
      return {
        idempotentReplay: true,
        transaction: PaymentResponseMapper.toTransactionView(existing),
      };
    }

    const adapter = this.adapterRegistry.getAdapterOrThrow(provider.driverCode);
    const paymentCode = await allocatePaymentCode(
      this.sequenceRegistry,
      PAYMENT_SEQUENCE_KEYS.TRANSACTION_CODE,
      'PAY',
      input.organizationUnitId,
    );
    const expiresInSeconds = input.expiresInSeconds ?? runtimeConfig.defaultExpirySeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const actorUserId = parseNumericUserId(options?.actor?.id);
    const description = input.description?.trim() || `Payment ${input.merchantOrderRef.trim()}`;

    let txEntity;
    try {
      txEntity = await this.transactionRepo.saveEntity({
        paymentCode,
        idempotencyKey,
        requestFingerprint,
        providerId: Number(provider.id),
        providerCode: provider.providerCode,
        driverCode: provider.driverCode,
        providerTransactionId: null,
        merchantOrderRef: input.merchantOrderRef.trim(),
        amount,
        refundedAmount: 0,
        currency,
        status: PAYMENT_TRANSACTION_STATUS.PENDING,
        description,
        checkoutUrl: null,
        qrPayload: null,
        returnUrl: input.returnUrl?.trim() || null,
        cancelUrl: input.cancelUrl?.trim() || null,
        customerJson: input.customer ? JSON.stringify(input.customer) : null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        providerRawResponseRedactedJson: null,
        paidAt: null,
        expiredAt: expiresAt,
        lastCallbackAt: null,
        failureCode: null,
        failureMessage: null,
        organizationUnitId: input.organizationUnitId ?? null,
        createdBy: actorUserId,
      });
    } catch (err) {
      if (err instanceof ConflictAppException || isUniqueConstraintError(err)) {
        const raced = await this.transactionRepo.findByIdempotencyKey(idempotencyKey);
        if (raced) {
          if (raced.requestFingerprint !== requestFingerprint) {
            throw new ConflictAppException('payments.idempotencyConflict', [{ idempotencyKey }]);
          }
          return {
            idempotentReplay: true,
            transaction: PaymentResponseMapper.toTransactionView(raced),
          };
        }
      }
      throw err;
    }

    const gatewayStarted = performance.now();
    try {
      const adapterResult = await adapter.createPayment({
        config: resolvedConfig,
        paymentCode: txEntity.paymentCode,
        idempotencyKey,
        merchantOrderRef: txEntity.merchantOrderRef,
        amount,
        currency,
        description,
        returnUrl: txEntity.returnUrl,
        cancelUrl: txEntity.cancelUrl,
        locale: input.locale?.trim() || 'vi',
        expiresAt,
        customer: input.customer ?? null,
        metadata: input.metadata ?? {},
      });
      const gatewayLatencyMs = performance.now() - gatewayStarted;
      const gatewaySucceeded = adapterResult.status !== PAYMENT_TRANSACTION_STATUS.FAILED;

      if (this.providerRegistry.hasProvidersOfType(PROVIDER_TYPE.PAYMENT)) {
        void this.providerRegistry.recordInvocation({
          providerType: PROVIDER_TYPE.PAYMENT,
          providerCode: provider.providerCode,
          driverCode: provider.driverCode,
          success: gatewaySucceeded,
          latencyMs: gatewayLatencyMs,
          errorCode: gatewaySucceeded ? null : 'PROVIDER_INITIATION_FAILED',
          organizationUnitId: input.organizationUnitId ?? null,
        });
      }

      txEntity.providerTransactionId = adapterResult.providerTransactionId;
      txEntity.status = adapterResult.status;
      txEntity.checkoutUrl = adapterResult.checkoutUrl;
      txEntity.qrPayload = adapterResult.qrPayload;
      txEntity.providerRawResponseRedactedJson = serializeRedactedPaymentPayload(
        adapterResult.rawResponse,
        runtimeConfig.maxStoredPayloadBytes,
      );
      if (adapterResult.status === PAYMENT_TRANSACTION_STATUS.FAILED) {
        txEntity.failureCode = 'PROVIDER_INITIATION_FAILED';
        txEntity.failureMessage = 'Provider rejected payment initiation';
      }

      const updated = await this.transactionRepo.saveEntity(txEntity);
      await this.providerRepo.updateTelemetry(provider.id, { lastSuccessAt: new Date() });

      const view = PaymentResponseMapper.toTransactionView(updated);
      await this.auditLogService?.record({
        actor: options?.actor ?? null,
        actorUserId,
        module: PAYMENT_AUDIT_META.MODULE,
        feature: PAYMENT_AUDIT_META.FEATURES.TRANSACTIONS,
        action: 'CREATE',
        resourceType: 'payment_transaction',
        resourceId: String(updated.id),
        beforeData: null,
        afterData: view as unknown as Record<string, unknown>,
        reason: `Created payment ${updated.paymentCode} via ${updated.providerCode}`,
      });

      await this.publishEventSafe(PAYMENT_EVENTS.TRANSACTION_CREATED, {
        paymentId: view.id,
        paymentCode: view.paymentCode,
        providerCode: view.providerCode,
        amount: view.amount,
        currency: view.currency,
        status: view.statusName,
      });

      return { idempotentReplay: false, transaction: view };
    } catch (err) {
      const gatewayLatencyMs = performance.now() - gatewayStarted;
      const msg = err instanceof Error ? err.message : String(err);
      txEntity.status = PAYMENT_TRANSACTION_STATUS.FAILED;
      txEntity.failureCode = err instanceof AppException ? err.code : 'GATEWAY_ERROR';
      txEntity.failureMessage = sanitizePaymentErrorMessage(msg);
      await this.transactionRepo.saveEntity(txEntity);
      await this.providerRepo.updateTelemetry(provider.id, {
        lastErrorAt: new Date(),
        lastErrorCode: txEntity.failureCode,
      });

      if (this.providerRegistry.hasProvidersOfType(PROVIDER_TYPE.PAYMENT)) {
        void this.providerRegistry.recordInvocation({
          providerType: PROVIDER_TYPE.PAYMENT,
          providerCode: provider.providerCode,
          driverCode: provider.driverCode,
          success: false,
          latencyMs: gatewayLatencyMs,
          errorCode: txEntity.failureCode,
          errorMessage: txEntity.failureMessage,
          organizationUnitId: input.organizationUnitId ?? null,
        });
      }

      if (err instanceof AppException) {
        throw err;
      }
      throw new BadRequestAppException('payments.providerGatewayError', [
        {
          message: txEntity.failureMessage ?? 'Gateway error',
        },
      ]);
    }
  }

  public async listTransactions(
    query: ListPaymentTransactionsInput | ListPaymentTransactionsQuery = {},
  ): Promise<PaginatedResult<PaymentTransactionView>> {
    const fromDate =
      query.from && !Number.isNaN(Date.parse(query.from)) ? new Date(query.from) : undefined;
    const toDate = query.to && !Number.isNaN(Date.parse(query.to)) ? new Date(query.to) : undefined;

    const paged = await this.transactionRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      providerCode: query.providerCode,
      status: query.status,
      currency: query.currency,
      merchantOrderRef: query.merchantOrderRef,
      search: query.search,
      from: fromDate,
      to: toDate,
    });

    return createPaginatedResult(
      paged.data.map((item) => PaymentResponseMapper.toTransactionView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getTransactionDetail(id: number): Promise<PaymentTransactionView> {
    const entity = await this.transactionRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('payments.transactionNotFound', { id });
    }
    const [refunds, callbacks] = await Promise.all([
      this.refundRepo.listByTransactionId(entity.id),
      this.callbackRepo.listByTransactionId(entity.id),
    ]);
    return PaymentResponseMapper.toTransactionView(entity, { refunds, callbacks });
  }

  public async getTransactionByCode(paymentCode: string): Promise<PaymentTransactionView> {
    const entity = await this.transactionRepo.findByPaymentCode(paymentCode);
    if (!entity) {
      throw new NotFoundAppException('payments.transactionNotFound', { paymentCode });
    }
    const [refunds, callbacks] = await Promise.all([
      this.refundRepo.listByTransactionId(entity.id),
      this.callbackRepo.listByTransactionId(entity.id),
    ]);
    return PaymentResponseMapper.toTransactionView(entity, { refunds, callbacks });
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
