import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService, TransactionManager } from '@packages/database/index.js';
import { REQUIRED_PERMISSIONS_KEY, createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  DomainEventBusService,
  OUTBOX_EVENT_STATUS,
  OUTBOX_LAG_STATUS,
  OUTBOX_QUEUE_TOPICS,
  OutboxPublisherService,
  SettingRegistryService,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { QUEUES, type BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import type { IOutboxTransport, ListOutboxEventsInput } from '@modules/outbox/contracts/index.js';
import { OutboxController } from '@modules/outbox/controllers/outbox.controller.js';
import { OutboxEventEntity } from '@modules/outbox/entities/outbox-event.entity.js';
import { OUTBOX_SETTING_KEYS } from '@modules/outbox/enum/outbox.enum.js';
import { computeOutboxRetryDelayMs } from '@modules/outbox/helpers/outbox-config.helper.js';
import type { OutboxEventRepository } from '@modules/outbox/repositories/outbox-event.repository.js';
import { OutboxRelayService } from '@modules/outbox/services/outbox-relay.service.js';
import { BullMqOutboxTransport } from '@modules/outbox/services/outbox-transport.service.js';
import { OutboxService } from '@modules/outbox/services/outbox.service.js';
import type {
  OutboxTransportDispatchInput,
  OutboxTransportDispatchResult,
  RawOutboxMetricsCounts,
} from '@modules/outbox/types/outbox.types.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

/**
 * Tạo cặp TransactionManager thật + OutboxEventRepository in-memory hỗ trợ commit/rollback nguyên tử
 * để kiểm thử chính xác ngữ nghĩa Transactional Outbox mà không cần DB ngoài.
 */
function createTransactionalOutboxFixture() {
  applyTestEnv({ DB_TRANSACTION_TIMEOUT_MS: '5000' });
  const config = new CoreConfigService();

  let seq = 1;
  let committedRows = new Map<number, OutboxEventEntity>();
  let stagedRows: Map<number, OutboxEventEntity> | null = null;

  const activeRows = () => stagedRows ?? committedRows;

  const cloneRows = (src: Map<number, OutboxEventEntity>) => {
    const copy = new Map<number, OutboxEventEntity>();
    for (const [k, v] of src.entries()) {
      copy.set(k, Object.assign(new OutboxEventEntity(), v));
    }
    return copy;
  };

  const mockDataSource = {
    isInitialized: true,
    createQueryRunner: () => {
      const runner = {
        manager: {} as EntityManager,
        connect: async () => undefined,
        startTransaction: async () => {
          stagedRows = cloneRows(committedRows);
        },
        commitTransaction: async () => {
          if (stagedRows) {
            committedRows = stagedRows;
            stagedRows = null;
          }
        },
        rollbackTransaction: async () => {
          stagedRows = null;
        },
        release: async () => undefined,
        query: async () => [],
      } as unknown as QueryRunner;
      return runner;
    },
  } as unknown as DataSource;

  const mockConnection = {
    connected: () => mockDataSource,
    driver: 'mysql',
    getStatus: () => ({ state: 'connected' }),
  } as unknown as DatabaseConnectionService;

  const transactionManager = new TransactionManager(mockConnection, config);

  const repo = {
    isDatabaseReady: () => true,
    findByIdSafe: async (id: number) => {
      const found = activeRows().get(Number(id));
      return found ? Object.assign(new OutboxEventEntity(), found) : null;
    },
    findByEventId: async (eventId: string) => {
      for (const row of activeRows().values()) {
        if (row.eventId === eventId) return Object.assign(new OutboxEventEntity(), row);
      }
      return null;
    },
    saveEntity: async (partial: Partial<OutboxEventEntity>) => {
      const rows = activeRows();
      const now = new Date();
      const id = partial.id ? Number(partial.id) : seq++;
      const existing = rows.get(id);
      const entity = Object.assign(new OutboxEventEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: partial.createdAt ?? existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      });
      rows.set(id, entity);
      return Object.assign(new OutboxEventEntity(), entity);
    },
    listPaginated: async (filter: ListOutboxEventsInput): Promise<PaginatedResult<OutboxEventEntity>> => {
      const all = [...activeRows().values()].filter((row) => {
        if (filter.status !== undefined && row.status !== filter.status) return false;
        if (filter.sourceModule && row.sourceModule !== filter.sourceModule) return false;
        if (
          filter.eventType &&
          row.eventType !== filter.eventType &&
          row.dotName !== filter.eventType.toLowerCase()
        ) {
          return false;
        }
        if (filter.correlationId && row.correlationId !== filter.correlationId) return false;
        return true;
      });
      all.sort((a, b) => Number(b.id) - Number(a.id));
      const page = filter.page ?? 1;
      const limit = filter.limit ?? 20;
      const start = (page - 1) * limit;
      return createPaginatedResult(all.slice(start, start + limit), all.length, page, limit);
    },
    claimNextBatch: async (
      workerId: string,
      batchSize: number,
      leaseTimeoutMs: number,
      now: Date = new Date(),
    ) => {
      const rows = activeRows();
      const lockedUntil = new Date(now.getTime() + leaseTimeoutMs);
      const claimed: OutboxEventEntity[] = [];

      const sorted = [...rows.values()].sort((a, b) => Number(a.id) - Number(b.id));
      for (const row of sorted) {
        if (claimed.length >= batchSize) break;
        const isRetryableDue =
          (row.status === OUTBOX_EVENT_STATUS.PENDING || row.status === OUTBOX_EVENT_STATUS.FAILED) &&
          (!row.nextAttemptAt || row.nextAttemptAt.getTime() <= now.getTime());
        const isExpiredLease =
          row.status === OUTBOX_EVENT_STATUS.PROCESSING &&
          row.lockedUntil !== null &&
          row.lockedUntil.getTime() <= now.getTime();

        if (isRetryableDue || isExpiredLease) {
          row.status = OUTBOX_EVENT_STATUS.PROCESSING;
          row.lockedBy = workerId;
          row.lockedUntil = lockedUntil;
          claimed.push(Object.assign(new OutboxEventEntity(), row));
        }
      }
      return claimed;
    },
    markPublished: async (id: number, workerId: string, attemptCount: number, publishedAt: Date) => {
      const row = activeRows().get(id);
      if (!row || row.lockedBy !== workerId) return;
      row.status = OUTBOX_EVENT_STATUS.PUBLISHED;
      row.attemptCount = attemptCount;
      row.lastAttemptedAt = publishedAt;
      row.publishedAt = publishedAt;
      row.nextAttemptAt = null;
      row.lockedBy = null;
      row.lockedUntil = null;
      row.lastErrorCode = null;
      row.lastErrorMessage = null;
    },
    markFailed: async (params: {
      id: number;
      workerId: string;
      attemptCount: number;
      nextAttemptAt: Date;
      attemptedAt: Date;
      errorCode: string;
      errorMessage: string;
    }) => {
      const row = activeRows().get(params.id);
      if (!row || row.lockedBy !== params.workerId) return;
      row.status = OUTBOX_EVENT_STATUS.FAILED;
      row.attemptCount = params.attemptCount;
      row.lastAttemptedAt = params.attemptedAt;
      row.nextAttemptAt = params.nextAttemptAt;
      row.lockedBy = null;
      row.lockedUntil = null;
      row.lastErrorCode = params.errorCode;
      row.lastErrorMessage = params.errorMessage;
    },
    markDeadLetter: async (params: {
      id: number;
      workerId: string;
      attemptCount: number;
      attemptedAt: Date;
      errorCode: string;
      errorMessage: string;
      reason: string;
    }) => {
      const row = activeRows().get(params.id);
      if (!row || row.lockedBy !== params.workerId) return;
      row.status = OUTBOX_EVENT_STATUS.DEAD_LETTER;
      row.attemptCount = params.attemptCount;
      row.lastAttemptedAt = params.attemptedAt;
      row.nextAttemptAt = null;
      row.lockedBy = null;
      row.lockedUntil = null;
      row.lastErrorCode = params.errorCode;
      row.lastErrorMessage = params.errorMessage;
      row.deadLetteredAt = params.attemptedAt;
      row.deadLetterReason = params.reason;
    },
    getRawMetrics: async (now: Date = new Date()): Promise<RawOutboxMetricsCounts> => {
      const since24h = now.getTime() - 24 * 60 * 60 * 1000;
      let pendingCount = 0;
      let processingCount = 0;
      let failedCount = 0;
      let deadLetterCount = 0;
      let publishedLast24hCount = 0;
      let oldestPendingCreatedAt: Date | null = null;
      let totalLagMs = 0;
      let lagSamples = 0;

      for (const row of activeRows().values()) {
        if (row.status === OUTBOX_EVENT_STATUS.PENDING) pendingCount += 1;
        else if (row.status === OUTBOX_EVENT_STATUS.PROCESSING) processingCount += 1;
        else if (row.status === OUTBOX_EVENT_STATUS.FAILED) failedCount += 1;
        else if (row.status === OUTBOX_EVENT_STATUS.DEAD_LETTER) deadLetterCount += 1;
        else if (
          row.status === OUTBOX_EVENT_STATUS.PUBLISHED &&
          row.publishedAt &&
          row.publishedAt.getTime() >= since24h
        ) {
          publishedLast24hCount += 1;
          totalLagMs += Math.max(0, row.publishedAt.getTime() - row.createdAt.getTime());
          lagSamples += 1;
        }

        if (
          row.status === OUTBOX_EVENT_STATUS.PENDING ||
          row.status === OUTBOX_EVENT_STATUS.FAILED
        ) {
          if (!oldestPendingCreatedAt || row.createdAt.getTime() < oldestPendingCreatedAt.getTime()) {
            oldestPendingCreatedAt = row.createdAt;
          }
        }
      }

      return {
        pendingCount,
        processingCount,
        failedCount,
        deadLetterCount,
        publishedLast24hCount,
        oldestPendingCreatedAt,
        avgPublishLagMs: lagSamples > 0 ? Math.round(totalLagMs / lagSamples) : null,
      };
    },
    purgeExpiredByStatus: async (
      status: typeof OUTBOX_EVENT_STATUS.PUBLISHED | typeof OUTBOX_EVENT_STATUS.DEAD_LETTER,
      cutoffDate: Date,
      batchSize: number,
    ) => {
      const rows = activeRows();
      const idsToDelete: number[] = [];
      for (const row of rows.values()) {
        if (idsToDelete.length >= batchSize) break;
        if (row.status !== status) continue;
        const refDate =
          status === OUTBOX_EVENT_STATUS.PUBLISHED
            ? (row.publishedAt ?? row.updatedAt)
            : (row.deadLetteredAt ?? row.updatedAt);
        if (refDate.getTime() <= cutoffDate.getTime()) {
          idsToDelete.push(Number(row.id));
        }
      }
      for (const id of idsToDelete) {
        rows.delete(id);
      }
      return idsToDelete.length;
    },
  } as unknown as OutboxEventRepository;

  return {
    transactionManager,
    repo,
    getCommittedRows: () => [...committedRows.values()],
  };
}

describe('Transactional Outbox (Phase 11.2)', () => {
  afterEach(() => {
    applyTestEnv();
  });

  it('commits and rolls back outbox events atomically with business transaction', async () => {
    const fixture = createTransactionalOutboxFixture();
    const bus = new DomainEventBusService();
    bus.setContextResolver(() => {
      const store = RequestContextService.current();
      return store
        ? {
            requestId: store.requestId ?? null,
            correlationId: store.correlationId ?? null,
            actorId: store.userId ?? null,
          }
        : undefined;
    });
    const publisher = new OutboxPublisherService(bus);
    const settings = new SettingRegistryService();
    const relay = new OutboxRelayService(fixture.repo, undefined, undefined, settings);
    const service = new OutboxService(
      fixture.repo,
      relay,
      fixture.transactionManager,
      publisher,
      bus,
      settings,
    );
    service.onModuleInit();

    // 1. Rollback: nghiệp vụ lỗi sau khi ghi Outbox -> bảng Outbox phải sạch hoàn toàn
    await expect(
      fixture.transactionManager.runInTransaction(async () => {
        await publisher.enqueue(
          {
            type: 'OrderCreated',
            sourceModule: 'orders',
            aggregateType: 'Order',
            aggregateId: 'ord-999',
            payload: { orderId: 'ord-999', totalAmount: 500000 },
          },
          { requireTransaction: true },
        );
        throw new Error('Simulated DB failure after outbox write');
      }),
    ).rejects.toThrow('Simulated DB failure');

    expect(fixture.getCommittedRows()).toHaveLength(0);

    // 2. RequireTransaction ngoài transaction -> từ chối
    await expect(
      publisher.enqueue(
        {
          type: 'OrderCreated',
          sourceModule: 'orders',
          payload: { orderId: 'ord-no-tx' },
        },
        { requireTransaction: true },
      ),
    ).rejects.toThrow(BadRequestAppException);

    // 3. Commit thành công kèm RequestContext (requestId, correlationId, actorId)
    await RequestContextService.runWith(
      { requestId: 'req-tx-1', correlationId: 'corr-tx-1', userId: '42' },
      async () => {
        await fixture.transactionManager.runInTransaction(async () => {
          const enqueued = await publisher.enqueue(
            {
              type: 'OrderCreated',
              sourceModule: 'orders',
              aggregateType: 'Order',
              aggregateId: 'ord-100',
              payload: { orderId: 'ord-100', totalAmount: 250000 },
            },
            { requireTransaction: true },
          );
          expect(enqueued.persisted).toBe(true);
          expect(enqueued.statusName).toBe('PENDING');
        });
      },
    );

    const rows = fixture.getCommittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('OrderCreated');
    expect(rows[0]?.dotName).toBe('order.created');
    expect(rows[0]?.partitionKey).toBe('Order:ord-100');
    expect(rows[0]?.requestId).toBe('req-tx-1');
    expect(rows[0]?.correlationId).toBe('corr-tx-1');
    expect(rows[0]?.actorId).toBe('42');

    service.onModuleDestroy();
  });

  it('relays pending events safely with lease locking, bounded retries, backoff and dead-lettering', async () => {
    const fixture = createTransactionalOutboxFixture();
    const bus = new DomainEventBusService();
    const publisher = new OutboxPublisherService(bus);
    const settings = new SettingRegistryService();
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.MAX_RETRIES, 3);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.RETRY_BASE_DELAY_MS, 2000);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.RETRY_MAX_DELAY_MS, 20000);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.LEASE_TIMEOUT_MS, 10000);

    let mode: 'ok' | 'transient' | 'permanent' = 'ok';
    const dispatched: OutboxTransportDispatchInput[] = [];
    const mockTransport: IOutboxTransport = {
      driverName: 'mock-broker',
      dispatch: async (input): Promise<OutboxTransportDispatchResult> => {
        if (mode === 'transient') {
          const err = new Error('Redis broker connection reset') as Error & { code?: string };
          err.code = 'ECONNRESET';
          throw err;
        }
        if (mode === 'permanent') {
          const err = new Error('Destination queue does not exist') as Error & {
            code?: string;
            permanent?: boolean;
          };
          err.code = 'UNKNOWN_DESTINATION_QUEUE';
          err.permanent = true;
          throw err;
        }
        dispatched.push(input);
        return {
          brokerMessageId: `msg-${input.outboxId}`,
          queue: input.destinationQueue,
          topic: input.destinationTopic,
        };
      },
    };

    const relay = new OutboxRelayService(fixture.repo, mockTransport, undefined, settings);
    const service = new OutboxService(
      fixture.repo,
      relay,
      fixture.transactionManager,
      publisher,
      bus,
      settings,
    );
    service.onModuleInit();

    // A. Gửi thành công -> PUBLISHED
    const okRec = await publisher.enqueue({
      type: 'UserCreated',
      sourceModule: 'users',
      payload: { userId: 10, username: 'alice' },
    });
    const t0 = new Date('2026-11-25T10:00:00.000Z');
    const r1 = await relay.processBatch({ workerId: 'worker-a', now: t0 });
    expect(r1.claimedCount).toBe(1);
    expect(r1.publishedCount).toBe(1);
    expect(dispatched).toHaveLength(1);
    const okRow = await service.getEventById(okRec.id!);
    expect(okRow.statusName).toBe('PUBLISHED');
    expect(okRow.publishedAt).not.toBeNull();

    // B. Lỗi tạm thời 3 lần -> FAILED (lần 1, 2) rồi DEAD_LETTER (lần 3)
    mode = 'transient';
    const retryRec = await publisher.enqueue({
      type: 'PaymentSettled',
      sourceModule: 'payments',
      payload: { paymentId: 501 },
    });

    const t1 = new Date('2026-11-25T10:01:00.000Z');
    const fail1 = await relay.processBatch({ workerId: 'worker-a', now: t1 });
    expect(fail1.failedCount).toBe(1);
    const after1 = await service.getEventById(retryRec.id!);
    expect(after1.statusName).toBe('FAILED');
    expect(after1.attemptCount).toBe(1);
    expect(after1.nextAttemptAt).not.toBeNull();

    // Chưa tới nextAttemptAt -> worker khác không được claim
    const earlyClaim = await relay.processBatch({
      workerId: 'worker-b',
      now: new Date(t1.getTime() + 100),
    });
    expect(earlyClaim.claimedCount).toBe(0);

    // Lần thử 2 khi đến hạn
    const t2 = new Date(new Date(after1.nextAttemptAt!).getTime() + 100);
    const fail2 = await relay.processBatch({ workerId: 'worker-b', now: t2 });
    expect(fail2.failedCount).toBe(1);
    const after2 = await service.getEventById(retryRec.id!);
    expect(after2.statusName).toBe('FAILED');
    expect(after2.attemptCount).toBe(2);

    // Lần thử 3 -> vượt giới hạn maxRetries (3) -> DEAD_LETTER
    const t3 = new Date(new Date(after2.nextAttemptAt!).getTime() + 100);
    const fail3 = await relay.processBatch({ workerId: 'worker-a', now: t3 });
    expect(fail3.deadLetteredCount).toBe(1);
    const after3 = await service.getEventById(retryRec.id!);
    expect(after3.statusName).toBe('DEAD_LETTER');
    expect(after3.deadLetteredAt).not.toBeNull();
    expect(after3.deadLetterReason).toContain('Max retries exhausted');

    // C. Lỗi vĩnh viễn -> vào thẳng DEAD_LETTER ngay lần đầu
    mode = 'permanent';
    const permRec = await publisher.enqueue({
      type: 'InvoiceIssued',
      sourceModule: 'billing',
      payload: { invoiceId: 88 },
    });
    const permRes = await relay.processBatch({ workerId: 'worker-a', now: t3 });
    expect(permRes.deadLetteredCount).toBe(1);
    const permRow = await service.getEventById(permRec.id!);
    expect(permRow.statusName).toBe('DEAD_LETTER');
    expect(permRow.attemptCount).toBe(1);
    expect(permRow.deadLetterReason).toContain('Permanent dispatch error');

    // D. Thu hồi lease hết hạn khi worker trước bị crash
    mode = 'ok';
    const leaseRec = await publisher.enqueue({
      type: 'OrderShipped',
      sourceModule: 'orders',
      payload: { orderId: 77 },
    });
    const claimedByDeadWorker = await fixture.repo.claimNextBatch('dead-worker', 10, 10000, t3);
    expect(claimedByDeadWorker).toHaveLength(1);
    // Worker sống gọi trước khi lease hết hạn -> không lấy được
    const beforeExpire = await relay.processBatch({
      workerId: 'alive-worker',
      now: new Date(t3.getTime() + 5000),
    });
    expect(beforeExpire.claimedCount).toBe(0);
    // Sau khi lease hết hạn (>10s) -> worker sống thu hồi & publish thành công
    const afterExpire = await relay.processBatch({
      workerId: 'alive-worker',
      now: new Date(t3.getTime() + 12000),
    });
    expect(afterExpire.publishedCount).toBe(1);
    expect((await service.getEventById(leaseRec.id!)).statusName).toBe('PUBLISHED');

    // Backoff tăng lũy thừa có giới hạn trần
    const d1 = computeOutboxRetryDelayMs(1, { retryBaseDelayMs: 5000, retryMaxDelayMs: 60000 }, () => 0.5);
    const d2 = computeOutboxRetryDelayMs(2, { retryBaseDelayMs: 5000, retryMaxDelayMs: 60000 }, () => 0.5);
    const d8 = computeOutboxRetryDelayMs(8, { retryBaseDelayMs: 5000, retryMaxDelayMs: 60000 }, () => 0.5);
    expect(d1).toBe(5000);
    expect(d2).toBe(10000);
    expect(d8).toBe(60000);

    service.onModuleDestroy();
  });

  it('tracks lag metrics, sends cooldown-protected admin alerts, replays with RBAC+Audit and purges by retention', async () => {
    const fixture = createTransactionalOutboxFixture();
    const bus = new DomainEventBusService();
    const publisher = new OutboxPublisherService(bus);
    const settings = new SettingRegistryService();
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.LAG_WARN_COUNT, 2);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.LAG_WARN_AGE_SEC, 30);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.DEAD_LETTER_WARN_COUNT, 1);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.ALERT_COOLDOWN_SEC, 300);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.RETENTION_PUBLISHED_DAYS, 7);
    settings.setGlobalValue(OUTBOX_SETTING_KEYS.RETENTION_DEAD_LETTER_DAYS, 30);

    const notifyDispatch = jest.fn(async () => ({ notificationId: 1 }));
    const mockNotifications = {
      dispatch: notifyDispatch,
    } as unknown as INotificationsPublicService;

    const auditRecord = jest.fn(async () => undefined);
    const mockAudit = {
      record: auditRecord,
    } as unknown as AuditLogService;

    const mockPublisher = {
      publish: jest.fn(async (topic: string) => ({ id: `bull-${topic}` })),
    } as unknown as BaseMessagePublisherProvider;
    const transport = new BullMqOutboxTransport(mockPublisher);

    const relay = new OutboxRelayService(
      fixture.repo,
      transport,
      transport,
      settings,
      undefined,
      null,
      mockNotifications,
    );
    const service = new OutboxService(
      fixture.repo,
      relay,
      fixture.transactionManager,
      publisher,
      bus,
      settings,
      mockAudit,
    );
    service.onModuleInit();

    // Kiểm tra gắn RBAC permissions trên OutboxController
    const reflector = new Reflector();
    expect(reflector.get(REQUIRED_PERMISSIONS_KEY, OutboxController.prototype.listEvents)).toEqual([
      'outbox.read',
    ]);
    expect(reflector.get(REQUIRED_PERMISSIONS_KEY, OutboxController.prototype.replayEvent)).toEqual([
      'outbox.replay',
    ]);
    expect(reflector.get(REQUIRED_PERMISSIONS_KEY, OutboxController.prototype.cleanup)).toEqual([
      'outbox.manage',
    ]);

    const baseNow = new Date('2026-11-25T10:00:00.000Z');
    // Tạo 2 pending quá tuổi (120s) + 1 dead letter + 2 bản ghi cũ để kiểm thử retention
    await fixture.repo.saveEntity({
      eventId: 'ev-old-pending-1',
      eventType: 'UserCreated',
      dotName: 'user.created',
      eventVersion: 1,
      sourceModule: 'users',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ userId: 1 }),
      metadataJson: JSON.stringify({ sourceModule: 'users', dotName: 'user.created' }),
      occurredAt: new Date(baseNow.getTime() - 120_000),
      createdAt: new Date(baseNow.getTime() - 120_000),
      status: OUTBOX_EVENT_STATUS.PENDING,
      attemptCount: 0,
      maxRetries: 5,
    });
    await fixture.repo.saveEntity({
      eventId: 'ev-old-pending-2',
      eventType: 'UserCreated',
      dotName: 'user.created',
      eventVersion: 1,
      sourceModule: 'users',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ userId: 2 }),
      metadataJson: JSON.stringify({ sourceModule: 'users', dotName: 'user.created' }),
      occurredAt: new Date(baseNow.getTime() - 60_000),
      createdAt: new Date(baseNow.getTime() - 60_000),
      status: OUTBOX_EVENT_STATUS.PENDING,
      attemptCount: 0,
      maxRetries: 5,
    });
    const dlqRow = await fixture.repo.saveEntity({
      eventId: 'ev-dlq-1',
      eventType: 'OrderPaid',
      dotName: 'order.paid',
      eventVersion: 1,
      sourceModule: 'orders',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ orderId: 99 }),
      metadataJson: JSON.stringify({ sourceModule: 'orders', dotName: 'order.paid' }),
      occurredAt: new Date(baseNow.getTime() - 3600_000),
      createdAt: new Date(baseNow.getTime() - 3600_000),
      status: OUTBOX_EVENT_STATUS.DEAD_LETTER,
      attemptCount: 5,
      maxRetries: 5,
      deadLetteredAt: new Date(baseNow.getTime() - 3600_000),
      deadLetterReason: 'Broker down',
    });

    // 1. Cảnh báo độ trễ + cooldown
    const alert1 = await service.checkLagAndAlert(baseNow);
    expect(alert1.metrics.lagStatus).toBe(OUTBOX_LAG_STATUS.WARNING);
    expect(alert1.metrics.oldestPendingAgeSec).toBe(120);
    expect(alert1.alerted).toBe(true);
    expect(notifyDispatch).toHaveBeenCalledTimes(1);

    const alert2 = await service.checkLagAndAlert(new Date(baseNow.getTime() + 10_000));
    expect(alert2.alerted).toBe(false);
    expect(alert2.skippedByCooldown).toBe(true);
    expect(notifyDispatch).toHaveBeenCalledTimes(1);

    // 2. Phát lại Dead Letter kèm quyền & Audit Log
    const actor: UserIdentity = {
      id: 7,
      username: 'ops_admin',
      roles: ['admin'],
      permissions: ['outbox.read', 'outbox.replay', 'outbox.manage'],
    };
    const replayed = await service.replayEvent(
      Number(dlqRow.id),
      { reason: 'Broker recovered after incident #402' },
      actor,
    );
    expect(replayed.statusName).toBe('PENDING');
    expect(replayed.replayCount).toBe(1);
    expect(replayed.attemptCount).toBe(0);
    expect(replayed.lastReplayedBy).toBe(7);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 7,
        module: 'outbox',
        action: 'outbox.event.replay',
        resourceId: Number(dlqRow.id),
        reason: 'Broker recovered after incident #402',
      }),
    );

    // Không cho replay bản ghi đang PENDING
    await expect(
      service.replayEvent(Number(dlqRow.id), { reason: 'Duplicate replay attempt' }, actor),
    ).rejects.toThrow(BadRequestAppException);

    // 3. Dọn Event cũ theo chính sách retention (7d PUBLISHED, 30d DEAD_LETTER; giữ nguyên PENDING & bản ghi còn hạn)
    await fixture.repo.saveEntity({
      eventId: 'ev-pub-expired',
      eventType: 'UserUpdated',
      dotName: 'user.updated',
      eventVersion: 1,
      sourceModule: 'users',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ userId: 10 }),
      metadataJson: JSON.stringify({ sourceModule: 'users', dotName: 'user.updated' }),
      occurredAt: new Date(baseNow.getTime() - 10 * 86_400_000),
      createdAt: new Date(baseNow.getTime() - 10 * 86_400_000),
      publishedAt: new Date(baseNow.getTime() - 10 * 86_400_000),
      status: OUTBOX_EVENT_STATUS.PUBLISHED,
    });
    await fixture.repo.saveEntity({
      eventId: 'ev-pub-fresh',
      eventType: 'UserUpdated',
      dotName: 'user.updated',
      eventVersion: 1,
      sourceModule: 'users',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ userId: 11 }),
      metadataJson: JSON.stringify({ sourceModule: 'users', dotName: 'user.updated' }),
      occurredAt: new Date(baseNow.getTime() - 2 * 86_400_000),
      createdAt: new Date(baseNow.getTime() - 2 * 86_400_000),
      publishedAt: new Date(baseNow.getTime() - 2 * 86_400_000),
      status: OUTBOX_EVENT_STATUS.PUBLISHED,
    });
    await fixture.repo.saveEntity({
      eventId: 'ev-dlq-expired',
      eventType: 'OrderFailed',
      dotName: 'order.failed',
      eventVersion: 1,
      sourceModule: 'orders',
      destinationQueue: QUEUES.SYSTEM_EVENTS,
      destinationTopic: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      payloadJson: JSON.stringify({ orderId: 1 }),
      metadataJson: JSON.stringify({ sourceModule: 'orders', dotName: 'order.failed' }),
      occurredAt: new Date(baseNow.getTime() - 35 * 86_400_000),
      createdAt: new Date(baseNow.getTime() - 35 * 86_400_000),
      deadLetteredAt: new Date(baseNow.getTime() - 35 * 86_400_000),
      status: OUTBOX_EVENT_STATUS.DEAD_LETTER,
    });

    const purgeRes = await service.purgeExpiredEvents({ now: baseNow }, actor);
    expect(purgeRes.deletedPublishedCount).toBe(1);
    expect(purgeRes.deletedDeadLetterCount).toBe(1);
    expect(purgeRes.totalDeletedCount).toBe(2);

    // Xác nhận bản ghi còn hạn và PENDING vẫn được giữ nguyên
    expect(await fixture.repo.findByEventId('ev-pub-expired')).toBeNull();
    expect(await fixture.repo.findByEventId('ev-dlq-expired')).toBeNull();
    expect(await fixture.repo.findByEventId('ev-pub-fresh')).not.toBeNull();
    expect(await fixture.repo.findByEventId('ev-old-pending-1')).not.toBeNull();

    service.onModuleDestroy();
  });
});
