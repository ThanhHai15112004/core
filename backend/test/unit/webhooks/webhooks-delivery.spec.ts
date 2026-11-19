import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  BaseHttpClientProvider,
  CircuitBreakerRegistry,
  HttpClientMetricsService,
  HttpServiceRegistry,
} from '@packages/http-client/index.js';
import { BadRequestAppException } from '@packages/kernel/index.js';
import { JobError, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, FieldEncryptionService } from '@packages/security/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import {
  WEBHOOKS_QUEUE_TOPICS,
  WEBHOOK_ENDPOINT_STATUS,
  WEBHOOK_HEADERS,
  WEBHOOK_TRIGGER_SOURCE,
} from '../../../src/modules/webhooks/enum/webhooks.enum.js';
import { WebhookDeliveryAttemptEntity } from '../../../src/modules/webhooks/entities/webhook-delivery-attempt.entity.js';
import { WebhookDeliveryEntity } from '../../../src/modules/webhooks/entities/webhook-delivery.entity.js';
import { WebhookEndpointEntity } from '../../../src/modules/webhooks/entities/webhook-endpoint.entity.js';
import { verifyWebhookSignature } from '../../../src/modules/webhooks/helpers/webhook-signature.helper.js';
import type { WebhookDnsLookupFn } from '../../../src/modules/webhooks/helpers/webhook-ssrf.helper.js';
import type { WebhookDeliveryAttemptRepository } from '../../../src/modules/webhooks/repositories/webhook-delivery-attempt.repository.js';
import type { WebhookDeliveryRepository } from '../../../src/modules/webhooks/repositories/webhook-delivery.repository.js';
import type { WebhookEndpointRepository } from '../../../src/modules/webhooks/repositories/webhook-endpoint.repository.js';
import { WebhooksDeliveryService } from '../../../src/modules/webhooks/services/webhooks-delivery.service.js';
import { WebhooksEndpointsService } from '../../../src/modules/webhooks/services/webhooks-endpoints.service.js';

const originalFetch = globalThis.fetch;

