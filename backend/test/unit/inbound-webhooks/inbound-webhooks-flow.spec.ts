import { describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  SettingRegistryService,
  UnauthorizedAppException,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, JobError, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, FieldEncryptionService } from '@packages/security/index.js';
import {
  INBOUND_WEBHOOKS_QUEUE_TOPICS,
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_EVENT_STATUS,
  INBOUND_WEBHOOK_PROVIDER_STATUS,
  INBOUND_WEBHOOK_REJECTION_REASON,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
} from '../../../src/modules/inbound-webhooks/enum/inbound-webhooks.enum.js';
import { InboundWebhookAttemptEntity } from '../../../src/modules/inbound-webhooks/entities/inbound-webhook-attempt.entity.js';
import { InboundWebhookEventEntity } from '../../../src/modules/inbound-webhooks/entities/inbound-webhook-event.entity.js';
import { InboundWebhookProviderEntity } from '../../../src/modules/inbound-webhooks/entities/inbound-webhook-provider.entity.js';
import { computeInboundHmacSignature } from '../../../src/modules/inbound-webhooks/helpers/inbound-webhook-signature.helper.js';
import type { InboundWebhookAttemptRepository } from '../../../src/modules/inbound-webhooks/repositories/inbound-webhook-attempt.repository.js';
import type { InboundWebhookEventRepository } from '../../../src/modules/inbound-webhooks/repositories/inbound-webhook-event.repository.js';
import type { InboundWebhookProviderRepository } from '../../../src/modules/inbound-webhooks/repositories/inbound-webhook-provider.repository.js';
import { InboundWebhookHandlerRegistry } from '../../../src/modules/inbound-webhooks/services/inbound-webhook-handler.registry.js';
import { InboundWebhooksProcessingService } from '../../../src/modules/inbound-webhooks/services/inbound-webhooks-processing.service.js';
import { InboundWebhooksProvidersService } from '../../../src/modules/inbound-webhooks/services/inbound-webhooks-providers.service.js';
import { InboundWebhooksReceiveService } from '../../../src/modules/inbound-webhooks/services/inbound-webhooks-receive.service.js';

