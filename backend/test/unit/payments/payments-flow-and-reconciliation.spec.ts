import { describe, expect, it } from '@jest/globals';
import {
  BadRequestAppException,
  ConflictAppException,
  SequenceRegistryService,
  SettingRegistryService,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import { AuditLogService, FieldEncryptionService } from '@packages/security/index.js';
import type { TransactionManager } from '@packages/database/index.js';
import { MoMoPaymentAdapter } from '../../../src/modules/payments/adapters/momo-payment.adapter.js';
import { SandboxPaymentAdapter } from '../../../src/modules/payments/adapters/sandbox-payment.adapter.js';
import { StripePaymentAdapter } from '../../../src/modules/payments/adapters/stripe-payment.adapter.js';
import { VnPayPaymentAdapter } from '../../../src/modules/payments/adapters/vnpay-payment.adapter.js';
import { PaymentCallbackEntity } from '../../../src/modules/payments/entities/payment-callback.entity.js';
import { PaymentProviderEntity } from '../../../src/modules/payments/entities/payment-provider.entity.js';
import { PaymentReconciliationItemEntity } from '../../../src/modules/payments/entities/payment-reconciliation-item.entity.js';
import { PaymentReconciliationEntity } from '../../../src/modules/payments/entities/payment-reconciliation.entity.js';
import { PaymentRefundEntity } from '../../../src/modules/payments/entities/payment-refund.entity.js';
import { PaymentTransactionEntity } from '../../../src/modules/payments/entities/payment-transaction.entity.js';
import {
  PAYMENT_CALLBACK_STATUS,
  PAYMENT_DRIVER_CODE,
  PAYMENT_ENVIRONMENT,
  PAYMENT_PROVIDER_STATUS,
  PAYMENT_RECONCILIATION_DISCREPANCY,
  PAYMENT_RECONCILIATION_RESOLUTION,
  PAYMENT_RECONCILIATION_RESOLVE_ACTION,
  PAYMENT_RECONCILIATION_SOURCE,
  PAYMENT_REFUND_STATUS,
  PAYMENT_REFUND_TYPE,
  PAYMENT_SETTING_KEYS,
  PAYMENT_TRANSACTION_STATUS,
} from '../../../src/modules/payments/enum/payments.enum.js';
import type { PaymentCallbackRepository } from '../../../src/modules/payments/repositories/payment-callback.repository.js';
import type { PaymentProviderRepository } from '../../../src/modules/payments/repositories/payment-provider.repository.js';
import type { PaymentReconciliationItemRepository } from '../../../src/modules/payments/repositories/payment-reconciliation-item.repository.js';
import type { PaymentReconciliationRepository } from '../../../src/modules/payments/repositories/payment-reconciliation.repository.js';
import type { PaymentRefundRepository } from '../../../src/modules/payments/repositories/payment-refund.repository.js';
import type { PaymentTransactionRepository } from '../../../src/modules/payments/repositories/payment-transaction.repository.js';
import { PaymentAdapterRegistryService } from '../../../src/modules/payments/services/payment-adapter-registry.service.js';
import { PaymentCallbacksService } from '../../../src/modules/payments/services/payment-callbacks.service.js';
import { PaymentProvidersService } from '../../../src/modules/payments/services/payment-providers.service.js';
import { PaymentReconciliationService } from '../../../src/modules/payments/services/payment-reconciliation.service.js';
import { PaymentRefundsService } from '../../../src/modules/payments/services/payment-refunds.service.js';
import { PaymentTransactionsService } from '../../../src/modules/payments/services/payment-transactions.service.js';
import { PaymentsService } from '../../../src/modules/payments/services/payments.service.js';

function createPaymentHarness() {
  const settingRegistry = new SettingRegistryService();
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.DEFAULT_CURRENCY, 'VND');
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.DEFAULT_EXPIRY_SECONDS, 900);
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.CALLBACK_TOLERANCE_SEC, 300);
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.MAX_STORED_PAYLOAD_BYTES, 65536);
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.RECORD_REJECTED_CALLBACKS, true);
  settingRegistry.setGlobalValue(PAYMENT_SETTING_KEYS.RECONCILE_MAX_LIVE_QUERIES, 50);

  const sequenceRegistry = new SequenceRegistryService();
  const encryptionService = new FieldEncryptionService();
  const auditLogService = new AuditLogService();

  let providerSeq = 1;
  let txSeq = 1;
  let refundSeq = 1;
  let callbackSeq = 1;
  let reconSeq = 1;
  let reconItemSeq = 1;

  const providers = new Map<number, PaymentProviderEntity>();
  const transactions = new Map<number, PaymentTransactionEntity>();
  const refunds = new Map<number, PaymentRefundEntity>();
  const callbacks = new Map<number, PaymentCallbackEntity>();
  const reconciliations = new Map<number, PaymentReconciliationEntity>();
  const reconItems = new Map<number, PaymentReconciliationItemEntity>();

  const providerRepo = {
    findByIdSafe: async (id: number) => {
      const p = providers.get(Number(id));
      return p && !p.deletedAt ? p : null;
    },
    findByCode: async (code: string, withDeleted = false) => {
      const clean = code.trim().toLowerCase();
      return (
        [...providers.values()].find(
          (p) => (withDeleted || !p.deletedAt) && p.providerCode === clean,
        ) ?? null
      );
    },
    findDefaultActiveProvider: async () =>
      [...providers.values()].find(
        (p) =>
          !p.deletedAt && p.isDefault && p.isEnabled && p.status === PAYMENT_PROVIDER_STATUS.ACTIVE,
      ) ?? null,
    clearDefaultFlagExcept: async (excludeId: number) => {
      for (const p of providers.values()) {
        if (Number(p.id) !== Number(excludeId)) p.isDefault = false;
      }
    },
    listAll: async () => [...providers.values()].filter((p) => !p.deletedAt),
    updateTelemetry: async (
      id: number,
      payload: { lastSuccessAt?: Date; lastErrorAt?: Date; lastErrorCode?: string | null },
    ) => {
      const p = providers.get(Number(id));
      if (!p) return;
      if (payload.lastSuccessAt !== undefined) p.lastSuccessAt = payload.lastSuccessAt;
      if (payload.lastErrorAt !== undefined) p.lastErrorAt = payload.lastErrorAt;
      if (payload.lastErrorCode !== undefined) p.lastErrorCode = payload.lastErrorCode;
    },
    saveEntity: async (partial: Partial<PaymentProviderEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : providerSeq++;
      const existing = providers.get(id);
      const entity = Object.assign(new PaymentProviderEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: existing?.deletedAt ?? null,
      });
      providers.set(id, entity);
      return entity;
    },
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const p = providers.get(Number(criteria.id));
        if (p) p.deletedAt = new Date();
      },
    },
  } as unknown as PaymentProviderRepository;

  const transactionRepo = {
    findByIdSafe: async (id: number) => transactions.get(Number(id)) ?? null,
    findByIdForUpdate: async (id: number) => transactions.get(Number(id)) ?? null,
    findByIdempotencyKey: async (key: string) =>
      [...transactions.values()].find((t) => t.idempotencyKey === key.trim()) ?? null,
    findByPaymentCode: async (code: string) =>
      [...transactions.values()].find((t) => t.paymentCode === code.trim()) ?? null,
    findByProviderTransactionId: async (providerCode: string, providerTxId: string) =>
      [...transactions.values()].find(
        (t) =>
          t.providerCode === providerCode.trim().toLowerCase() &&
          t.providerTransactionId === providerTxId.trim(),
      ) ?? null,
    findLatestByMerchantOrderRef: async (providerCode: string, orderRef: string) =>
      [...transactions.values()]
        .filter(
          (t) =>
            t.providerCode === providerCode.trim().toLowerCase() &&
            t.merchantOrderRef === orderRef.trim(),
        )
        .sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null,
    listForReconciliationWindow: async (params: {
      providerCode: string;
      periodStart: Date;
      periodEnd: Date;
    }) =>
      [...transactions.values()].filter(
        (t) =>
          t.providerCode === params.providerCode.trim().toLowerCase() &&
          t.createdAt.getTime() >= params.periodStart.getTime() &&
          t.createdAt.getTime() <= params.periodEnd.getTime(),
      ),
    saveEntity: async (partial: Partial<PaymentTransactionEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : txSeq++;
      const existing = transactions.get(id);
      const entity = Object.assign(new PaymentTransactionEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      transactions.set(id, entity);
      return entity;
    },
  } as unknown as PaymentTransactionRepository;

  const refundRepo = {
    findByIdSafe: async (id: number) => refunds.get(Number(id)) ?? null,
    findByIdempotencyKey: async (key: string) =>
      [...refunds.values()].find((r) => r.idempotencyKey === key.trim()) ?? null,
    listByTransactionId: async (txId: number) =>
      [...refunds.values()].filter((r) => Number(r.paymentTransactionId) === Number(txId)),
    getPendingOrProcessingAmount: async (txId: number) =>
      [...refunds.values()]
        .filter(
          (r) =>
            Number(r.paymentTransactionId) === Number(txId) &&
            (r.status === PAYMENT_REFUND_STATUS.PENDING ||
              r.status === PAYMENT_REFUND_STATUS.PROCESSING),
        )
        .reduce((sum, r) => sum + Number(r.amount), 0),
    saveEntity: async (partial: Partial<PaymentRefundEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : refundSeq++;
      const existing = refunds.get(id);
      const entity = Object.assign(new PaymentRefundEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      refunds.set(id, entity);
      return entity;
    },
  } as unknown as PaymentRefundRepository;

  const callbackRepo = {
    findByIdSafe: async (id: number) => callbacks.get(Number(id)) ?? null,
    findVerifiedDuplicate: async (params: {
      providerCode: string;
      providerEventId?: string | null;
      payloadSha256: string;
    }) => {
      const list = [...callbacks.values()].filter(
        (c) =>
          c.providerCode === params.providerCode.trim().toLowerCase() &&
          c.verificationStatus === PAYMENT_CALLBACK_STATUS.VERIFIED,
      );
      if (params.providerEventId?.trim()) {
        const byEvent = list.find((c) => c.providerEventId === params.providerEventId!.trim());
        if (byEvent) return byEvent;
      }
      return list.find((c) => c.payloadSha256 === params.payloadSha256) ?? null;
    },
    listByTransactionId: async (txId: number) =>
      [...callbacks.values()].filter((c) => Number(c.paymentTransactionId) === Number(txId)),
    listPaginated: async () => ({
      data: [...callbacks.values()],
      meta: {
        page: 1,
        limit: 20,
        total: callbacks.size,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
    saveEntity: async (partial: Partial<PaymentCallbackEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : callbackSeq++;
      const existing = callbacks.get(id);
      const entity = Object.assign(new PaymentCallbackEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      callbacks.set(id, entity);
      return entity;
    },
  } as unknown as PaymentCallbackRepository;

  const reconRepo = {
    findByIdSafe: async (id: number) => reconciliations.get(Number(id)) ?? null,
    saveEntity: async (partial: Partial<PaymentReconciliationEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : reconSeq++;
      const existing = reconciliations.get(id);
      const entity = Object.assign(new PaymentReconciliationEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      reconciliations.set(id, entity);
      return entity;
    },
  } as unknown as PaymentReconciliationRepository;

  const reconItemRepo = {
    findByIdAndReconciliationId: async (itemId: number, reconId: number) => {
      const item = reconItems.get(Number(itemId));
      return item && Number(item.reconciliationId) === Number(reconId) ? item : null;
    },
    listByReconciliationId: async (reconId: number) =>
      [...reconItems.values()].filter((i) => Number(i.reconciliationId) === Number(reconId)),
    saveEntity: async (partial: Partial<PaymentReconciliationItemEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : reconItemSeq++;
      const existing = reconItems.get(id);
      const entity = Object.assign(new PaymentReconciliationItemEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      reconItems.set(id, entity);
      return entity;
    },
  } as unknown as PaymentReconciliationItemRepository;

  const transactionManager = {
    runInTransaction: async <T>(work: () => Promise<T>) => work(),
    isInTransaction: () => false,
  } as unknown as TransactionManager;

  const adapterRegistry = new PaymentAdapterRegistryService(
    new SandboxPaymentAdapter(),
    new VnPayPaymentAdapter(),
    new MoMoPaymentAdapter(),
    new StripePaymentAdapter(),
  );

  const providersService = new PaymentProvidersService(
    providerRepo,
    adapterRegistry,
    settingRegistry,
    encryptionService,
    auditLogService,
  );
  const transactionsService = new PaymentTransactionsService(
    transactionRepo,
    providerRepo,
    refundRepo,
    callbackRepo,
    providersService,
    adapterRegistry,
    settingRegistry,
    sequenceRegistry,
    auditLogService,
  );
  const callbacksService = new PaymentCallbacksService(
    callbackRepo,
    transactionRepo,
    providerRepo,
    providersService,
    adapterRegistry,
    settingRegistry,
    transactionManager,
    auditLogService,
  );
  const refundsService = new PaymentRefundsService(
    transactionRepo,
    refundRepo,
    providersService,
    adapterRegistry,
    settingRegistry,
    sequenceRegistry,
    transactionManager,
    auditLogService,
  );
  const reconciliationService = new PaymentReconciliationService(
    reconRepo,
    reconItemRepo,
    transactionRepo,
    providersService,
    adapterRegistry,
    settingRegistry,
    sequenceRegistry,
    transactionManager,
    auditLogService,
  );

  const service = new PaymentsService(
    adapterRegistry,
    providersService,
    transactionsService,
    callbacksService,
    refundsService,
    reconciliationService,
  );

  return {
    service,
    auditLogService,
    transactions,
    callbacks,
    refunds,
  };
}

describe('Payments Flow: Idempotency, Callbacks, Full/Partial Refunds & Reconciliation (Unit)', () => {
  it('enforces Idempotency Key on createPayment (replay same payload, 409 on differing payload)', async () => {
    const h = createPaymentHarness();
    await h.service.createProvider({
      providerCode: 'sandbox-main',
      driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
      displayName: 'Sandbox Main',
      isEnabled: true,
      isDefault: true,
      status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      environment: PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund: true,
      secrets: { webhookSecret: 'whsec_flow_test' },
    });

    const first = await h.service.createPayment({
      idempotencyKey: 'order-checkout-1001',
      merchantOrderRef: 'ORD-1001',
      amount: 500_000,
      currency: 'VND',
      description: 'Tuition fee',
    });
    expect(first.idempotentReplay).toBe(false);
    expect(first.transaction.amount).toBe(500_000);
    expect(first.transaction.status).toBe(PAYMENT_TRANSACTION_STATUS.PENDING);

    const replay = await h.service.createPayment({
      idempotencyKey: 'order-checkout-1001',
      merchantOrderRef: 'ORD-1001',
      amount: 500_000,
      currency: 'VND',
      description: 'Tuition fee',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transaction.id).toBe(first.transaction.id);
    expect(replay.transaction.paymentCode).toBe(first.transaction.paymentCode);
    expect(h.transactions.size).toBe(1);

    await expect(
      h.service.createPayment({
        idempotencyKey: 'order-checkout-1001',
        merchantOrderRef: 'ORD-1001',
        amount: 999_000,
        currency: 'VND',
        description: 'Tuition fee',
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('verifies callbacks (valid, duplicate replay, invalid signature, amount/currency mismatch, stale downgrade)', async () => {
    const h = createPaymentHarness();
    await h.service.createProvider({
      providerCode: 'sandbox-cb',
      driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
      displayName: 'Sandbox CB',
      isEnabled: true,
      isDefault: true,
      status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      environment: PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund: true,
      secrets: { webhookSecret: 'whsec_cb_secret' },
    });

    const created = await h.service.createPayment({
      idempotencyKey: 'cb-order-1',
      merchantOrderRef: 'ORD-CB-1',
      amount: 200_000,
      currency: 'VND',
    });

    // 1. Invalid signature -> 401 & stores redacted callback record
    await expect(
      h.service.simulateSandboxCallback(created.transaction.id, {
        status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
        tamperSignature: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);

    // 2. Tampered amount -> 400 & transaction stays PENDING
    await expect(
      h.service.simulateSandboxCallback(created.transaction.id, {
        status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
        amount: 1_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect((await h.service.getTransactionById(created.transaction.id)).status).toBe(
      PAYMENT_TRANSACTION_STATUS.PENDING,
    );

    // 3. Wrong currency -> 400
    await expect(
      h.service.simulateSandboxCallback(created.transaction.id, {
        status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    // 4. Valid callback -> transitions to SUCCEEDED
    const validCb = await h.service.simulateSandboxCallback(created.transaction.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      eventId: 'evt_cb_ok_1',
    });
    expect(validCb.accepted).toBe(true);
    expect(validCb.duplicate).toBe(false);
    expect(validCb.transaction?.status).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);

    // 5. Duplicate callback -> duplicate: true, state untouched
    const dupCb = await h.service.simulateSandboxCallback(created.transaction.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      eventId: 'evt_cb_ok_1',
    });
    expect(dupCb.duplicate).toBe(true);
    expect(dupCb.verificationStatus).toBe(PAYMENT_CALLBACK_STATUS.DUPLICATE);

    // 6. Stale FAILED callback after SUCCEEDED -> rejected & paid status preserved
    await expect(
      h.service.simulateSandboxCallback(created.transaction.id, {
        status: PAYMENT_TRANSACTION_STATUS.FAILED,
        eventId: 'evt_cb_stale_fail',
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect((await h.service.getTransactionById(created.transaction.id)).status).toBe(
      PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    );
    expect(h.callbacks.size).toBe(6);
  });

  it('supports partial & full refunds with idempotency, over-refund protection and capability guard', async () => {
    const h = createPaymentHarness();
    await h.service.createProvider({
      providerCode: 'sandbox-partial',
      driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
      displayName: 'Sandbox Partial',
      isEnabled: true,
      isDefault: true,
      status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      environment: PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund: true,
      secrets: { webhookSecret: 'whsec_ref_1' },
    });
    await h.service.createProvider({
      providerCode: 'sandbox-no-partial',
      driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
      displayName: 'Sandbox Full Only',
      isEnabled: true,
      isDefault: false,
      status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      environment: PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund: false,
      secrets: { webhookSecret: 'whsec_ref_2' },
    });

    const tx = (
      await h.service.createPayment({
        providerCode: 'sandbox-partial',
        idempotencyKey: 'ref-tx-1',
        merchantOrderRef: 'ORD-REF-1',
        amount: 300_000,
        currency: 'VND',
      })
    ).transaction;
    await h.service.simulateSandboxCallback(tx.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    });

    // Partial refund 100k
    const r1 = await h.service.refundPayment(tx.id, {
      idempotencyKey: 'ref-op-1',
      amount: 100_000,
      reason: 'Partial refund #1',
    });
    expect(r1.idempotentReplay).toBe(false);
    expect(r1.refund.refundType).toBe(PAYMENT_REFUND_TYPE.PARTIAL);
    expect(r1.transaction.status).toBe(PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED);
    expect(r1.transaction.refundedAmount).toBe(100_000);
    expect(r1.transaction.refundableAmount).toBe(200_000);

    // Idempotent replay of same refund key
    const r1Replay = await h.service.refundPayment(tx.id, {
      idempotencyKey: 'ref-op-1',
      amount: 100_000,
      reason: 'Partial refund #1',
    });
    expect(r1Replay.idempotentReplay).toBe(true);
    expect(h.refunds.size).toBe(1);

    // Conflicting payload on same refund key
    await expect(
      h.service.refundPayment(tx.id, {
        idempotencyKey: 'ref-op-1',
        amount: 150_000,
        reason: 'Partial refund #1',
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);

    // Over-refund guard
    await expect(
      h.service.refundPayment(tx.id, {
        idempotencyKey: 'ref-op-over',
        amount: 250_000,
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);

    // Remaining 200k completes refund -> REFUNDED
    const r2 = await h.service.refundPayment(tx.id, {
      idempotencyKey: 'ref-op-2',
      reason: 'Complete remaining refund',
    });
    expect(r2.refund.amount).toBe(200_000);
    expect(r2.transaction.status).toBe(PAYMENT_TRANSACTION_STATUS.REFUNDED);
    expect(r2.transaction.refundableAmount).toBe(0);

    // Provider with supportsPartialRefund=false rejects partial refund, allows full refund
    const fullOnlyTx = (
      await h.service.createPayment({
        providerCode: 'sandbox-no-partial',
        idempotencyKey: 'ref-tx-full-only',
        merchantOrderRef: 'ORD-FULL-ONLY',
        amount: 100_000,
        currency: 'VND',
      })
    ).transaction;
    await h.service.simulateSandboxCallback(fullOnlyTx.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    });
    await expect(
      h.service.refundPayment(fullOnlyTx.id, {
        idempotencyKey: 'ref-full-only-partial',
        amount: 40_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    const fullRes = await h.service.refundPayment(fullOnlyTx.id, {
      idempotencyKey: 'ref-full-only-ok',
    });
    expect(fullRes.refund.refundType).toBe(PAYMENT_REFUND_TYPE.FULL);
    expect(fullRes.transaction.status).toBe(PAYMENT_TRANSACTION_STATUS.REFUNDED);
  });

  it('runs 2-way reconciliation (STATEMENT & LIVE_QUERY), detects all discrepancies and safely resolves items', async () => {
    const h = createPaymentHarness();
    await h.service.createProvider({
      providerCode: 'sandbox-rec',
      driverCode: PAYMENT_DRIVER_CODE.SANDBOX,
      displayName: 'Sandbox Recon',
      isEnabled: true,
      isDefault: true,
      status: PAYMENT_PROVIDER_STATUS.ACTIVE,
      environment: PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund: true,
      secrets: { webhookSecret: 'whsec_rec' },
    });

    const txMatched = (
      await h.service.createPayment({
        idempotencyKey: 'rec-1',
        merchantOrderRef: 'ORD-REC-1',
        amount: 100_000,
        currency: 'VND',
      })
    ).transaction;
    await h.service.simulateSandboxCallback(txMatched.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    });

    const txStatusDrift = (
      await h.service.createPayment({
        idempotencyKey: 'rec-2',
        merchantOrderRef: 'ORD-REC-2',
        amount: 200_000,
        currency: 'VND',
      })
    ).transaction; // Stays PENDING internally, SUCCEEDED at provider

    const txAmountDrift = (
      await h.service.createPayment({
        idempotencyKey: 'rec-3',
        merchantOrderRef: 'ORD-REC-3',
        amount: 300_000,
        currency: 'VND',
      })
    ).transaction;
    await h.service.simulateSandboxCallback(txAmountDrift.id, {
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    });

    const txMissingAtProvider = (
      await h.service.createPayment({
        idempotencyKey: 'rec-4',
        merchantOrderRef: 'ORD-REC-4',
        amount: 400_000,
        currency: 'VND',
      })
    ).transaction;

    const recon = await h.service.runReconciliation({
      providerCode: 'sandbox-rec',
      sourceMode: PAYMENT_RECONCILIATION_SOURCE.STATEMENT,
      periodStart: new Date(Date.now() - 3600_000),
      periodEnd: new Date(Date.now() + 3600_000),
      statementItems: [
        {
          paymentCode: txMatched.paymentCode,
          merchantOrderRef: 'ORD-REC-1',
          providerTransactionId: txMatched.providerTransactionId ?? undefined,
          status: 'SUCCEEDED',
          amount: 100_000,
          refundedAmount: 0,
          currency: 'VND',
        },
        {
          paymentCode: txStatusDrift.paymentCode,
          merchantOrderRef: 'ORD-REC-2',
          providerTransactionId: txStatusDrift.providerTransactionId ?? undefined,
          status: 'SUCCEEDED',
          amount: 200_000,
          refundedAmount: 0,
          currency: 'VND',
        },
        {
          paymentCode: txAmountDrift.paymentCode,
          merchantOrderRef: 'ORD-REC-3',
          providerTransactionId: txAmountDrift.providerTransactionId ?? undefined,
          status: 'SUCCEEDED',
          amount: 290_000,
          refundedAmount: 0,
          currency: 'VND',
        },
        {
          paymentCode: 'PAY-GHOST-999',
          merchantOrderRef: 'ORD-GHOST-999',
          providerTransactionId: 'sbx_tx_ghost',
          status: 'SUCCEEDED',
          amount: 150_000,
          refundedAmount: 0,
          currency: 'VND',
        },
      ],
    });

    expect(recon.matchedCount).toBe(1);
    expect(recon.mismatchCount).toBe(2);
    expect(recon.missingAtProviderCount).toBe(1);
    expect(recon.missingInternallyCount).toBe(1);
    // Internal succeeded total: 100k + 300k = 400k; Provider succeeded total: 100k + 200k + 290k + 150k = 740k
    expect(recon.internalTotalAmount).toBe(400_000);
    expect(recon.providerTotalAmount).toBe(740_000);
    expect(recon.amountDifference).toBe(-340_000);

    const statusDriftItem = recon.items!.find((i) => i.paymentCode === txStatusDrift.paymentCode)!;
    const amountDriftItem = recon.items!.find((i) => i.paymentCode === txAmountDrift.paymentCode)!;
    const missingProviderItem = recon.items!.find(
      (i) => i.paymentCode === txMissingAtProvider.paymentCode,
    )!;
    expect(statusDriftItem.discrepancyStatus).toBe(
      PAYMENT_RECONCILIATION_DISCREPANCY.STATUS_MISMATCH,
    );
    expect(amountDriftItem.discrepancyStatus).toBe(
      PAYMENT_RECONCILIATION_DISCREPANCY.AMOUNT_MISMATCH,
    );
    expect(missingProviderItem.discrepancyStatus).toBe(
      PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_AT_PROVIDER,
    );

    // Unsafe sync on AMOUNT_MISMATCH must fail
    await expect(
      h.service.resolveReconciliationItem(recon.id, amountDriftItem.id, {
        action: PAYMENT_RECONCILIATION_RESOLVE_ACTION.SYNC_FROM_PROVIDER,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    // Safe sync on STATUS_MISMATCH updates internal tx to SUCCEEDED
    const synced = await h.service.resolveReconciliationItem(recon.id, statusDriftItem.id, {
      action: PAYMENT_RECONCILIATION_RESOLVE_ACTION.SYNC_FROM_PROVIDER,
      note: 'Synced after missed IPN',
    });
    expect(synced.resolutionStatus).toBe(PAYMENT_RECONCILIATION_RESOLUTION.RESOLVED);
    expect((await h.service.getTransactionById(txStatusDrift.id)).status).toBe(
      PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
    );

    // CSV statement + LIVE_QUERY also work
    const liveRecon = await h.service.runReconciliation({
      providerCode: 'sandbox-rec',
      sourceMode: PAYMENT_RECONCILIATION_SOURCE.LIVE_QUERY,
      periodStart: new Date(Date.now() - 3600_000),
      periodEnd: new Date(Date.now() + 3600_000),
    });
    expect(liveRecon.totalProviderCount).toBeGreaterThan(0);

    const csvRecon = await h.service.runReconciliation({
      providerCode: 'sandbox-rec',
      sourceMode: PAYMENT_RECONCILIATION_SOURCE.STATEMENT,
      periodStart: new Date(Date.now() - 3600_000),
      periodEnd: new Date(Date.now() + 3600_000),
      statementCsv: `paymentCode,merchantOrderRef,status,amount,currency\n${txMatched.paymentCode},ORD-REC-1,SUCCEEDED,100000,VND\n`,
    });
    expect(csvRecon.matchedCount).toBe(1);

    const auditLogs = await h.auditLogService.listPaginated({ module: 'payments' });
    expect(auditLogs.data.length).toBeGreaterThan(0);
  });
});
