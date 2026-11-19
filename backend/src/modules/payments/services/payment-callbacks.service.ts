import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult, maskIp } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
  parseNumericUserId,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { SandboxPaymentAdapter } from '../adapters/sandbox-payment.adapter.js';
import {
  PAYMENT_AUDIT_META,
  PAYMENT_CALLBACK_STATUS,
  PAYMENT_DRIVER_CODE,
  PAYMENT_EVENTS,
  PAYMENT_PROVIDER_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  getPaymentCallbackStatusName,
  type PaymentCallbackStatusCode,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import type { PaymentCallbackEntity } from '../entities/payment-callback.entity.js';
import type { PaymentTransactionEntity } from '../entities/payment-transaction.entity.js';
import { resolvePaymentRuntimeConfig } from '../helpers/payment-config.helper.js';
import {
  redactPaymentHeaders,
  sanitizePaymentErrorMessage,
  serializeRedactedPaymentPayload,
} from '../helpers/payment-redaction.helper.js';
import { sha256PayloadHex } from '../helpers/payment-signature.helper.js';
import { canTransitionPaymentStatus } from '../helpers/payment-state-machine.helper.js';
import { PaymentCallbackRepository } from '../repositories/payment-callback.repository.js';
import { PaymentProviderRepository } from '../repositories/payment-provider.repository.js';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository.js';
import type { ListPaymentCallbacksQuery } from '../requests/payments.requests.js';
import { PaymentResponseMapper } from '../responses/payments.response.js';
import type {
  PaymentCallbackView,
  ReceivePaymentCallbackInput,
  ReceivePaymentCallbackResult,
  SimulatePaymentCallbackInput,
  VerifiedPaymentCallback,
} from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';
import { PaymentProvidersService } from './payment-providers.service.js';

@Injectable()
export class PaymentCallbacksService {
  private readonly logger = new Logger(PaymentCallbacksService.name);
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly callbackRepo: PaymentCallbackRepository,
    private readonly transactionRepo: PaymentTransactionRepository,
    private readonly providerRepo: PaymentProviderRepository,
    private readonly providersService: PaymentProvidersService,
    private readonly adapterRegistry: PaymentAdapterRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly transactionManager?: TransactionManager,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async receiveCallback(
    input: ReceivePaymentCallbackInput,
  ): Promise<ReceivePaymentCallbackResult> {
    const providerCode = input.providerCode.trim().toLowerCase();
    const provider = await this.providersService.resolveProviderEntityByCode(providerCode);
    if (!provider.isEnabled || provider.status !== PAYMENT_PROVIDER_STATUS.ACTIVE) {
      throw new BadRequestAppException('payments.providerDisabled', [{ providerCode }]);
    }

    const runtimeConfig = resolvePaymentRuntimeConfig(this.settingRegistry);
    const resolvedConfig = this.providersService.buildAdapterResolvedConfig(provider);
    const adapter = this.adapterRegistry.getAdapterOrThrow(provider.driverCode);
    const headersLower = this.normalizeHeaders(input.headers);
    const serializedRaw =
      input.rawBody ||
      (input.parsedBody !== undefined && input.parsedBody !== null
        ? JSON.stringify(input.parsedBody)
        : JSON.stringify(input.query ?? {}));
    const payloadSha256 = sha256PayloadHex(serializedRaw);
    const sourceIpMasked = input.sourceIp ? maskIp(input.sourceIp) : null;

    const verified = await adapter.verifyCallback({
      config: resolvedConfig,
      httpMethod: input.httpMethod,
      rawBody: serializedRaw,
      parsedBody: input.parsedBody ?? {},
      query: input.query ?? {},
      headers: headersLower,
      nowSec: input.nowSec,
    });

    if (!verified.signatureValid) {
      await this.recordRejectedCallback({
        providerId: Number(provider.id),
        providerCode,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.INVALID_SIGNATURE,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: verified.rejectionReason ?? 'Invalid signature',
        recordRejected: runtimeConfig.recordRejectedCallbacks,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });
      await this.providerRepo.updateTelemetry(provider.id, {
        lastErrorAt: new Date(),
        lastErrorCode: verified.rejectionCode ?? 'INVALID_SIGNATURE',
      });
      throw new UnauthorizedAppException('payments.invalidCallbackSignature', [
        {
          reason: verified.rejectionReason,
        },
      ]);
    }

    const existingDuplicate = await this.callbackRepo.findVerifiedDuplicate({
      providerCode,
      providerEventId: verified.providerEventId,
      payloadSha256,
    });

    if (existingDuplicate) {
      const existingTx = existingDuplicate.paymentTransactionId
        ? await this.transactionRepo.findByIdSafe(existingDuplicate.paymentTransactionId)
        : null;
      const dupCallback = await this.persistCallbackRow({
        providerId: Number(provider.id),
        providerCode,
        tx: existingTx,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.DUPLICATE,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: 'Duplicate verified callback event',
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });

      return {
        accepted: true,
        duplicate: true,
        verificationStatus: PAYMENT_CALLBACK_STATUS.DUPLICATE,
        verificationStatusName: getPaymentCallbackStatusName(PAYMENT_CALLBACK_STATUS.DUPLICATE),
        callbackId: Number(dupCallback.id),
        callbackUid: dupCallback.callbackUid,
        transaction: existingTx ? PaymentResponseMapper.toTransactionView(existingTx) : null,
        ackBody: verified.ackBody,
      };
    }

    const tx = await this.findTargetTransaction(providerCode, verified);
    if (!tx) {
      await this.recordRejectedCallback({
        providerId: Number(provider.id),
        providerCode,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.TRANSACTION_NOT_FOUND,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: 'Matching internal payment transaction not found',
        recordRejected: runtimeConfig.recordRejectedCallbacks,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });
      throw new NotFoundAppException('payments.transactionNotFound', undefined, [
        {
          paymentCode: verified.paymentCode,
          providerTransactionId: verified.providerTransactionId,
        },
      ]);
    }

    if (verified.reportedAmount === null || Number(verified.reportedAmount) !== Number(tx.amount)) {
      const reason = `Amount mismatch: expected ${tx.amount}, got ${String(verified.reportedAmount)}`;
      await this.recordRejectedCallback({
        providerId: Number(provider.id),
        providerCode,
        tx,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.AMOUNT_MISMATCH,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: reason,
        recordRejected: runtimeConfig.recordRejectedCallbacks,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });
      throw new BadRequestAppException('payments.callbackAmountMismatch', [
        {
          expectedAmount: tx.amount,
          reportedAmount: verified.reportedAmount,
        },
      ]);
    }

    if (
      !verified.reportedCurrency ||
      verified.reportedCurrency.toUpperCase() !== tx.currency.toUpperCase()
    ) {
      const reason = `Currency mismatch: expected ${tx.currency}, got ${String(verified.reportedCurrency)}`;
      await this.recordRejectedCallback({
        providerId: Number(provider.id),
        providerCode,
        tx,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.CURRENCY_MISMATCH,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: reason,
        recordRejected: runtimeConfig.recordRejectedCallbacks,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });
      throw new BadRequestAppException('payments.callbackCurrencyMismatch', [
        {
          expectedCurrency: tx.currency,
          reportedCurrency: verified.reportedCurrency,
        },
      ]);
    }

    if (
      tx.providerTransactionId &&
      verified.providerTransactionId &&
      tx.providerTransactionId !== verified.providerTransactionId &&
      !(
        tx.driverCode === PAYMENT_DRIVER_CODE.STRIPE &&
        tx.providerTransactionId.startsWith('cs_') &&
        verified.providerTransactionId.startsWith('pi_')
      )
    ) {
      const reason = `Provider transaction ref mismatch: expected ${tx.providerTransactionId}, got ${verified.providerTransactionId}`;
      await this.recordRejectedCallback({
        providerId: Number(provider.id),
        providerCode,
        tx,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.REJECTED,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: reason,
        recordRejected: runtimeConfig.recordRejectedCallbacks,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });
      throw new BadRequestAppException('payments.callbackTransactionRefMismatch', [
        {
          expected: tx.providerTransactionId,
          actual: verified.providerTransactionId,
        },
      ]);
    }

    const targetStatus: PaymentTransactionStatusCode =
      verified.reportedStatus ?? PAYMENT_TRANSACTION_STATUS.SUCCEEDED;

    const runInTx = async (): Promise<{
      readonly savedTx: PaymentTransactionEntity;
      readonly savedCallback: PaymentCallbackEntity;
      readonly beforeStatus: PaymentTransactionStatusCode;
    }> => {
      const lockedTx = (await this.transactionRepo.findByIdForUpdate(tx.id)) ?? tx;
      const beforeStatus = lockedTx.status;

      if (!canTransitionPaymentStatus(lockedTx.status, targetStatus)) {
        const rejReason = `Illegal transition from ${lockedTx.status} to ${targetStatus}`;
        await this.recordRejectedCallback({
          providerId: Number(provider.id),
          providerCode,
          tx: lockedTx,
          httpMethod: input.httpMethod,
          verificationStatus: PAYMENT_CALLBACK_STATUS.REJECTED,
          verified,
          headers: headersLower,
          payloadSha256,
          sourceIpMasked,
          rejectionReason: rejReason,
          recordRejected: runtimeConfig.recordRejectedCallbacks,
          maxBytes: runtimeConfig.maxStoredPayloadBytes,
        });
        throw new ConflictAppException('payments.invalidStatusTransition', [
          {
            fromStatus: lockedTx.status,
            toStatus: targetStatus,
          },
        ]);
      }

      lockedTx.status = targetStatus;
      lockedTx.lastCallbackAt = new Date();
      if (verified.providerTransactionId) {
        lockedTx.providerTransactionId = verified.providerTransactionId;
      }
      if (targetStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED && !lockedTx.paidAt) {
        lockedTx.paidAt = verified.paidAt ?? new Date();
      }
      if (
        targetStatus === PAYMENT_TRANSACTION_STATUS.FAILED ||
        targetStatus === PAYMENT_TRANSACTION_STATUS.CANCELLED ||
        targetStatus === PAYMENT_TRANSACTION_STATUS.EXPIRED
      ) {
        lockedTx.failureCode = verified.failureCode ?? lockedTx.failureCode;
        lockedTx.failureMessage =
          sanitizePaymentErrorMessage(verified.failureMessage) ?? lockedTx.failureMessage;
      }

      const savedTx = await this.transactionRepo.saveEntity(lockedTx);
      const savedCallback = await this.persistCallbackRow({
        providerId: Number(provider.id),
        providerCode,
        tx: savedTx,
        httpMethod: input.httpMethod,
        verificationStatus: PAYMENT_CALLBACK_STATUS.VERIFIED,
        verified,
        headers: headersLower,
        payloadSha256,
        sourceIpMasked,
        rejectionReason: null,
        maxBytes: runtimeConfig.maxStoredPayloadBytes,
      });

      return { savedTx, savedCallback, beforeStatus };
    };

    const txResult = this.transactionManager
      ? await this.transactionManager.runInTransaction(runInTx)
      : await runInTx();

    await this.providerRepo.updateTelemetry(provider.id, { lastSuccessAt: new Date() });

    const txView = PaymentResponseMapper.toTransactionView(txResult.savedTx);
    await this.auditLogService?.record({
      actor: null,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.CALLBACKS,
      action: 'CALLBACK_VERIFIED',
      resourceType: 'payment_transaction',
      resourceId: String(txView.id),
      beforeData: { status: txResult.beforeStatus },
      afterData: {
        status: txView.status,
        statusName: txView.statusName,
        callbackUid: txResult.savedCallback.callbackUid,
      },
      reason: `Verified ${providerCode} payment callback (${txResult.savedCallback.callbackUid})`,
    });

    const eventName =
      txView.status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED
        ? PAYMENT_EVENTS.TRANSACTION_SUCCEEDED
        : txView.status === PAYMENT_TRANSACTION_STATUS.CANCELLED
          ? PAYMENT_EVENTS.TRANSACTION_CANCELLED
          : txView.status === PAYMENT_TRANSACTION_STATUS.FAILED
            ? PAYMENT_EVENTS.TRANSACTION_FAILED
            : null;
    if (eventName) {
      await this.publishEventSafe(eventName, {
        paymentId: txView.id,
        paymentCode: txView.paymentCode,
        providerCode: txView.providerCode,
        amount: txView.amount,
        currency: txView.currency,
        status: txView.statusName,
      });
    }

    return {
      accepted: true,
      duplicate: false,
      verificationStatus: PAYMENT_CALLBACK_STATUS.VERIFIED,
      verificationStatusName: getPaymentCallbackStatusName(PAYMENT_CALLBACK_STATUS.VERIFIED),
      callbackId: Number(txResult.savedCallback.id),
      callbackUid: txResult.savedCallback.callbackUid,
      transaction: txView,
      ackBody: verified.ackBody,
    };
  }

  public async simulateSandboxCallback(
    transactionId: number,
    input: SimulatePaymentCallbackInput,
    actor?: UserIdentity,
  ): Promise<ReceivePaymentCallbackResult> {
    const tx = await this.transactionRepo.findByIdSafe(transactionId);
    if (!tx) {
      throw new NotFoundAppException('payments.transactionNotFound', { id: transactionId });
    }
    if (tx.driverCode !== PAYMENT_DRIVER_CODE.SANDBOX) {
      throw new BadRequestAppException('payments.simulateOnlySandbox', [
        {
          driverCode: tx.driverCode,
        },
      ]);
    }

    const provider = await this.providersService.resolveProviderEntityByCode(tx.providerCode);
    const resolvedConfig = this.providersService.buildAdapterResolvedConfig(provider);
    const webhookSecret =
      resolvedConfig.secrets['webhookSecret'] ??
      resolvedConfig.secrets['secretKey'] ??
      'sandbox-default-webhook-secret';
    const targetStatus = input.status ?? PAYMENT_TRANSACTION_STATUS.SUCCEEDED;

    const payloadObj = {
      eventId: input.eventId?.trim() || `sbx_evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      paymentCode: tx.paymentCode,
      merchantOrderRef: tx.merchantOrderRef,
      providerTransactionId: tx.providerTransactionId,
      status: targetStatus,
      amount: input.amount ?? Number(tx.amount),
      currency: input.currency ?? tx.currency,
      paidAt:
        targetStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? new Date().toISOString() : null,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      simulatedBy: parseNumericUserId(actor?.id),
    };
    const rawBody = JSON.stringify(payloadObj);
    const signed = SandboxPaymentAdapter.signCallbackPayload({
      rawBody,
      webhookSecret: input.tamperSignature ? `${webhookSecret}-tampered` : webhookSecret,
    });

    return this.receiveCallback({
      providerCode: tx.providerCode,
      httpMethod: 'POST',
      rawBody,
      parsedBody: payloadObj,
      headers: {
        'content-type': 'application/json',
        'x-sandbox-signature': signed.header,
      },
      sourceIp: '127.0.0.1',
    });
  }

  public async listCallbacks(
    query: ListPaymentCallbacksQuery,
  ): Promise<PaginatedResult<PaymentCallbackView>> {
    const paged = await this.callbackRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((cb) => PaymentResponseMapper.toCallbackView(cb)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getCallbackById(id: number): Promise<PaymentCallbackView> {
    const cb = await this.callbackRepo.findByIdSafe(id);
    if (!cb) {
      throw new NotFoundAppException('payments.callbackNotFound', { id });
    }
    return PaymentResponseMapper.toCallbackView(cb);
  }

  private async findTargetTransaction(
    providerCode: string,
    verified: VerifiedPaymentCallback,
  ): Promise<PaymentTransactionEntity | null> {
    if (verified.paymentCode) {
      const byCode = await this.transactionRepo.findByPaymentCode(verified.paymentCode);
      if (byCode && byCode.providerCode === providerCode) return byCode;
    }
    if (verified.providerTransactionId) {
      const byProviderTx = await this.transactionRepo.findByProviderTransactionId(
        providerCode,
        verified.providerTransactionId,
      );
      if (byProviderTx) return byProviderTx;
    }
    if (verified.merchantOrderRef) {
      const byOrderRef = await this.transactionRepo.findLatestByMerchantOrderRef(
        providerCode,
        verified.merchantOrderRef,
      );
      if (byOrderRef) return byOrderRef;
    }
    return null;
  }

  private async recordRejectedCallback(params: {
    readonly providerId: number;
    readonly providerCode: string;
    readonly tx?: PaymentTransactionEntity | null | undefined;
    readonly httpMethod: string;
    readonly verificationStatus: PaymentCallbackStatusCode;
    readonly verified: VerifiedPaymentCallback;
    readonly headers: Record<string, string>;
    readonly payloadSha256: string;
    readonly sourceIpMasked: string | null;
    readonly rejectionReason: string;
    readonly recordRejected: boolean;
    readonly maxBytes: number;
  }): Promise<void> {
    if (params.recordRejected) {
      await this.persistCallbackRow({
        providerId: params.providerId,
        providerCode: params.providerCode,
        tx: params.tx,
        httpMethod: params.httpMethod,
        verificationStatus: params.verificationStatus,
        verified: params.verified,
        headers: params.headers,
        payloadSha256: params.payloadSha256,
        sourceIpMasked: params.sourceIpMasked,
        rejectionReason: params.rejectionReason,
        maxBytes: params.maxBytes,
      });
    }

    await this.auditLogService?.record({
      actor: null,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.CALLBACKS,
      action: 'CALLBACK_REJECTED',
      resourceType: 'payment_callback',
      resourceId: params.tx ? String(params.tx.id) : params.providerCode,
      beforeData: null,
      afterData: {
        providerCode: params.providerCode,
        verificationStatus: getPaymentCallbackStatusName(params.verificationStatus),
        rejectionReason: params.rejectionReason,
      },
      reason: params.rejectionReason,
    });

    await this.publishEventSafe(PAYMENT_EVENTS.CALLBACK_REJECTED, {
      providerCode: params.providerCode,
      paymentCode: params.verified.paymentCode,
      verificationStatus: getPaymentCallbackStatusName(params.verificationStatus),
      rejectionReason: params.rejectionReason,
    });
  }

  private async persistCallbackRow(params: {
    readonly providerId: number | null;
    readonly providerCode: string;
    readonly tx?: PaymentTransactionEntity | null | undefined;
    readonly httpMethod: string;
    readonly verificationStatus: PaymentCallbackStatusCode;
    readonly verified: VerifiedPaymentCallback;
    readonly headers: Record<string, string>;
    readonly payloadSha256: string;
    readonly sourceIpMasked: string | null;
    readonly rejectionReason: string | null;
    readonly maxBytes: number;
  }): Promise<PaymentCallbackEntity> {
    return this.callbackRepo.saveEntity({
      callbackUid: `pcb_${randomUUID().replace(/-/g, '')}`,
      providerId: params.providerId,
      providerCode: params.providerCode,
      paymentTransactionId: params.tx ? Number(params.tx.id) : null,
      paymentCode: params.tx?.paymentCode ?? params.verified.paymentCode ?? null,
      providerEventId: params.verified.providerEventId,
      providerTransactionId: params.verified.providerTransactionId,
      httpMethod: params.httpMethod.toUpperCase().slice(0, 10),
      verificationStatus: params.verificationStatus,
      signatureValid: params.verified.signatureValid,
      reportedStatus: params.verified.reportedStatus,
      reportedAmount: params.verified.reportedAmount,
      reportedCurrency: params.verified.reportedCurrency,
      payloadSha256: params.payloadSha256,
      headersRedactedJson: JSON.stringify(redactPaymentHeaders(params.headers)),
      payloadRedactedJson: serializeRedactedPaymentPayload(
        params.verified.normalizedPayload,
        params.maxBytes,
      ),
      rejectionReason: params.rejectionReason?.slice(0, 255) ?? null,
      sourceIpMasked: params.sourceIpMasked,
      processedAt: new Date(),
    });
  }

  private normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers) return out;
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined || v === null) continue;
      out[k.toLowerCase()] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
    }
    return out;
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