function createInMemoryRepos() {
  let providerSeq = 1;
  let eventSeq = 1;
  let attemptSeq = 1;

  const providers = new Map<number, InboundWebhookProviderEntity>();
  const events = new Map<number, InboundWebhookEventEntity>();
  const attempts = new Map<number, InboundWebhookAttemptEntity>();

  const providerRepo = {
    findByIdSafe: async (id: number) => {
      const p = providers.get(Number(id));
      return p && !p.deletedAt ? p : null;
    },
    findByCode: async (code: string) => {
      const clean = code.trim().toLowerCase();
      return [...providers.values()].find((p) => !p.deletedAt && p.providerCode === clean) ?? null;
    },
    findByIds: async (ids: readonly number[]) => {
      const out: InboundWebhookProviderEntity[] = [];
      for (const id of new Set(ids.map(Number))) {
        const p = providers.get(id);
        if (p && !p.deletedAt) out.push(p);
      }
      return out;
    },
    saveEntity: async (partial: Partial<InboundWebhookProviderEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : providerSeq++;
      const existing = providers.get(id);
      const entity = Object.assign(new InboundWebhookProviderEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: existing?.deletedAt ?? null,
      });
      providers.set(id, entity);
      return entity;
    },
    listPaginated: async () => ({
      data: [...providers.values()].filter((p) => !p.deletedAt),
      meta: {
        page: 1,
        limit: 20,
        total: providers.size,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const p = providers.get(Number(criteria.id));
        if (p) p.deletedAt = new Date();
      },
    },
  } as unknown as InboundWebhookProviderRepository;

  const eventRepo = {
    findByIdSafe: async (id: number) => events.get(Number(id)) ?? null,
    findByProviderAndExternalEventId: async (providerCode: string, externalEventId: string) => {
      const pCode = providerCode.trim().toLowerCase();
      const extId = externalEventId.trim();
      return (
        [...events.values()].find(
          (ev) => !ev.deletedAt && ev.providerCode === pCode && ev.externalEventId === extId,
        ) ?? null
      );
    },
    saveEntity: async (partial: Partial<InboundWebhookEventEntity>) => {
      if (!partial.id && partial.externalEventId) {
        const dup = [...events.values()].find(
          (ev) =>
            !ev.deletedAt &&
            ev.providerCode === partial.providerCode &&
            ev.externalEventId === partial.externalEventId,
        );
        if (dup) {
          const dupErr = new Error('duplicate key value violates unique constraint');
          (dupErr as Error & { code?: string }).code = '23505';
          throw dupErr;
        }
      }
      const now = new Date();
      const id = partial.id ? Number(partial.id) : eventSeq++;
      const existing = events.get(id);
      const entity = Object.assign(new InboundWebhookEventEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      events.set(id, entity);
      return entity;
    },
    listPaginated: async () => ({
      data: [...events.values()],
      meta: {
        page: 1,
        limit: 20,
        total: events.size,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
  } as unknown as InboundWebhookEventRepository;

  const attemptRepo = {
    findByEventId: async (eventId: number) =>
      [...attempts.values()]
        .filter((a) => Number(a.eventId) === Number(eventId))
        .sort((a, b) => Number(a.id) - Number(b.id)),
    saveEntity: async (partial: Partial<InboundWebhookAttemptEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : attemptSeq++;
      const entity = Object.assign(new InboundWebhookAttemptEntity(), partial, {
        id,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      attempts.set(id, entity);
      return entity;
    },
  } as unknown as InboundWebhookAttemptRepository;

  return {
    providerRepo,
    eventRepo,
    attemptRepo,
    stores: { providers, events, attempts },
  };
}

function createHarness() {
  const { providerRepo, eventRepo, attemptRepo, stores } = createInMemoryRepos();
  const settings = new SettingRegistryService();
  const encryption = new FieldEncryptionService();
  const auditLog = new AuditLogService();
  const handlerRegistry = new InboundWebhookHandlerRegistry();
  const publishedJobs: Array<{
    topic: string;
    payload: unknown;
    queue: string;
    options: Record<string, unknown>;
  }> = [];

  const messagePublisher = {
    publish: jest.fn(
      async (topic: string, payload: unknown, queue: string, options: Record<string, unknown>) => {
        publishedJobs.push({ topic, payload, queue, options });
        return {
          id: `msg_${publishedJobs.length}`,
          topic,
          payload,
          timestamp: new Date().toISOString(),
        };
      },
    ),
  } as unknown as BaseMessagePublisherProvider;

  const providersService = new InboundWebhooksProvidersService(
    providerRepo,
    settings,
    encryption,
    auditLog,
  );
  const receiveService = new InboundWebhooksReceiveService(
    providersService,
    providerRepo,
    eventRepo,
    messagePublisher,
    settings,
    auditLog,
  );
  const processingService = new InboundWebhooksProcessingService(
    providerRepo,
    eventRepo,
    attemptRepo,
    handlerRegistry,
    messagePublisher,
    settings,
    auditLog,
  );

  return {
    providersService,
    receiveService,
    processingService,
    handlerRegistry,
    auditLog,
    publishedJobs,
    stores,
  };
}

describe('Phase 10.3 — Inbound Webhooks Receive, Idempotency & Worker Processing', () => {
  it('verifies signature + timestamp + idempotency, redacts sensitive fields, enqueues job, and deduplicates repeat events', async () => {
    const h = createHarness();
    const created = await h.providersService.createProvider({
      providerCode: 'stripe',
      name: 'Stripe Payment Gateway',
      status: INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
      authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      signatureHeader: 'x-stripe-signature',
      signaturePrefix: 'v1=',
      signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampHeader: 'x-stripe-timestamp',
      requireTimestamp: true,
      toleranceSec: 300,
      eventIdHeader: 'x-webhook-id',
      eventIdPayloadPath: 'id',
      eventTypeHeader: 'x-webhook-event',
      eventTypePayloadPath: 'type',
      sensitiveFields: ['cardFingerprint'],
      maxRetries: 3,
    });

    const nowSec = 1_760_000_000;
    const payloadObj = {
      id: 'evt_stripe_100',
      type: 'invoice.paid',
      apiKey: 'sk_test_secret_abc',
      customerEmail: 'buyer@example.com',
      cardFingerprint: 'fp_999',
      amount: 500000,
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = computeInboundHmacSignature({
      rawBody,
      secret: created.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: nowSec,
      prefix: 'v1=',
    });

    const first = await h.receiveService.receiveWebhook(
      {
        providerCode: 'stripe',
        rawBody,
        parsedBody: payloadObj,
        headers: {
          'x-stripe-signature': sig,
          'x-stripe-timestamp': String(nowSec),
          authorization: 'Bearer internal-header-secret',
        },
        sourceIp: '203.0.113.45',
      },
      { nowSec },
    );

    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.statusName).toBe('QUEUED');
    expect(first.externalEventId).toBe('evt_stripe_100');
    expect(h.publishedJobs).toHaveLength(1);
    expect(h.publishedJobs[0]!.topic).toBe(INBOUND_WEBHOOKS_QUEUE_TOPICS.EVENT_PROCESS);
    expect(h.publishedJobs[0]!.queue).toBe(QUEUES.SYSTEM_EVENTS);
    expect(h.publishedJobs[0]!.options['idempotencyKey']).toBe(
      'inbound-webhook:stripe:evt_stripe_100',
    );

    const storedEvent = h.stores.events.get(first.eventId)!;
    const storedHeaders = JSON.parse(storedEvent.headersRedactedJson!) as Record<string, string>;
    const storedPayload = JSON.parse(storedEvent.payloadRedactedJson!) as typeof payloadObj;
    expect(storedHeaders['x-stripe-signature']).toBe('••••••••');
    expect(storedHeaders['authorization']).toBe('••••••••');
    expect(storedPayload.apiKey).toBe('[REDACTED]');
    expect(storedPayload.cardFingerprint).toBe('[REDACTED]');
    expect(storedPayload.customerEmail).toBe('buyer@example.com');
    expect(storedEvent.sourceIpMasked).toBe('203.0.113.x');

    // Duplicate delivery with identical payload -> idempotent hit, no second queue job
    const nextTs = nowSec + 10;
    const nextSig = computeInboundHmacSignature({
      rawBody,
      secret: created.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: nextTs,
      prefix: 'v1=',
    });
    const second = await h.receiveService.receiveWebhook(
      {
        providerCode: 'stripe',
        rawBody,
        parsedBody: payloadObj,
        headers: {
          'x-stripe-signature': nextSig,
          'x-stripe-timestamp': String(nextTs),
        },
        sourceIp: '203.0.113.45',
      },
      { nowSec: nextTs },
    );

    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(h.stores.events.get(first.eventId)!.duplicateCount).toBe(1);
    expect(h.publishedJobs).toHaveLength(1);

    // Same eventId but tampered/mismatched payload (even validly signed) -> 409 Conflict
    const diffObj = { ...payloadObj, amount: 999999 };
    const diffRaw = JSON.stringify(diffObj);
    const diffSig = computeInboundHmacSignature({
      rawBody: diffRaw,
      secret: created.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: nowSec + 20,
      prefix: 'v1=',
    });
    await expect(
      h.receiveService.receiveWebhook(
        {
          providerCode: 'stripe',
          rawBody: diffRaw,
          parsedBody: diffObj,
          headers: {
            'x-stripe-signature': diffSig,
            'x-stripe-timestamp': String(nowSec + 20),
          },
        },
        { nowSec: nowSec + 20 },
      ),
    ).rejects.toThrow(ConflictAppException);
  });

  it('rejects bad signature, expired timestamp, missing event ID, and paused provider without poisoning idempotency', async () => {
    const h = createHarness();
    const created = await h.providersService.createProvider({
      providerCode: 'github',
      name: 'GitHub',
      status: INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
      authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampHeader: 'x-webhook-timestamp',
      requireTimestamp: true,
      toleranceSec: 120,
      eventIdHeader: 'x-github-delivery',
      eventIdPayloadPath: null,
      eventTypeHeader: 'x-github-event',
      eventTypePayloadPath: null,
      sensitiveFields: [],
      maxRetries: 2,
    });

    const nowSec = 1_760_000_000;
    const rawBody = '{"action":"opened"}';

    // 1. Invalid signature (attacker trying to claim future externalEventId "deliv-1")
    await expect(
      h.receiveService.receiveWebhook(
        {
          providerCode: 'github',
          rawBody,
          parsedBody: { action: 'opened' },
          headers: {
            'x-hub-signature-256': 'sha256=deadbeef',
            'x-webhook-timestamp': String(nowSec),
            'x-github-delivery': 'deliv-1',
          },
        },
        { nowSec },
      ),
    ).rejects.toThrow(UnauthorizedAppException);

    // 2. Expired timestamp (valid sig for old timestamp)
    const oldTs = nowSec - 600;
    const oldSig = computeInboundHmacSignature({
      rawBody,
      secret: created.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: oldTs,
      prefix: 'sha256=',
    });
    await expect(
      h.receiveService.receiveWebhook(
        {
          providerCode: 'github',
          rawBody,
          parsedBody: { action: 'opened' },
          headers: {
            'x-hub-signature-256': oldSig,
            'x-webhook-timestamp': String(oldTs),
            'x-github-delivery': 'deliv-1',
          },
        },
        { nowSec },
      ),
    ).rejects.toThrow(UnauthorizedAppException);

    // 3. Missing external event ID
    const validSig = computeInboundHmacSignature({
      rawBody,
      secret: created.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: nowSec,
      prefix: 'sha256=',
    });
    await expect(
      h.receiveService.receiveWebhook(
        {
          providerCode: 'github',
          rawBody,
          parsedBody: { action: 'opened' },
          headers: {
            'x-hub-signature-256': validSig,
            'x-webhook-timestamp': String(nowSec),
          },
        },
        { nowSec },
      ),
    ).rejects.toThrow(BadRequestAppException);

    // Verify REJECTED rows stored with externalEventId=null so legitimate "deliv-1" still succeeds!
    const rejectedRows = [...h.stores.events.values()];
    expect(rejectedRows).toHaveLength(3);
    expect(rejectedRows.every((r) => r.status === INBOUND_WEBHOOK_EVENT_STATUS.REJECTED)).toBe(
      true,
    );
    expect(rejectedRows.every((r) => r.externalEventId === null)).toBe(true);
    expect(rejectedRows.map((r) => r.rejectionReason)).toEqual([
      INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
      INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED,
      INBOUND_WEBHOOK_REJECTION_REASON.MISSING_EVENT_ID,
    ]);
    expect(h.publishedJobs).toHaveLength(0);

    const legit = await h.receiveService.receiveWebhook(
      {
        providerCode: 'github',
        rawBody,
        parsedBody: { action: 'opened' },
        headers: {
          'x-hub-signature-256': validSig,
          'x-webhook-timestamp': String(nowSec),
          'x-github-delivery': 'deliv-1',
          'x-github-event': 'pull_request',
        },
      },
      { nowSec },
    );
    expect(legit.accepted).toBe(true);
    expect(legit.duplicate).toBe(false);
    expect(h.publishedJobs).toHaveLength(1);

    // 4. Paused provider blocks incoming requests
    await h.providersService.updateProvider(created.id, {
      status: INBOUND_WEBHOOK_PROVIDER_STATUS.PAUSED,
    });
    await expect(
      h.receiveService.receiveWebhook(
        {
          providerCode: 'github',
          rawBody,
          parsedBody: { action: 'opened' },
          headers: {
            'x-hub-signature-256': validSig,
            'x-webhook-timestamp': String(nowSec),
            'x-github-delivery': 'deliv-2',
          },
        },
        { nowSec },
      ),
    ).rejects.toThrow(ForbiddenAppException);
  });

  it('processes queued events via registered handler, handles retries/failures, and supports manual reprocess with audit', async () => {
    const h = createHarness();
    const provider = await h.providersService.createProvider({
      providerCode: 'sepay',
      name: 'SePay Bank Webhook',
      status: INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
      authType: INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN,
      signatureHeader: 'authorization',
      signaturePrefix: 'Apikey ',
      signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
      requireTimestamp: false,
      eventIdHeader: 'x-webhook-id',
      eventIdPayloadPath: 'id',
      eventTypeHeader: 'x-webhook-event',
      eventTypePayloadPath: 'transferType',
      sensitiveFields: [],
      maxRetries: 1,
    });

    let failMode: 'transient' | 'none' = 'transient';
    const handledPayloads: unknown[] = [];

    h.handlerRegistry.registerHandler({
      name: 'payments.sepay.transfer',
      providerCode: 'sepay',
      eventType: 'in',
      handle: async (ctx) => {
        if (failMode === 'transient') {
          throw new Error('Temporary DB timeout');
        }
        handledPayloads.push(ctx.payload);
        return { summary: { matchedInvoice: 'INV-001' } };
      },
    });

    const sim = await h.receiveService.simulateProviderWebhook(
      provider.id,
      {
        externalEventId: 'sepay_tx_9001',
        eventType: 'in',
        payload: { transferType: 'in', transferAmount: 150000, referenceCode: 'INV-001' },
      },
      { id: 1, email: 'admin@core.dev', username: 'admin' } as never,
    );

    const eventId = sim.receiveResult.eventId;

    // Attempt 1 -> transient error -> returns retryable JobError, status stays QUEUED
    await expect(
      h.processingService.processQueuedEvent(
        { inboundEventId: eventId },
        { attemptNumber: 1, maxAttempts: 2 },
      ),
    ).rejects.toThrow(JobError);
    expect(h.stores.events.get(eventId)!.status).toBe(INBOUND_WEBHOOK_EVENT_STATUS.QUEUED);

    // Attempt 2 -> still failing -> exhausts retries -> marks FAILED
    await expect(
      h.processingService.processQueuedEvent(
        { inboundEventId: eventId },
        { attemptNumber: 2, maxAttempts: 2 },
      ),
    ).rejects.toThrow(JobError);
    expect(h.stores.events.get(eventId)!.status).toBe(INBOUND_WEBHOOK_EVENT_STATUS.FAILED);

    // Reprocess manual by admin -> resets to QUEUED & enqueues
    failMode = 'none';
    const reprocessed = await h.processingService.reprocessEvent(
      eventId,
      { reason: 'DB recovered' },
      { id: 1, email: 'admin@core.dev', username: 'admin' } as never,
    );
    expect(reprocessed.statusName).toBe('QUEUED');
    expect(h.publishedJobs).toHaveLength(2);

    // Worker executes reprocessed job -> PROCESSED
    const finalRes = await h.processingService.processQueuedEvent(
      { inboundEventId: eventId },
      { attemptNumber: 1, maxAttempts: 2 },
    );
    expect(finalRes.status).toBe('PROCESSED');
    expect(finalRes.handlerName).toBe('payments.sepay.transfer');
    expect(handledPayloads).toHaveLength(1);

    // Terminal event is skipped idempotently if delivered again by queue
    const skippedRes = await h.processingService.processQueuedEvent({ inboundEventId: eventId });
    expect(skippedRes.skipped).toBe(true);
    expect(skippedRes.reason).toBe('already_terminal');

    // Detail includes attempt history (2 failures + 1 success)
    const detail = await h.processingService.getEventById(eventId);
    expect(detail.attempts).toHaveLength(3);
    expect(detail.attempts![2]!.isSuccess).toBe(true);
    expect(detail.attempts![2]!.resultSummary).toEqual({ matchedInvoice: 'INV-001' });

    // Audit log recorded CREATE, SIMULATE, REPROCESS
    const logs = await h.auditLog.listPaginated({ module: 'inbound-webhooks' });
    expect(logs.data.map((l) => l.action)).toEqual(
      expect.arrayContaining(['CREATE', 'SIMULATE', 'REPROCESS']),
    );

    // Reject reprocessing already-PROCESSED event
    await expect(
      h.processingService.reprocessEvent(eventId, { reason: 'Should fail' }),
    ).rejects.toThrow(BadRequestAppException);
  });

  it('marks permanent handler failure as FAILED immediately and handles concurrent 23505 idempotency race', async () => {
    const h = createHarness();
    const provider = await h.providersService.createProvider({
      providerCode: 'custom-crm',
      name: 'Custom CRM',
      status: INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
      authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      signatureHeader: 'x-webhook-signature',
      signaturePrefix: 'v1=',
      signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampHeader: 'x-webhook-timestamp',
      requireTimestamp: true,
      toleranceSec: 300,
      eventIdHeader: 'x-webhook-id',
      eventIdPayloadPath: 'id',
      eventTypeHeader: 'x-webhook-event',
      eventTypePayloadPath: 'type',
      sensitiveFields: [],
      maxRetries: 5,
    });

    h.handlerRegistry.registerHandler({
      name: 'crm.permanent.error',
      providerCode: 'custom-crm',
      eventType: '*',
      handle: async () => {
        throw new BadRequestAppException('Invalid CRM payload semantics');
      },
    });

    const sim = await h.receiveService.simulateProviderWebhook(provider.id, {
      externalEventId: 'crm_evt_1',
      eventType: 'lead.created',
      payload: { leadId: 'L1' },
    });

    await expect(
      h.processingService.processQueuedEvent(
        { inboundEventId: sim.receiveResult.eventId },
        { attemptNumber: 1, maxAttempts: 6 },
      ),
    ).rejects.toThrow(JobError);

    expect(h.stores.events.get(sim.receiveResult.eventId)!.status).toBe(
      INBOUND_WEBHOOK_EVENT_STATUS.FAILED,
    );

    // Simulate race condition: first find returns null, then concurrent insert hits 23505
    const { eventRepo } = (() => {
      const originalFind = (
        h.receiveService as unknown as {
          eventRepo: InboundWebhookEventRepository;
        }
      ).eventRepo;
      return { eventRepo: originalFind };
    })();

    const realFind = eventRepo.findByProviderAndExternalEventId.bind(eventRepo);
    let callCount = 0;
    eventRepo.findByProviderAndExternalEventId = async (pCode: string, extId: string) => {
      callCount += 1;
      if (callCount === 1) return null;
      return realFind(pCode, extId);
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const storedEvent = h.stores.events.get(sim.receiveResult.eventId)!;
    // Recreate exact raw body from simulate: { leadId: 'L1', id: 'crm_evt_1', type: 'lead.created', simulated: true }
    const raceBodyObj = {
      leadId: 'L1',
      id: 'crm_evt_1',
      type: 'lead.created',
      simulated: true,
    };
    const raceRaw = JSON.stringify(raceBodyObj);
    const raceSig = computeInboundHmacSignature({
      rawBody: raceRaw,
      secret: provider.signingSecret,
      algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
      format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
      timestampSec: nowSec,
      prefix: 'v1=',
    });

    const racedRes = await h.receiveService.receiveWebhook(
      {
        providerCode: 'custom-crm',
        rawBody: raceRaw,
        parsedBody: raceBodyObj,
        headers: {
          'x-webhook-signature': raceSig,
          'x-webhook-timestamp': String(nowSec),
        },
      },
      { nowSec },
    );

    expect(racedRes.duplicate).toBe(true);
    expect(racedRes.eventId).toBe(storedEvent.id);
    expect(callCount).toBe(2);
  });
});
