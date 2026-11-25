import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { type CallHandler, type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Job } from 'bullmq';
import { firstValueFrom, of, throwError } from 'rxjs';
import { CoreConfigService } from '@packages/config/index.js';
import {
  IDEMPOTENCY_METADATA_KEY,
  IdempotencyInterceptor,
  REQUIRED_PERMISSIONS_KEY,
  createPaginatedResult,
  type IdempotentOptions,
} from '@packages/http/index.js';
import {
  DOMAIN_EVENT_CRITICALITY,
  DomainEventBusService,
  DomainEventRequiredHandlerException,
  HTTP_STATUS_CODE,
  IDEMPOTENCY_ALERT_STATUS,
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_OUTCOME,
  IDEMPOTENCY_QUEUE_TOPICS,
  IDEMPOTENCY_SCOPE,
  IDEMPOTENCY_STATUS,
  IdempotencyInProgressException,
  IdempotencyKeyRequiredException,
  IdempotencyPayloadMismatchException,
  IdempotencyRegistryService,
  OUTBOX_QUEUE_TOPICS,
  SettingRegistryService,
  computeIdempotencyFingerprint,
  normalizeIdempotencyKey,
  redactIdempotencyResponsePayload,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { QUEUES, serializeMessage, type MessageEnvelope } from '@packages/messaging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { BaseQueueProcessor } from '@apps/worker/processors/base-queue.processor.js';
import { SystemProcessor } from '@apps/worker/processors/system/system.processor.js';
import type { ListIdempotencyRecordsInput } from '@modules/idempotency/contracts/index.js';
import { IdempotencyController } from '@modules/idempotency/controllers/idempotency.controller.js';
import { IdempotencyRecordEntity } from '@modules/idempotency/entities/idempotency-record.entity.js';
import { IDEMPOTENCY_SETTING_KEYS } from '@modules/idempotency/enum/idempotency.enum.js';
import {
  resolveEffectiveIdempotencyTtlSec,
  resolveIdempotencyRuntimeConfig,
} from '@modules/idempotency/helpers/idempotency-config.helper.js';
import type {
  IdempotencyRecordRepository,
  InsertIdempotencyRecordParams,
  ReclaimIdempotencyRecordParams,
} from '@modules/idempotency/repositories/idempotency-record.repository.js';
import { IdempotencyStoreService } from '@modules/idempotency/services/idempotency-store.service.js';
import { IdempotencyService } from '@modules/idempotency/services/idempotency.service.js';
import type {
  RawClientRepeatRow,
  RawIdempotencyMetricsSummary,
  RawScopeMetricsRow,
} from '@modules/idempotency/types/idempotency.types.js';
import { UsersController } from '@modules/users/controllers/users.controller.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

/**
 * Fixture in-memory cho `IdempotencyRecordRepository` mô phỏng đầy đủ UNIQUE index,
 * atomic reclaim (EXPIRED/FAILED/STALE_LEASE/SAME_OWNER), duplicate/conflict counters,
 * batch purge và tổng hợp metrics theo scope & client.
 */
function createIdempotencyFixture() {
  applyTestEnv();
  let seq = 1;
  const rows = new Map<number, IdempotencyRecordEntity>();

  const findRowByKey = (
    scope: string,
    scopeTarget: string,
    idempotencyKey: string,
  ): IdempotencyRecordEntity | null => {
    for (const row of rows.values()) {
      if (
        row.scope === scope &&
        row.scopeTarget === scopeTarget &&
        row.idempotencyKey === idempotencyKey
      ) {
        return row;
      }
    }
    return null;
  };

  const cloneRow = (row: IdempotencyRecordEntity) => Object.assign(new IdempotencyRecordEntity(), row);

  const repo = {
    isDatabaseReady: () => true,
    findByIdSafe: async (id: number) => {
      const found = rows.get(Number(id));
      return found ? cloneRow(found) : null;
    },
    findByScopeAndKey: async (scope: string, scopeTarget: string, key: string) => {
      const found = findRowByKey(scope, scopeTarget, key);
      return found ? cloneRow(found) : null;
    },
    tryInsertRecord: async (params: InsertIdempotencyRecordParams) => {
      if (findRowByKey(params.scope, params.scopeTarget, params.idempotencyKey)) {
        return { inserted: false as const };
      }
      const now = new Date();
      const entity = Object.assign(new IdempotencyRecordEntity(), {
        id: seq++,
        scope: params.scope,
        scopeTarget: params.scopeTarget,
        idempotencyKey: params.idempotencyKey,
        requestFingerprint: params.requestFingerprint,
        status: params.status,
        responseStatusCode: params.responseStatusCode ?? null,
        responseBodyJson: params.responseBodyJson ?? null,
        responseHeadersJson: params.responseHeadersJson ?? null,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier,
        correlationId: params.correlationId,
        duplicateHits: 0,
        conflictHits: 0,
        lastDuplicateAt: null,
        lastConflictAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: params.completedAt ?? null,
        expiresAt: params.expiresAt,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      rows.set(entity.id, entity);
      return { inserted: true as const, entity: cloneRow(entity) };
    },
    tryReclaimRecord: async (params: ReclaimIdempotencyRecordParams): Promise<boolean> => {
      const target = rows.get(Number(params.id));
      if (!target) return false;
      if (params.mode === 'EXPIRED' && target.expiresAt.getTime() > params.now.getTime()) {
        return false;
      }
      if (params.mode === 'FAILED' && target.status !== IDEMPOTENCY_STATUS.FAILED) {
        return false;
      }
      if (
        params.mode === 'STALE_LEASE' &&
        (target.status !== IDEMPOTENCY_STATUS.IN_PROGRESS ||
          (target.lockedUntil !== null && target.lockedUntil.getTime() > params.now.getTime()))
      ) {
        return false;
      }
      if (
        params.mode === 'SAME_OWNER' &&
        (target.status !== IDEMPOTENCY_STATUS.IN_PROGRESS ||
          target.lockOwner !== (params.expectedLockOwner ?? ''))
      ) {
        return false;
      }

      target.requestFingerprint = params.requestFingerprint;
      target.status = IDEMPOTENCY_STATUS.IN_PROGRESS;
      target.responseStatusCode = null;
      target.responseBodyJson = null;
      target.responseHeadersJson = null;
      target.lockOwner = params.lockOwner;
      target.lockedUntil = params.lockedUntil;
      target.clientIdentifier = params.clientIdentifier;
      target.correlationId = params.correlationId;
      target.lastErrorCode = null;
      target.lastErrorMessage = null;
      target.completedAt = null;
      target.expiresAt = params.expiresAt;
      target.updatedAt = params.now;
      if (params.mode === 'EXPIRED') {
        target.duplicateHits = 0;
        target.conflictHits = 0;
        target.lastDuplicateAt = null;
        target.lastConflictAt = null;
      }
      return true;
    },
    markCompleted: async (params: {
      id?: number | null;
      scope: string;
      scopeTarget: string;
      idempotencyKey: string;
      statusCode: number | null;
      responseBodyJson: string | null;
      responseHeadersJson: string | null;
      now: Date;
    }) => {
      const target = params.id
        ? rows.get(Number(params.id))
        : findRowByKey(params.scope, params.scopeTarget, params.idempotencyKey);
      if (!target) return;
      target.status = IDEMPOTENCY_STATUS.COMPLETED;
      target.responseStatusCode = params.statusCode;
      target.responseBodyJson = params.responseBodyJson;
      target.responseHeadersJson = params.responseHeadersJson;
      target.lockedUntil = null;
      target.lastErrorCode = null;
      target.lastErrorMessage = null;
      target.completedAt = params.now;
      target.updatedAt = params.now;
    },
    markFailed: async (params: {
      id?: number | null;
      scope: string;
      scopeTarget: string;
      idempotencyKey: string;
      errorCode: string | null;
      errorMessage: string | null;
    }) => {
      const target = params.id
        ? rows.get(Number(params.id))
        : findRowByKey(params.scope, params.scopeTarget, params.idempotencyKey);
      if (!target) return;
      target.status = IDEMPOTENCY_STATUS.FAILED;
      target.lockedUntil = null;
      target.lastErrorCode = params.errorCode;
      target.lastErrorMessage = params.errorMessage;
      target.updatedAt = new Date();
    },
    incrementDuplicateHit: async (id: number, now: Date) => {
      const target = rows.get(Number(id));
      if (!target) return;
      target.duplicateHits += 1;
      target.lastDuplicateAt = now;
      target.updatedAt = now;
    },
    incrementConflictHit: async (id: number, now: Date, errorMessage?: string | null) => {
      const target = rows.get(Number(id));
      if (!target) return;
      target.conflictHits += 1;
      target.lastConflictAt = now;
      if (errorMessage) {
        target.lastErrorCode = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
        target.lastErrorMessage = errorMessage;
      }
      target.updatedAt = now;
    },
    listPaginated: async (
      filter: ListIdempotencyRecordsInput,
    ): Promise<PaginatedResult<IdempotencyRecordEntity>> => {
      const now = new Date();
      const filtered = [...rows.values()]
        .filter((r) => {
          if (filter.scope && r.scope !== filter.scope) return false;
          if (filter.scopeTarget && r.scopeTarget !== filter.scopeTarget) return false;
          if (filter.status !== undefined && r.status !== filter.status) return false;
          if (filter.onlyDuplicates && r.duplicateHits <= 0) return false;
          if (filter.onlyConflicts && r.conflictHits <= 0) return false;
          if (filter.includeExpired === false && r.expiresAt.getTime() <= now.getTime()) return false;
          if (filter.search?.trim()) {
            const needle = filter.search.trim().toLowerCase();
            const haystack = `${r.idempotencyKey} ${r.scopeTarget} ${r.clientIdentifier ?? ''}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          return true;
        })
        .sort((a, b) => b.id - a.id);

      const page = Number(filter.page ?? 1) || 1;
      const limit = Number(filter.limit ?? 20) || 20;
      const start = (page - 1) * limit;
      return createPaginatedResult(
        filtered.slice(start, start + limit).map(cloneRow),
        filtered.length,
        page,
        limit,
      );
    },
    hardDeleteById: async (id: number) => rows.delete(Number(id)),
    purgeExpiredBatch: async (now: Date, batchSize: number) => {
      const expiredIds = [...rows.values()]
        .filter((r) => r.expiresAt.getTime() <= now.getTime())
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
        .slice(0, batchSize)
        .map((r) => r.id);
      for (const id of expiredIds) {
        rows.delete(id);
      }
      return expiredIds.length;
    },
    collectMetricsRaw: async (
      windowStart: Date,
      now: Date = new Date(),
    ): Promise<RawIdempotencyMetricsSummary> => {
      let activeKeysCount = 0;
      let expiredPendingPurgeCount = 0;
      const scopeMap = new Map<string, RawScopeMetricsRow>();
      const clientMap = new Map<string, RawClientRepeatRow>();

      for (const r of rows.values()) {
        if (r.expiresAt.getTime() > now.getTime()) activeKeysCount++;
        else expiredPendingPurgeCount++;

        const inWindow =
          r.createdAt.getTime() >= windowStart.getTime() ||
          (r.lastDuplicateAt && r.lastDuplicateAt.getTime() >= windowStart.getTime()) ||
          (r.lastConflictAt && r.lastConflictAt.getTime() >= windowStart.getTime());
        if (!inWindow) continue;

        const prevScope = scopeMap.get(r.scope) ?? {
          scope: r.scope,
          uniqueKeys: 0,
          inProgressCount: 0,
          completedCount: 0,
          failedCount: 0,
          duplicateHits: 0,
          conflictHits: 0,
        };
        scopeMap.set(r.scope, {
          scope: r.scope,
          uniqueKeys: prevScope.uniqueKeys + 1,
          inProgressCount:
            prevScope.inProgressCount + (r.status === IDEMPOTENCY_STATUS.IN_PROGRESS ? 1 : 0),
          completedCount:
            prevScope.completedCount + (r.status === IDEMPOTENCY_STATUS.COMPLETED ? 1 : 0),
          failedCount: prevScope.failedCount + (r.status === IDEMPOTENCY_STATUS.FAILED ? 1 : 0),
          duplicateHits: prevScope.duplicateHits + r.duplicateHits,
          conflictHits: prevScope.conflictHits + r.conflictHits,
        });

        if (r.duplicateHits > 0 || r.conflictHits > 0) {
          const clientId = r.clientIdentifier ?? 'anonymous';
          const cKey = `${clientId}\u0000${r.scope}\u0000${r.scopeTarget}`;
          const prevClient = clientMap.get(cKey) ?? {
            clientIdentifier: clientId,
            scope: r.scope,
            scopeTarget: r.scopeTarget,
            uniqueKeys: 0,
            duplicateHits: 0,
            conflictHits: 0,
            lastDuplicateAt: null,
          };
          const latestDup =
            r.lastDuplicateAt &&
            (!prevClient.lastDuplicateAt ||
              r.lastDuplicateAt.getTime() > prevClient.lastDuplicateAt.getTime())
              ? r.lastDuplicateAt
              : prevClient.lastDuplicateAt;
          clientMap.set(cKey, {
            clientIdentifier: clientId,
            scope: r.scope,
            scopeTarget: r.scopeTarget,
            uniqueKeys: prevClient.uniqueKeys + 1,
            duplicateHits: prevClient.duplicateHits + r.duplicateHits,
            conflictHits: prevClient.conflictHits + r.conflictHits,
            lastDuplicateAt: latestDup,
          });
        }
      }

      const clientRows = [...clientMap.values()].sort(
        (a, b) => b.duplicateHits + b.conflictHits - (a.duplicateHits + a.conflictHits),
      );

      return {
        activeKeysCount,
        expiredPendingPurgeCount,
        scopeRows: [...scopeMap.values()],
        clientRows,
      };
    },
  } as unknown as IdempotencyRecordRepository;

  const settingRegistry = new SettingRegistryService();
  const idempotencyRegistry = new IdempotencyRegistryService();
  const auditRecords: Record<string, unknown>[] = [];
  const auditLogService = {
    record: jest.fn(async (entry: Record<string, unknown>) => {
      auditRecords.push(entry);
    }),
  } as unknown as AuditLogService;

  const storeService = new IdempotencyStoreService(repo, settingRegistry);
  const service = new IdempotencyService(
    repo,
    storeService,
    idempotencyRegistry,
    settingRegistry,
    auditLogService,
  );
  service.onModuleInit();

  return {
    rows,
    repo,
    settingRegistry,
    idempotencyRegistry,
    storeService,
    service,
    auditLogService,
    auditRecords,
  };
}

class DemoWorkerProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(DemoWorkerProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_EVENTS;
  public executedPayloads: unknown[] = [];
  public nextError: Error | null = null;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    idempotencyRegistry: IdempotencyRegistryService,
  ) {
    super(config, metrics, undefined, idempotencyRegistry);
  }

  public get concurrency(): number {
    return 1;
  }

  protected async handle(envelope: MessageEnvelope): Promise<unknown> {
    this.executedPayloads.push(envelope.payload);
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    return { processed: true, orderId: (envelope.payload as { orderId?: string })?.orderId };
  }
}

function createHttpExecutionContext(params: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  user?: { id?: number; clientId?: string };
  options?: IdempotentOptions;
}) {
  const responseHeaders: Record<string, string> = {};
  const reply = {
    statusCode: HTTP_STATUS_CODE.CREATED as number,
    header: jest.fn((k: string, v: string) => {
      responseHeaders[k] = v;
      return reply;
    }),
    status: jest.fn((code: number) => {
      reply.statusCode = code;
      return reply;
    }),
  };

  const request = {
    id: `req_${Math.random().toString(36).slice(2, 10)}`,
    method: params.method ?? 'POST',
    url: params.url ?? '/api/v1/users',
    routeOptions: { url: params.url ?? '/api/v1/users' },
    headers: params.headers ?? {},
    params: {},
    query: params.query ?? {},
    body: params.body ?? {},
    ip: '10.0.0.15',
    user: params.user ?? { id: 7 },
  };

  const handlerFn = () => undefined;
  class DummyController {}
  if (params.options !== undefined) {
    Reflect.defineMetadata(IDEMPOTENCY_METADATA_KEY, params.options, handlerFn);
  }

  const context = {
    getType: () => 'http',
    getHandler: () => handlerFn,
    getClass: () => DummyController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;

  return { context, request, reply, responseHeaders };
}

describe('Phase 11.3 — Idempotency Core, API, Job, Webhook, Event Inbox & Metrics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('computes deterministic SHA-256 fingerprints regardless of key order and redacts sensitive fields', () => {
    const fp1 = computeIdempotencyFingerprint({ b: 2, a: { z: true, y: 'hello' } });
    const fp2 = computeIdempotencyFingerprint({ a: { y: 'hello', z: true }, b: 2 });
    const fp3 = computeIdempotencyFingerprint({ a: { y: 'changed', z: true }, b: 2 });

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1).toHaveLength(64);

    expect(normalizeIdempotencyKey('  key-123  ')).toBe('key-123');
    expect(normalizeIdempotencyKey('')).toBeNull();
    expect(normalizeIdempotencyKey('bad\u0000key')).toBeNull();
    expect(normalizeIdempotencyKey('a'.repeat(IDEMPOTENCY_DEFAULTS.MAX_KEY_LENGTH + 1))).toBeNull();

    const redacted = redactIdempotencyResponsePayload({
      id: 1,
      passwordHash: 'secret-hash',
      nested: { accessToken: 'tok-123', email: 'a@b.com' },
    }) as Record<string, unknown>;
    expect(redacted['passwordHash']).toBe('[REDACTED]');
    expect((redacted['nested'] as Record<string, unknown>)['accessToken']).toBe('[REDACTED]');
    expect((redacted['nested'] as Record<string, unknown>)['email']).toBe('a@b.com');
  });

  it('prevents duplicate HTTP API creation, replays stored response, and rejects mismatched payload with 409', async () => {
    const fx = createIdempotencyFixture();
    const interceptor = new IdempotencyInterceptor(new Reflector(), fx.idempotencyRegistry);

    let executions = 0;
    const callHandler: CallHandler = {
      handle: () => {
        executions += 1;
        return of({ id: 101, email: 'alice@example.com', accessToken: 'should-redact' });
      },
    };

    // 1. Lần gọi đầu tiên — tạo mới và lưu phản hồi
    const first = createHttpExecutionContext({
      headers: { 'idempotency-key': 'create-user-001' },
      body: { email: 'alice@example.com', fullName: 'Alice' },
      options: { scopeTarget: 'POST /api/v1/users', required: false },
    });
    const res1 = await firstValueFrom(interceptor.intercept(first.context, callHandler));
    expect(executions).toBe(1);
    expect(res1).toEqual({ id: 101, email: 'alice@example.com', accessToken: 'should-redact' });

    // 2. Gọi lại cùng Idempotency-Key & cùng dữ liệu (dù khác thứ tự key JSON) → replay không chạy lại handler
    const second = createHttpExecutionContext({
      headers: { 'idempotency-key': 'create-user-001' },
      body: { fullName: 'Alice', email: 'alice@example.com' },
      options: { scopeTarget: 'POST /api/v1/users', required: false },
    });
    const res2 = await firstValueFrom(interceptor.intercept(second.context, callHandler));
    expect(executions).toBe(1);
    expect(second.responseHeaders[IDEMPOTENCY_DEFAULTS.REPLAYED_HEADER_NAME]).toBe('true');
    expect(second.reply.statusCode).toBe(HTTP_STATUS_CODE.CREATED);
    expect(res2).toEqual({ id: 101, email: 'alice@example.com', accessToken: '[REDACTED]' });

    // 3. Gọi lại cùng Idempotency-Key nhưng KHÁC dữ liệu → trả lỗi 409 IDEMPOTENCY_PAYLOAD_MISMATCH
    const mismatch = createHttpExecutionContext({
      headers: { 'idempotency-key': 'create-user-001' },
      body: { email: 'bob@example.com', fullName: 'Bob' },
      options: { scopeTarget: 'POST /api/v1/users', required: false },
    });
    await expect(
      firstValueFrom(interceptor.intercept(mismatch.context, callHandler)),
    ).rejects.toMatchObject({
      statusCode: HTTP_STATUS_CODE.CONFLICT,
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
    });
    expect(executions).toBe(1);

    // 4. Endpoint yêu cầu bắt buộc key (`required: true`) nhưng thiếu header → 400 IDEMPOTENCY_KEY_REQUIRED
    const missingReq = createHttpExecutionContext({
      headers: {},
      body: { email: 'c@example.com' },
      options: { required: true },
    });
    await expect(
      firstValueFrom(interceptor.intercept(missingReq.context, callHandler)),
    ).rejects.toBeInstanceOf(IdempotencyKeyRequiredException);

    // 5. Khi xử lý lỗi → đánh dấu FAILED để retry hợp lệ với cùng key chạy lại được
    const failCtx = createHttpExecutionContext({
      headers: { 'idempotency-key': 'retryable-key' },
      body: { email: 'retry@example.com' },
      options: { scopeTarget: 'POST /api/v1/users' },
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(failCtx.context, {
          handle: () => throwError(() => new Error('Temporary DB outage')),
        }),
      ),
    ).rejects.toThrow('Temporary DB outage');

    const retryRes = await firstValueFrom(interceptor.intercept(failCtx.context, callHandler));
    expect(executions).toBe(2);
    expect((retryRes as { id: number }).id).toBe(101);
  });

  it('rejects concurrent in-flight API request with 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const fx = createIdempotencyFixture();
    const fp = computeIdempotencyFingerprint({
      method: 'POST',
      scopeTarget: 'POST /api/v1/orders',
      params: {},
      body: { amount: 500 },
      query: {},
    });

    // Giả lập request 1 đang giữ khóa IN_PROGRESS
    const lock1 = await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/orders',
      idempotencyKey: 'order-race-1',
      requestFingerprint: fp,
      lockOwner: 'req-1',
      clientIdentifier: 'user:7',
    });
    expect(lock1.outcome).toBe(IDEMPOTENCY_OUTCOME.ACQUIRED);

    const interceptor = new IdempotencyInterceptor(new Reflector(), fx.idempotencyRegistry);
    const concurrentCtx = createHttpExecutionContext({
      url: '/api/v1/orders',
      headers: { 'idempotency-key': 'order-race-1' },
      body: { amount: 500 },
      options: { scopeTarget: 'POST /api/v1/orders' },
    });

    await expect(
      firstValueFrom(
        interceptor.intercept(concurrentCtx.context, { handle: () => of({ ok: true }) }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyInProgressException);
  });

  it('prevents duplicate Background Job execution by business key while allowing same-job retry and rejecting payload mismatch', async () => {
    const fx = createIdempotencyFixture();
    const config = new CoreConfigService();
    const metrics = new MetricsRegistryService({ runtime: 'worker' });
    const processor = new DemoWorkerProcessor(config, metrics, fx.idempotencyRegistry);

    const buildJob = (id: string, payload: unknown, businessKey: string, attemptsMade = 0) => {
      const envelope = serializeMessage('orders.invoice.generate', payload, {
        producer: 'api',
        correlationId: `corr-${id}`,
        job: {
          source: { kind: 'http', id: 'req-1', name: 'POST /orders', detail: null },
          requestId: 'req-1',
          idempotencyKey: businessKey,
          index: {},
          schema: null,
        },
      });
      return {
        id,
        name: 'orders.invoice.generate',
        queueName: QUEUES.SYSTEM_EVENTS,
        data: envelope,
        opts: { attempts: 3 },
        attemptsMade,
        attemptsStarted: attemptsMade + 1,
        timestamp: Date.now(),
        log: jest.fn(async () => 0),
      } as unknown as Job;
    };

    // 1. Job lỗi tạm ở lần chạy đầu → đánh dấu FAILED; retry cùng jobId chạy lại thành công
    processor.nextError = new Error('Transient SMTP failure');
    const job1 = buildJob('job-100', { orderId: 'ORD-9' }, 'invoice:ORD-9', 0);
    await expect(processor.process(job1)).rejects.toThrow('Transient SMTP failure');

    const job1Retry = buildJob('job-100', { orderId: 'ORD-9' }, 'invoice:ORD-9', 1);
    const firstSuccess = await processor.process(job1Retry);
    expect(firstSuccess).toEqual({ processed: true, orderId: 'ORD-9' });
    expect(processor.executedPayloads).toHaveLength(2);

    // 2. Job MỚI (job-200) nhưng trùng business key + cùng payload → skip an toàn, không chạy lại handle()
    const jobDuplicate = buildJob('job-200', { orderId: 'ORD-9' }, 'invoice:ORD-9', 0);
    const dupResult = await processor.process(jobDuplicate);
    expect(dupResult).toMatchObject({
      skipped: true,
      duplicate: true,
      reason: 'idempotent_duplicate',
      idempotencyKey: 'invoice:ORD-9',
      previousResult: { processed: true, orderId: 'ORD-9' },
    });
    expect(processor.executedPayloads).toHaveLength(2);

    // 3. Job MỚI (job-300) cùng business key nhưng KHÁC payload → ném UnrecoverableError (không retry)
    const jobMismatch = buildJob('job-300', { orderId: 'ORD-DIFFERENT' }, 'invoice:ORD-9', 0);
    await expect(processor.process(jobMismatch)).rejects.toThrow(/IDEMPOTENCY_PAYLOAD_MISMATCH/);
    expect(processor.executedPayloads).toHaveLength(2);
  });

  it('guards Webhook deduplication by provider Event ID and records external webhook observations', async () => {
    const fx = createIdempotencyFixture();
    let handlerRuns = 0;

    const first = await fx.idempotencyRegistry.guardWebhook({
      providerCode: 'stripe',
      externalEventId: 'evt_stripe_001',
      payload: { type: 'payment_intent.succeeded', amount: 120000 },
      run: async () => {
        handlerRuns += 1;
        return { settled: true };
      },
    });
    expect(first.duplicate).toBe(false);
    expect(first.result).toEqual({ settled: true });

    const dup = await fx.idempotencyRegistry.guardWebhook({
      providerCode: 'stripe',
      externalEventId: 'evt_stripe_001',
      payload: { amount: 120000, type: 'payment_intent.succeeded' },
      run: async () => {
        handlerRuns += 1;
        return { settled: false };
      },
    });
    expect(dup.duplicate).toBe(true);
    expect(dup.result).toEqual({ settled: true });
    expect(handlerRuns).toBe(1);

    await expect(
      fx.idempotencyRegistry.guardWebhook({
        providerCode: 'stripe',
        externalEventId: 'evt_stripe_001',
        payload: { type: 'payment_intent.succeeded', amount: 999999 },
        run: async () => ({ settled: false }),
      }),
    ).rejects.toBeInstanceOf(IdempotencyPayloadMismatchException);

    // Đồng bộ quan sát ngoài từ InboundWebhooksReceiveService
    await fx.idempotencyRegistry.recordExternalObservation({
      scope: IDEMPOTENCY_SCOPE.WEBHOOK,
      scopeTarget: 'github',
      idempotencyKey: 'gh_evt_1',
      requestFingerprint: 'hash_abc',
      outcome: 'CREATED',
      clientIdentifier: 'provider:github',
    });
    await fx.idempotencyRegistry.recordExternalObservation({
      scope: IDEMPOTENCY_SCOPE.WEBHOOK,
      scopeTarget: 'github',
      idempotencyKey: 'gh_evt_1',
      requestFingerprint: 'hash_abc',
      outcome: 'DUPLICATE',
      clientIdentifier: 'provider:github',
    });

    const metrics = await fx.service.getMetrics(24);
    const webhookScope = metrics.byScope.find((s) => s.scope === IDEMPOTENCY_SCOPE.WEBHOOK);
    expect(webhookScope?.uniqueKeys).toBe(2);
    expect(webhookScope?.duplicateHits).toBe(2);
    expect(webhookScope?.conflictHits).toBe(1);
  });

  it('deduplicates Domain Event handlers via Event Inbox (skips completed handlers on replay, retries failed handlers, detects payload mismatch)', async () => {
    const fx = createIdempotencyFixture();
    const bus = new DomainEventBusService(fx.idempotencyRegistry);

    let auditRuns = 0;
    let billingRuns = 0;
    let shouldFailBilling = true;

    bus.registerHandler({
      id: 'audit.user_created',
      module: 'audit',
      eventPattern: 'UserCreated',
      criticality: DOMAIN_EVENT_CRITICALITY.REQUIRED,
      idempotent: true,
      handler: async () => {
        auditRuns += 1;
      },
    });

    bus.registerHandler({
      id: 'billing.user_created',
      module: 'billing',
      eventPattern: 'UserCreated',
      criticality: DOMAIN_EVENT_CRITICALITY.REQUIRED,
      idempotent: true,
      handler: async () => {
        billingRuns += 1;
        if (shouldFailBilling) {
          shouldFailBilling = false;
          throw new Error('Billing service temporarily unavailable');
        }
      },
    });

    const eventInput = {
      id: 'evt-user-created-777',
      type: 'UserCreated',
      sourceModule: 'users',
      aggregateType: 'User',
      aggregateId: '777',
      payload: { userId: 777, email: 'inbox@example.com' },
    };

    // Lần 1: handler 1 thành công (đã lưu Inbox), handler 2 lỗi → ném DomainEventRequiredHandlerException
    await expect(bus.publish(eventInput)).rejects.toBeInstanceOf(
      DomainEventRequiredHandlerException,
    );
    expect(auditRuns).toBe(1);
    expect(billingRuns).toBe(1);

    // Lần 2 (Outbox retry): handler 1 bị SKIP do đã có trong Inbox, chỉ handler 2 chạy lại và thành công!
    const report2 = await bus.publish(eventInput, {
      enforceIdempotency: true,
      clientIdentifier: 'outbox:relay',
    });
    expect(auditRuns).toBe(1);
    expect(billingRuns).toBe(2);
    expect(report2.skippedDuplicateCount).toBe(1);
    expect(report2.succeededCount).toBe(1);

    // Lần 3 (duplicate delivery): cả 2 handler đều bị skip
    const report3 = await bus.publish(eventInput, { enforceIdempotency: true });
    expect(auditRuns).toBe(1);
    expect(billingRuns).toBe(2);
    expect(report3.skippedDuplicateCount).toBe(2);
    expect(report3.succeededCount).toBe(0);

    // Lần 4 (cùng eventId nhưng payload bị đổi) → lỗi xung đột payload!
    await expect(
      bus.publish({
        ...eventInput,
        payload: { userId: 777, email: 'tampered@example.com' },
      }),
    ).rejects.toBeInstanceOf(DomainEventRequiredHandlerException);
  });

  it('applies per-flow TTL overrides, replaces expired keys automatically, and supports manual revoke + scheduled purge', async () => {
    const fx = createIdempotencyFixture();
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.API_TTL_SEC, 3600);
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.EVENT_TTL_SEC, 86400);
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.FLOW_TTL_OVERRIDES, {
      'API:POST /api/v1/users': 120,
      'EVENT:audit.user_created': 600,
    });

    const cfg = resolveIdempotencyRuntimeConfig(fx.settingRegistry);
    expect(
      resolveEffectiveIdempotencyTtlSec(cfg, IDEMPOTENCY_SCOPE.API, 'POST /api/v1/users', 999),
    ).toBe(120);
    expect(
      resolveEffectiveIdempotencyTtlSec(cfg, IDEMPOTENCY_SCOPE.API, 'POST /api/v1/other', 999),
    ).toBe(999);
    expect(
      resolveEffectiveIdempotencyTtlSec(cfg, IDEMPOTENCY_SCOPE.API, 'POST /api/v1/other'),
    ).toBe(3600);
    expect(
      resolveEffectiveIdempotencyTtlSec(cfg, IDEMPOTENCY_SCOPE.EVENT, 'audit.user_created'),
    ).toBe(600);

    const t0 = new Date(Date.now() - 3_600_000);
    const acq1 = await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'expiring-key',
      requestFingerprint: computeIdempotencyFingerprint({ step: 1 }),
      now: t0,
    });
    expect(acq1.outcome).toBe(IDEMPOTENCY_OUTCOME.ACQUIRED);
    expect(acq1.expiresAt).toBe(new Date(t0.getTime() + 120_000).toISOString());
    await fx.idempotencyRegistry.complete({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'expiring-key',
      recordId: acq1.recordId,
      statusCode: 201,
      responseBody: { step: 1 },
      now: t0,
    });

    // Sau khi vượt quá TTL (t0 + 121s), key cũ tự được thay thế cho dữ liệu mới
    const tExpired = new Date(t0.getTime() + 121_000);
    const acqAfterExpiry = await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'expiring-key',
      requestFingerprint: computeIdempotencyFingerprint({ step: 2 }),
      now: tExpired,
    });
    expect(acqAfterExpiry.outcome).toBe(IDEMPOTENCY_OUTCOME.ACQUIRED);

    // Tạo thêm 1 bản ghi hết hạn rồi chạy cleanup qua SystemProcessor
    await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.JOB,
      scopeTarget: 'system.events:demo',
      idempotencyKey: 'old-job-key',
      requestFingerprint: 'fp-old',
      ttlSec: 60,
      now: t0,
    });
    const sysProcessor = new SystemProcessor(
      new CoreConfigService(),
      new MetricsRegistryService({ runtime: 'worker' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fx.service,
    );
    const cleanupJob = {
      id: 'cleanup-1',
      name: IDEMPOTENCY_QUEUE_TOPICS.CLEANUP_TICK,
      queueName: QUEUES.SYSTEM_EVENTS,
      data: serializeMessage(IDEMPOTENCY_QUEUE_TOPICS.CLEANUP_TICK, { triggeredBy: 'scheduler' }),
      opts: { attempts: 1 },
      attemptsMade: 0,
      attemptsStarted: 1,
      timestamp: Date.now(),
      log: jest.fn(async () => 0),
    } as unknown as Job;
    const cleanupRes = (await sysProcessor.process(cleanupJob)) as { purgedCount: number };
    expect(cleanupRes.purgedCount).toBe(2);

    // Kiểm tra revoke thủ công có Audit Log
    const fresh = await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'revoke-me',
      requestFingerprint: 'fp-revoke',
    });
    const actor = { id: 1, email: 'admin@core.local' } as unknown as UserIdentity;
    const revoked = await fx.service.revokeRecord(fresh.recordId!, 'Admin unblock client', actor);
    expect(revoked.revoked).toBe(true);
    expect(fx.auditRecords.some((a) => a['action'] === 'REVOKE')).toBe(true);
  });

  it('tracks duplicate rate and detects suspicious repeated clients accurately', async () => {
    const fx = createIdempotencyFixture();
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.DUPLICATE_RATE_WARN_PERCENT, 20);
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.CLIENT_REPEAT_WARN_HITS, 3);
    fx.settingRegistry.setGlobalValue(IDEMPOTENCY_SETTING_KEYS.CLIENT_REPEAT_CRIT_HITS, 6);

    const fp = computeIdempotencyFingerprint({ amount: 100 });
    const acq = await fx.idempotencyRegistry.acquire({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'spam-key-1',
      requestFingerprint: fp,
      clientIdentifier: 'client:mobile-app-v1',
    });
    await fx.idempotencyRegistry.complete({
      scope: IDEMPOTENCY_SCOPE.API,
      scopeTarget: 'POST /api/v1/users',
      idempotencyKey: 'spam-key-1',
      recordId: acq.recordId,
      statusCode: 201,
      responseBody: { ok: true },
    });

    // Giả lập client gửi lặp 7 lần liên tiếp
    for (let i = 0; i < 7; i++) {
      const replay = await fx.idempotencyRegistry.acquire({
        scope: IDEMPOTENCY_SCOPE.API,
        scopeTarget: 'POST /api/v1/users',
        idempotencyKey: 'spam-key-1',
        requestFingerprint: fp,
        clientIdentifier: 'client:mobile-app-v1',
      });
      expect(replay.outcome).toBe(IDEMPOTENCY_OUTCOME.REPLAYED);
    }

    const metrics = await fx.service.getMetrics(24);
    expect(metrics.totalUniqueKeys).toBe(1);
    expect(metrics.totalDuplicateHits).toBe(7);
    expect(metrics.totalRequests).toBe(8);
    expect(metrics.duplicateRatePercent).toBe(87.5);
    expect(metrics.alertStatus).toBe(IDEMPOTENCY_ALERT_STATUS.CRITICAL);
    expect(metrics.topRepeatedClients).toHaveLength(1);
    expect(metrics.topRepeatedClients[0]).toMatchObject({
      clientIdentifier: 'client:mobile-app-v1',
      scope: IDEMPOTENCY_SCOPE.API,
      duplicateHits: 7,
      suspicious: true,
      severity: IDEMPOTENCY_ALERT_STATUS.CRITICAL,
    });
  });

  it('wires RBAC permissions on IdempotencyController, pilot @Idempotent on UsersController.create, and Event Inbox on SystemProcessor outbox.domain_event', async () => {
    const reflector = new Reflector();
    expect(
      reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, IdempotencyController.prototype.getMetrics),
    ).toEqual(['idempotency.read']);
    expect(
      reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, IdempotencyController.prototype.listRecords),
    ).toEqual(['idempotency.read']);
    expect(
      reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, IdempotencyController.prototype.revokeRecord),
    ).toEqual(['idempotency.manage']);
    expect(
      reflector.get<string[]>(REQUIRED_PERMISSIONS_KEY, IdempotencyController.prototype.purgeExpired),
    ).toEqual(['idempotency.manage']);

    const pilotMeta = reflector.get<IdempotentOptions>(
      IDEMPOTENCY_METADATA_KEY,
      UsersController.prototype.create,
    );
    expect(pilotMeta).toEqual({ scopeTarget: 'POST /api/v1/users', required: false });

    // Kiểm tra SystemProcessor phát `outbox.domain_event` bật sẵn enforceIdempotency (Event Inbox)
    const fx = createIdempotencyFixture();
    const bus = new DomainEventBusService(fx.idempotencyRegistry);
    let handlerCount = 0;
    bus.registerHandler({
      id: 'webhooks.bridge',
      module: 'webhooks',
      eventPattern: 'UserCreated',
      handler: async () => {
        handlerCount += 1;
      },
    });
    const sysProcessor = new SystemProcessor(
      new CoreConfigService(),
      new MetricsRegistryService({ runtime: 'worker' }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      bus,
      fx.service,
    );
    const domainEvent = bus.resolveEvent({
      id: 'evt-outbox-999',
      type: 'UserCreated',
      sourceModule: 'users',
      payload: { userId: 999 },
    });

    const jobA = {
      id: 'outbox-job-1',
      name: OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT,
      queueName: QUEUES.SYSTEM_EVENTS,
      data: serializeMessage(OUTBOX_QUEUE_TOPICS.DOMAIN_EVENT, {
        outboxId: 1,
        event: domainEvent,
      }),
      opts: { attempts: 3 },
      attemptsMade: 0,
      attemptsStarted: 1,
      timestamp: Date.now(),
      log: jest.fn(async () => 0),
    } as unknown as Job;

    const jobB = {
      ...jobA,
      id: 'outbox-job-2',
    } as unknown as Job;

    const resA = (await sysProcessor.process(jobA)) as {
      succeededCount: number;
      skippedDuplicateCount: number;
    };
    const resB = (await sysProcessor.process(jobB)) as {
      succeededCount: number;
      skippedDuplicateCount: number;
    };
    expect(handlerCount).toBe(1);
    expect(resA.succeededCount).toBe(1);
    expect(resA.skippedDuplicateCount).toBe(0);
    expect(resB.succeededCount).toBe(0);
    expect(resB.skippedDuplicateCount).toBe(1);
  });
});