function createInMemoryRepos() {
  let endpointSeq = 1;
  let deliverySeq = 1;
  let attemptSeq = 1;

  const endpoints = new Map<number, WebhookEndpointEntity>();
  const deliveries = new Map<number, WebhookDeliveryEntity>();
  const attempts = new Map<number, WebhookDeliveryAttemptEntity>();

  const endpointRepo = {
    findByIdSafe: async (id: number) => {
      const ep = endpoints.get(Number(id));
      return ep && !ep.deletedAt ? ep : null;
    },
    findByIds: async (ids: readonly number[]) => {
      const out: WebhookEndpointEntity[] = [];
      for (const id of new Set(ids.map(Number))) {
        const ep = endpoints.get(id);
        if (ep && !ep.deletedAt) out.push(ep);
      }
      return out;
    },
    findAllActive: async () =>
      [...endpoints.values()].filter(
        (ep) => !ep.deletedAt && ep.status === WEBHOOK_ENDPOINT_STATUS.ACTIVE,
      ),
    saveEntity: async (partial: Partial<WebhookEndpointEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : endpointSeq++;
      const existing = endpoints.get(id);
      const entity = Object.assign(new WebhookEndpointEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: existing?.deletedAt ?? null,
      });
      endpoints.set(id, entity);
      return entity;
    },
    listPaginated: async () => ({
      data: [...endpoints.values()].filter((e) => !e.deletedAt),
      meta: {
        page: 1,
        limit: 20,
        total: endpoints.size,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const ep = endpoints.get(Number(criteria.id));
        if (ep) ep.deletedAt = new Date();
      },
    },
  } as unknown as WebhookEndpointRepository;

  const deliveryRepo = {
    findByIdSafe: async (id: number) => deliveries.get(Number(id)) ?? null,
    saveEntity: async (partial: Partial<WebhookDeliveryEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : deliverySeq++;
      const existing = deliveries.get(id);
      const entity = Object.assign(new WebhookDeliveryEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      deliveries.set(id, entity);
      return entity;
    },
    listPaginated: async () => ({
      data: [...deliveries.values()],
      meta: {
        page: 1,
        limit: 20,
        total: deliveries.size,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    }),
  } as unknown as WebhookDeliveryRepository;

  const attemptRepo = {
    findByDeliveryId: async (deliveryId: number) =>
      [...attempts.values()]
        .filter((a) => Number(a.deliveryId) === Number(deliveryId))
        .sort((a, b) => a.attemptNumber - b.attemptNumber),
    saveEntity: async (partial: Partial<WebhookDeliveryAttemptEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : attemptSeq++;
      const entity = Object.assign(new WebhookDeliveryAttemptEntity(), partial, {
        id,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      attempts.set(id, entity);
      return entity;
    },
  } as unknown as WebhookDeliveryAttemptRepository;

  return { endpointRepo, deliveryRepo, attemptRepo, endpoints, deliveries, attempts };
}

function createHarness() {
  const repos = createInMemoryRepos();
  const encryption = new FieldEncryptionService();
  const auditLog = new AuditLogService();
  const httpClient = new BaseHttpClientProvider(
    new HttpServiceRegistry(),
    new CircuitBreakerRegistry(),
    new HttpClientMetricsService(),
  );

  const publishedJobs: Array<{
    topic: string;
    payload: unknown;
    queue: string;
    options: Record<string, unknown>;
  }> = [];

  const publisher = {
    publish: async (
      topic: string,
      payload: unknown,
      queue: string,
      options: Record<string, unknown>,
    ) => {
      publishedJobs.push({ topic, payload, queue, options });
      return {
        id: `msg-${publishedJobs.length}`,
        topic,
        payload,
        timestamp: new Date().toISOString(),
      };
    },
  };

  const notificationsDispatched: Array<Record<string, unknown>> = [];
  const notificationsMock: INotificationsPublicService = {
    dispatch: async (input) => {
      notificationsDispatched.push(input as unknown as Record<string, unknown>);
      return {} as never;
    },
    getUnreadSummary: async () => ({ unreadCount: 0 }) as never,
    getUserPreferences: async () => [],
    getRuntimeConfig: () => ({}) as never,
  };

  const publicLookup: WebhookDnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

  const endpointsService = new WebhooksEndpointsService(
    repos.endpointRepo,
    undefined,
    encryption,
    auditLog,
  );
  endpointsService.setDnsLookupForTesting(publicLookup);

  const deliveryService = new WebhooksDeliveryService(
    repos.endpointRepo,
    repos.deliveryRepo,
    repos.attemptRepo,
    httpClient,
    publisher as never,
    undefined,
    encryption,
    auditLog,
    notificationsMock,
  );
  deliveryService.setDnsLookupForTesting(publicLookup);

  return {
    ...repos,
    encryption,
    auditLog,
    publishedJobs,
    notificationsDispatched,
    endpointsService,
    deliveryService,
  };
}

describe('Phase 10.2 — Webhooks Delivery, Retry, Auto-Disable & Replay', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('1. Creates endpoint with encrypted secret, returns plaintext once, and audits creation without secret leak', async () => {
    const h = createHarness();
    const created = await h.endpointsService.createEndpoint(
      {
        name: 'Partner CRM',
        url: 'https://partner.example.com/webhooks',
        events: ['user.created', 'payment.completed'],
        status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
        customHeaders: { Authorization: 'Bearer top-secret' },
      },
      { id: 10, email: 'admin@core.local', roles: ['admin'] } as never,
    );

    expect(created.signingSecret.startsWith('whsec_')).toBe(true);
    expect(created.signingSecretPrefix).toContain('whsec_');
    expect(created.maxRetries).toBe(5);
    expect(created.failureThreshold).toBe(10);

    const fetched = await h.endpointsService.getEndpointById(created.id);
    expect('signingSecret' in fetched).toBe(false);

    const stored = h.endpoints.get(created.id)!;
    expect(h.encryption.isEncrypted(stored.signingSecretEncrypted)).toBe(true);
    expect(h.encryption.decrypt(stored.signingSecretEncrypted)).toBe(created.signingSecret);

    const logs = await h.auditLog.listPaginated({ module: 'webhooks', action: 'CREATE' });
    expect(logs.data.length).toBe(1);
    expect(JSON.stringify(logs.data[0])).not.toContain(created.signingSecret);
  });

  it('2. Dispatches matching events to queue system.events and signs outbound HTTP request accurately', async () => {
    const h = createHarness();
    const ep = await h.endpointsService.createEndpoint({
      name: 'Billing Hook',
      url: 'https://billing.example.com/hook',
      events: ['payment.completed', 'user.*'],
      status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
      customHeaders: { 'X-Api-Key': 'partner-key-123' },
    });

    await h.endpointsService.createEndpoint({
      name: 'Paused Hook',
      url: 'https://paused.example.com/hook',
      events: ['*'],
      status: WEBHOOK_ENDPOINT_STATUS.PAUSED,
    });

    const dispatchRes = await h.deliveryService.dispatchEvent({
      eventName: 'payment.completed',
      eventId: 'evt_pay_99',
      payload: { orderId: 99, amount: 500000 },
      correlationId: 'corr-abc-123',
    });

    expect(dispatchRes.matchedEndpointsCount).toBe(1);
    expect(dispatchRes.queuedCount).toBe(1);
    expect(h.publishedJobs.length).toBe(1);
    expect(h.publishedJobs[0]?.queue).toBe(QUEUES.SYSTEM_EVENTS);
    expect(h.publishedJobs[0]?.topic).toBe(WEBHOOKS_QUEUE_TOPICS.DELIVERY_SEND);
    expect(h.publishedJobs[0]?.options['attempts']).toBe(6);
    expect(h.publishedJobs[0]?.options['backoff']).toBe('exponential');
    expect(h.publishedJobs[0]?.options['backoffDelayMs']).toBe(5000);

    let capturedHeaders: Headers | null = null;
    let capturedBody = '';
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }) as typeof fetch;

    const deliveryId = dispatchRes.deliveryIds[0]!;
    const execRes = await h.deliveryService.processQueuedDelivery(
      { deliveryId },
      { attemptNumber: 1, maxAttempts: 6 },
    );

    expect(execRes.status).toBe('DELIVERED');
    expect(execRes.httpStatus).toBe(200);
    expect(capturedHeaders).not.toBeNull();

    const sig = capturedHeaders!.get(WEBHOOK_HEADERS.SIGNATURE.toLowerCase());
    const ts = capturedHeaders!.get(WEBHOOK_HEADERS.TIMESTAMP.toLowerCase());
    expect(
      verifyWebhookSignature({
        rawBody: capturedBody,
        signatureHeader: sig,
        timestampHeader: ts,
        secret: ep.signingSecret,
        toleranceSec: 300,
      }),
    ).toBe(true);

    const detail = await h.deliveryService.getDeliveryById(deliveryId);
    expect(detail.statusName).toBe('DELIVERED');
    expect(detail.attempts?.length).toBe(1);
    expect(detail.attempts?.[0]?.isSuccess).toBe(true);
    expect(detail.attempts?.[0]?.requestHeaders['X-Api-Key']).toBe('••••••••');
    expect(detail.attempts?.[0]?.requestHeaders[WEBHOOK_HEADERS.SIGNATURE]).toBe('••••••••');
  });

  it('3. Retries transient 503 with exponential backoff and stops immediately on permanent 400 or 302 redirect', async () => {
    const h = createHarness();
    await h.endpointsService.createEndpoint({
      name: 'Retry Hook',
      url: 'https://retry.example.com/hook',
      events: ['user.created'],
      status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
      maxRetries: 2,
    });

    const dispatched = await h.deliveryService.dispatchEvent({
      eventName: 'user.created',
      payload: { userId: 7 },
    });
    const deliveryId = dispatched.deliveryIds[0]!;

    // Attempt 1: 503 transient -> RETRYING + retryable JobError
    globalThis.fetch = (async () =>
      new Response('Service Unavailable', { status: 503 })) as typeof fetch;

    await expect(
      h.deliveryService.processQueuedDelivery({ deliveryId }, { attemptNumber: 1, maxAttempts: 3 }),
    ).rejects.toMatchObject({ retryable: true });

    let state = await h.deliveryService.getDeliveryById(deliveryId);
    expect(state.statusName).toBe('RETRYING');
    expect(state.nextRetryAt).not.toBeNull();
    expect(state.attempts?.length).toBe(1);

    // Attempt 2: 302 redirect blocked -> FAILED + non-retryable JobError
    globalThis.fetch = (async () =>
      new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1/secret' },
      })) as typeof fetch;

    await expect(
      h.deliveryService.processQueuedDelivery({ deliveryId }, { attemptNumber: 2, maxAttempts: 3 }),
    ).rejects.toMatchObject({ retryable: false });

    state = await h.deliveryService.getDeliveryById(deliveryId);
    expect(state.statusName).toBe('FAILED');
    expect(state.lastErrorCode).toBe('WEBHOOK_REDIRECT_BLOCKED');
    expect(state.attempts?.length).toBe(2);
  });

  it('4. Blocks DNS rebinding SSRF at delivery execution time without invoking fetch', async () => {
    const h = createHarness();
    const ep = await h.endpointsService.createEndpoint({
      name: 'Rebind Hook',
      url: 'https://rebind.example.com/hook',
      events: ['user.created'],
      status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
    });

    const dispatched = await h.deliveryService.dispatchEvent({
      eventName: 'user.created',
      payload: { userId: 9 },
    });

    // Simulate attacker changing DNS record after registration to cloud metadata IP
    h.deliveryService.setDnsLookupForTesting(async () => [
      { address: '169.254.169.254', family: 4 },
    ]);

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await expect(
      h.deliveryService.processQueuedDelivery(
        { deliveryId: dispatched.deliveryIds[0]! },
        { attemptNumber: 1, maxAttempts: 6 },
      ),
    ).rejects.toBeInstanceOf(JobError);

    expect(fetchCalled).toBe(false);
    const detail = await h.deliveryService.getDeliveryById(dispatched.deliveryIds[0]!);
    expect(detail.statusName).toBe('FAILED');
    expect(detail.lastErrorCode).toBe('SSRF_BLOCKED');
    expect(h.endpoints.get(ep.id)?.consecutiveFailures).toBe(1);
  });

  it('5. Auto-disables endpoint after consecutive failures, alerts admins, supports reactivate & manual replay with audit', async () => {
    const h = createHarness();
    const ep = await h.endpointsService.createEndpoint(
      {
        name: 'Flaky Partner',
        url: 'https://flaky.example.com/hook',
        events: ['order.paid'],
        status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
        maxRetries: 0,
        failureThreshold: 3,
      },
      { id: 1, email: 'owner@core.local', roles: ['admin'] } as never,
    );

    globalThis.fetch = (async () => new Response('Bad Request', { status: 400 })) as typeof fetch;

    const failedDeliveryIds: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await h.deliveryService.dispatchEvent({
        eventName: 'order.paid',
        payload: { orderNo: i + 1 },
      });
      const id = res.deliveryIds[0]!;
      failedDeliveryIds.push(id);
      await expect(
        h.deliveryService.processQueuedDelivery(
          { deliveryId: id },
          { attemptNumber: 1, maxAttempts: 1 },
        ),
      ).rejects.toMatchObject({ retryable: false });
    }

    const disabledEp = await h.endpointsService.getEndpointById(ep.id);
    expect(disabledEp.statusName).toBe('AUTO_DISABLED');
    expect(disabledEp.consecutiveFailures).toBe(3);
    expect(disabledEp.disabledReason).toContain('Auto-disabled after 3');

    // Admin notification was sent & AUTO_DISABLE audit recorded
    expect(h.notificationsDispatched.length).toBe(1);
    expect(h.notificationsDispatched[0]?.['referenceType']).toBe('webhook_endpoint');
    const autoDisableAudits = await h.auditLog.listPaginated({
      module: 'webhooks',
      action: 'AUTO_DISABLE',
    });
    expect(autoDisableAudits.data.length).toBe(1);

    // Replay must be rejected while endpoint is AUTO_DISABLED
    await expect(
      h.deliveryService.replayDelivery(
        failedDeliveryIds[2]!,
        { reason: 'Retry before reactivate' },
        { id: 5, email: 'ops@core.local', roles: ['admin'] } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    // Reactivate endpoint -> resets consecutiveFailures and unlocks
    const reactivated = await h.endpointsService.reactivateEndpoint(
      ep.id,
      { reason: 'Partner fixed endpoint' },
      { id: 5, email: 'ops@core.local', roles: ['admin'] } as never,
    );
    expect(reactivated.statusName).toBe('ACTIVE');
    expect(reactivated.consecutiveFailures).toBe(0);

    // Manual replay succeeds and writes audit + creates linked delivery
    const replayed = await h.deliveryService.replayDelivery(
      failedDeliveryIds[2]!,
      { reason: 'Manual replay after partner recovery' },
      { id: 5, email: 'ops@core.local', roles: ['admin'] } as never,
    );
    expect(replayed.triggerSource).toBe(WEBHOOK_TRIGGER_SOURCE.MANUAL_REPLAY);
    expect(replayed.replayedFromDeliveryId).toBe(failedDeliveryIds[2]!);
    expect(replayed.statusName).toBe('PENDING');

    const replayAudits = await h.auditLog.listPaginated({ module: 'webhooks', action: 'REPLAY' });
    expect(replayAudits.data.length).toBe(1);
    expect(replayAudits.data[0]?.reason).toBe('Manual replay after partner recovery');

    // Process replayed delivery successfully
    globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch;
    const processed = await h.deliveryService.processQueuedDelivery(
      { deliveryId: replayed.id },
      { attemptNumber: 1, maxAttempts: 1 },
    );
    expect(processed.status).toBe('DELIVERED');
  });

  it('6. Test event delivery runs once with TEST trigger source and does not increment failure counter', async () => {
    const h = createHarness();
    const ep = await h.endpointsService.createEndpoint({
      name: 'Test Only Hook',
      url: 'https://test.example.com/hook',
      events: ['user.created'],
      status: WEBHOOK_ENDPOINT_STATUS.ACTIVE,
      failureThreshold: 2,
    });

    const testDelivery = await h.deliveryService.sendTestEvent(
      ep.id,
      { eventName: 'user.created', payload: { test: true } },
      { id: 2, email: 'tester@core.local', roles: ['admin'] } as never,
    );
    expect(testDelivery.triggerSource).toBe(WEBHOOK_TRIGGER_SOURCE.TEST);
    expect(testDelivery.maxAttempts).toBe(1);

    globalThis.fetch = (async () => new Response('fail', { status: 500 })) as typeof fetch;
    await expect(
      h.deliveryService.processQueuedDelivery(
        { deliveryId: testDelivery.id },
        { attemptNumber: 1, maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ retryable: true });

    const epAfter = await h.endpointsService.getEndpointById(ep.id);
    expect(epAfter.consecutiveFailures).toBe(0);
    expect(epAfter.statusName).toBe('ACTIVE');
  });
});
