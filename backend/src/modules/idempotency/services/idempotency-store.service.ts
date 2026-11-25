import { Injectable, Optional } from '@nestjs/common';
import type { Counter } from 'prom-client';
import {
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_OUTCOME,
  IDEMPOTENCY_STATUS,
  SettingRegistryService,
  defaultSettingRegistry,
  normalizeIdempotencyScopeTarget,
  redactIdempotencyResponsePayload,
  safeJsonParse,
  safeJsonParseObject,
  type IIdempotencyStoreDelegate,
  type IdempotencyAcquireInput,
  type IdempotencyAcquireResult,
  type IdempotencyCompleteInput,
  type IdempotencyFailInput,
  type IdempotencyMetricsSnapshot,
  type IdempotencyRecordExternalInput,
  type IdempotencyScope,
  type IdempotencyStoredResponse,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import type { IdempotencyRecordEntity } from '../entities/idempotency-record.entity.js';
import {
  resolveEffectiveIdempotencyTtlSec,
  resolveIdempotencyRuntimeConfig,
} from '../helpers/idempotency-config.helper.js';
import { evaluateIdempotencyMetricsSnapshot } from '../helpers/idempotency-metrics.helper.js';
import { IdempotencyRecordRepository } from '../repositories/idempotency-record.repository.js';

type MetricOutcome = 'created' | 'replayed' | 'conflict' | 'in_progress' | 'expired_replaced';

function serializeResponseBody(body: unknown, maxBytes: number): string | null {
  if (body === undefined || body === null) return null;
  const redacted = redactIdempotencyResponsePayload(body);
  try {
    const serialized = JSON.stringify(redacted);
    if (!serialized) return null;
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      return JSON.stringify({
        idempotentReplayed: true,
        responseTruncated: true,
        maxResponseBytes: maxBytes,
      });
    }
    return serialized;
  } catch {
    return null;
  }
}

function serializeHeaders(headers?: Record<string, string>): string | null {
  if (!headers || Object.keys(headers).length === 0) return null;
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie') continue;
    safe[k] = String(v).slice(0, 500);
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : null;
}

function parseStoredResponse(entity: IdempotencyRecordEntity): IdempotencyStoredResponse {
  return {
    statusCode: entity.responseStatusCode ?? null,
    body: entity.responseBodyJson ? safeJsonParse<unknown>(entity.responseBodyJson, null) : null,
    headers: entity.responseHeadersJson
      ? safeJsonParseObject<Record<string, string>>(entity.responseHeadersJson, {})
      : {},
  };
}

/**
 * Bộ máy xử lý khóa chống trùng nguyên tử trên Database (Phase 11.3):
 * - Đảm bảo an toàn đa tiến trình (multi-instance API/Worker) thông qua `UNIQUE(scope, scope_target, idempotency_key)`
 *   kết hợp cập nhật có điều kiện (`tryReclaimRecord`) khi hết hạn TTL, lỗi trước đó hoặc lease bị treo.
 * - Phát hiện chính xác trường hợp cùng key nhưng khác dữ liệu (`PAYLOAD_MISMATCH`).
 * - Ghi nhận bộ đếm Prometheus `idempotency_checks_total{scope,outcome}` phục vụ giám sát tỷ lệ trùng.
 */
@Injectable()
export class IdempotencyStoreService implements IIdempotencyStoreDelegate {
  private readonly settingRegistry: SettingRegistryService;
  private readonly checksCounter: Counter<'scope' | 'outcome'> | undefined;

  constructor(
    private readonly recordRepo: IdempotencyRecordRepository,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() metrics?: MetricsRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.checksCounter = metrics?.counter(
      'idempotency_checks_total',
      'Total idempotency lock checks grouped by scope and outcome',
      ['scope', 'outcome'],
    );
  }

  public async acquire(input: IdempotencyAcquireInput): Promise<IdempotencyAcquireResult> {
    const now = input.now ?? new Date();
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);
    const config = resolveIdempotencyRuntimeConfig(this.settingRegistry);
    const ttlSec = resolveEffectiveIdempotencyTtlSec(config, input.scope, scopeTarget, input.ttlSec);
    const leaseSec =
      input.leaseSec && input.leaseSec > 0 ? Math.round(input.leaseSec) : config.lockLeaseSec;
    const expiresAt = new Date(now.getTime() + ttlSec * 1000);
    const lockedUntil = new Date(now.getTime() + leaseSec * 1000);
    const lockOwner = input.lockOwner?.trim().slice(0, 160) || null;
    const clientIdentifier = input.clientIdentifier?.trim().slice(0, 160) || null;
    const correlationId = input.correlationId?.trim().slice(0, 120) || null;

    if (!this.recordRepo.isDatabaseReady()) {
      return {
        outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
        recordId: null,
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        storedFingerprint: null,
        response: null,
        duplicateHits: 0,
        conflictHits: 0,
        lockOwner,
        expiresAt: expiresAt.toISOString(),
        persisted: false,
      };
    }

    const inserted = await this.recordRepo.tryInsertRecord({
      scope: input.scope,
      scopeTarget,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      status: IDEMPOTENCY_STATUS.IN_PROGRESS,
      lockOwner,
      lockedUntil,
      clientIdentifier,
      correlationId,
      expiresAt,
    });

    if (inserted.inserted) {
      this.recordMetric(input.scope, 'created');
      return {
        outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
        recordId: Number(inserted.entity.id),
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        storedFingerprint: inserted.entity.requestFingerprint,
        response: null,
        duplicateHits: 0,
        conflictHits: 0,
        lockOwner,
        expiresAt: expiresAt.toISOString(),
        persisted: true,
      };
    }

    return this.resolveExistingCollision({
      input,
      scopeTarget,
      now,
      expiresAt,
      lockedUntil,
      lockOwner,
      clientIdentifier,
      correlationId,
      allowReattempt: true,
    });
  }

  public async complete(input: IdempotencyCompleteInput): Promise<void> {
    if (!this.recordRepo.isDatabaseReady()) return;
    const config = resolveIdempotencyRuntimeConfig(this.settingRegistry);
    const now = input.now ?? new Date();
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);

    await this.recordRepo.markCompleted({
      id: input.recordId,
      scope: input.scope,
      scopeTarget,
      idempotencyKey: input.idempotencyKey,
      statusCode: input.statusCode ?? null,
      responseBodyJson: serializeResponseBody(input.responseBody, config.maxResponseBytes),
      responseHeadersJson: serializeHeaders(input.responseHeaders),
      now,
    });
  }

  public async fail(input: IdempotencyFailInput): Promise<void> {
    if (!this.recordRepo.isDatabaseReady()) return;
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);
    await this.recordRepo.markFailed({
      id: input.recordId,
      scope: input.scope,
      scopeTarget,
      idempotencyKey: input.idempotencyKey,
      errorCode: input.errorCode ?? 'EXECUTION_FAILED',
      errorMessage: input.errorMessage ?? null,
    });
  }

  /**
   * Ghi nhận quan sát từ các module đã tự quản lý bảng idempotency riêng (`inbound-webhooks`, `payments`)
   * để thống nhất số liệu tỷ lệ trùng, xung đột payload và phát hiện client/provider gửi lặp trên cùng 1 kho.
   */
  public async recordExternalObservation(input: IdempotencyRecordExternalInput): Promise<void> {
    if (!this.recordRepo.isDatabaseReady()) return;

    const now = input.now ?? new Date();
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);
    const config = resolveIdempotencyRuntimeConfig(this.settingRegistry);
    const ttlSec = resolveEffectiveIdempotencyTtlSec(config, input.scope, scopeTarget, input.ttlSec);
    const expiresAt = new Date(now.getTime() + ttlSec * 1000);
    const clientIdentifier = input.clientIdentifier?.trim().slice(0, 160) || null;
    const correlationId = input.correlationId?.trim().slice(0, 120) || null;

    const existing = await this.recordRepo.findByScopeAndKey(
      input.scope,
      scopeTarget,
      input.idempotencyKey,
    );

    if (!existing) {
      const inserted = await this.recordRepo.tryInsertRecord({
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        status: IDEMPOTENCY_STATUS.COMPLETED,
        responseStatusCode: input.statusCode ?? 200,
        responseBodyJson: serializeResponseBody(input.responseBody, config.maxResponseBytes),
        responseHeadersJson: null,
        lockOwner: null,
        lockedUntil: null,
        clientIdentifier,
        correlationId,
        completedAt: now,
        expiresAt,
      });

      if (inserted.inserted) {
        if (input.outcome === 'DUPLICATE') {
          await this.recordRepo.incrementDuplicateHit(Number(inserted.entity.id), now);
          this.recordMetric(input.scope, 'replayed');
        } else if (input.outcome === 'PAYLOAD_MISMATCH') {
          await this.recordRepo.incrementConflictHit(
            Number(inserted.entity.id),
            now,
            input.errorMessage ?? 'Payload fingerprint mismatch',
          );
          this.recordMetric(input.scope, 'conflict');
        } else {
          this.recordMetric(input.scope, 'created');
        }
        return;
      }

      const raced = await this.recordRepo.findByScopeAndKey(
        input.scope,
        scopeTarget,
        input.idempotencyKey,
      );
      if (!raced) return;
      if (input.outcome === 'PAYLOAD_MISMATCH') {
        await this.recordRepo.incrementConflictHit(
          Number(raced.id),
          now,
          input.errorMessage ?? 'Payload fingerprint mismatch',
        );
        this.recordMetric(input.scope, 'conflict');
      } else {
        await this.recordRepo.incrementDuplicateHit(Number(raced.id), now);
        this.recordMetric(input.scope, 'replayed');
      }
      return;
    }

    if (input.outcome === 'PAYLOAD_MISMATCH') {
      await this.recordRepo.incrementConflictHit(
        Number(existing.id),
        now,
        input.errorMessage ?? 'Payload fingerprint mismatch',
      );
      this.recordMetric(input.scope, 'conflict');
      return;
    }

    if (input.outcome === 'DUPLICATE') {
      await this.recordRepo.incrementDuplicateHit(Number(existing.id), now);
      this.recordMetric(input.scope, 'replayed');
      return;
    }

    this.recordMetric(input.scope, 'created');
  }

  public async getMetricsSnapshot(
    windowHours: number = IDEMPOTENCY_DEFAULTS.DEFAULT_METRICS_WINDOW_HOURS,
  ): Promise<IdempotencyMetricsSnapshot> {
    const safeWindowHours = Math.max(1, Math.min(720, Math.round(windowHours)));
    const now = new Date();
    const windowStart = new Date(now.getTime() - safeWindowHours * 3_600_000);
    const config = resolveIdempotencyRuntimeConfig(this.settingRegistry);
    const raw = await this.recordRepo.collectMetricsRaw(windowStart, now);
    return evaluateIdempotencyMetricsSnapshot(raw, config, safeWindowHours, now);
  }

  private async resolveExistingCollision(params: {
    readonly input: IdempotencyAcquireInput;
    readonly scopeTarget: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly lockedUntil: Date;
    readonly lockOwner: string | null;
    readonly clientIdentifier: string | null;
    readonly correlationId: string | null;
    readonly allowReattempt: boolean;
  }): Promise<IdempotencyAcquireResult> {
    const { input, scopeTarget, now } = params;
    const existing = await this.recordRepo.findByScopeAndKey(
      input.scope,
      scopeTarget,
      input.idempotencyKey,
    );

    if (!existing) {
      if (params.allowReattempt) {
        return this.acquire({ ...input, scopeTarget, now });
      }
      this.recordMetric(input.scope, 'in_progress');
      return {
        outcome: IDEMPOTENCY_OUTCOME.IN_PROGRESS,
        recordId: null,
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        storedFingerprint: null,
        response: null,
        duplicateHits: 0,
        conflictHits: 0,
        lockOwner: null,
        expiresAt: params.expiresAt.toISOString(),
        persisted: true,
      };
    }

    const existingId = Number(existing.id);
    const existingExpiresAt =
      existing.expiresAt instanceof Date ? existing.expiresAt : new Date(existing.expiresAt);
    const isExpired =
      !Number.isNaN(existingExpiresAt.getTime()) && existingExpiresAt.getTime() <= now.getTime();

    // 1. Khóa cũ đã hết hạn TTL → thay thế nguyên tử để tái sử dụng key sạch sẽ
    if (isExpired) {
      const reclaimed = await this.recordRepo.tryReclaimRecord({
        id: existingId,
        requestFingerprint: input.requestFingerprint,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier,
        correlationId: params.correlationId,
        expiresAt: params.expiresAt,
        now,
        mode: 'EXPIRED',
      });
      if (reclaimed) {
        this.recordMetric(input.scope, 'expired_replaced');
        return {
          outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
          recordId: existingId,
          scope: input.scope,
          scopeTarget,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          storedFingerprint: input.requestFingerprint,
          response: null,
          duplicateHits: 0,
          conflictHits: 0,
          lockOwner: params.lockOwner,
          expiresAt: params.expiresAt.toISOString(),
          persisted: true,
        };
      }
      if (params.allowReattempt) {
        return this.resolveExistingCollision({ ...params, allowReattempt: false });
      }
    }

    // 2. Cùng key nhưng khác dữ liệu đầu vào (fingerprint mismatch) → từ chối rõ ràng 409
    if (existing.requestFingerprint !== input.requestFingerprint) {
      await this.recordRepo.incrementConflictHit(
        existingId,
        now,
        `Fingerprint mismatch for ${input.scope}:${scopeTarget}:${input.idempotencyKey}`,
      );
      this.recordMetric(input.scope, 'conflict');
      return {
        outcome: IDEMPOTENCY_OUTCOME.PAYLOAD_MISMATCH,
        recordId: existingId,
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        storedFingerprint: existing.requestFingerprint,
        response: null,
        duplicateHits: Number(existing.duplicateHits ?? 0),
        conflictHits: Number(existing.conflictHits ?? 0) + 1,
        lockOwner: existing.lockOwner ?? null,
        expiresAt: existingExpiresAt.toISOString(),
        persisted: true,
      };
    }

    // 3. Cùng key + khớp dữ liệu + đã COMPLETED → trả lại kết quả cũ (REPLAYED)
    if (existing.status === IDEMPOTENCY_STATUS.COMPLETED) {
      await this.recordRepo.incrementDuplicateHit(existingId, now);
      this.recordMetric(input.scope, 'replayed');
      return {
        outcome: IDEMPOTENCY_OUTCOME.REPLAYED,
        recordId: existingId,
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        storedFingerprint: existing.requestFingerprint,
        response: parseStoredResponse(existing),
        duplicateHits: Number(existing.duplicateHits ?? 0) + 1,
        conflictHits: Number(existing.conflictHits ?? 0),
        lockOwner: existing.lockOwner ?? null,
        expiresAt: existingExpiresAt.toISOString(),
        persisted: true,
      };
    }

    // 4. Cùng key + khớp dữ liệu + lần trước FAILED → cho phép giành khóa chạy lại
    if (existing.status === IDEMPOTENCY_STATUS.FAILED) {
      const reclaimed = await this.recordRepo.tryReclaimRecord({
        id: existingId,
        requestFingerprint: input.requestFingerprint,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier ?? existing.clientIdentifier,
        correlationId: params.correlationId ?? existing.correlationId,
        expiresAt: params.expiresAt,
        now,
        mode: 'FAILED',
      });
      if (reclaimed) {
        this.recordMetric(input.scope, 'created');
        return {
          outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
          recordId: existingId,
          scope: input.scope,
          scopeTarget,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          storedFingerprint: existing.requestFingerprint,
          response: null,
          duplicateHits: Number(existing.duplicateHits ?? 0),
          conflictHits: Number(existing.conflictHits ?? 0),
          lockOwner: params.lockOwner,
          expiresAt: params.expiresAt.toISOString(),
          persisted: true,
        };
      }
    }

    // 5. Đang IN_PROGRESS: kiểm tra lease hết hạn hoặc retry hợp lệ từ chính lockOwner (vd Job retry cùng jobId)
    const lockedUntilDate =
      existing.lockedUntil instanceof Date
        ? existing.lockedUntil
        : existing.lockedUntil
          ? new Date(existing.lockedUntil)
          : null;
    const isLeaseStale = !lockedUntilDate || lockedUntilDate.getTime() <= now.getTime();
    const isSameOwnerRetry =
      Boolean(input.allowSameOwnerRetry) &&
      Boolean(params.lockOwner) &&
      existing.lockOwner === params.lockOwner;

    if (isLeaseStale || isSameOwnerRetry) {
      const reclaimed = await this.recordRepo.tryReclaimRecord({
        id: existingId,
        requestFingerprint: input.requestFingerprint,
        lockOwner: params.lockOwner,
        lockedUntil: params.lockedUntil,
        clientIdentifier: params.clientIdentifier ?? existing.clientIdentifier,
        correlationId: params.correlationId ?? existing.correlationId,
        expiresAt: params.expiresAt,
        now,
        mode: isSameOwnerRetry ? 'SAME_OWNER' : 'STALE_LEASE',
        expectedLockOwner: params.lockOwner,
      });
      if (reclaimed) {
        this.recordMetric(input.scope, 'created');
        return {
          outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
          recordId: existingId,
          scope: input.scope,
          scopeTarget,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          storedFingerprint: existing.requestFingerprint,
          response: null,
          duplicateHits: Number(existing.duplicateHits ?? 0),
          conflictHits: Number(existing.conflictHits ?? 0),
          lockOwner: params.lockOwner,
          expiresAt: params.expiresAt.toISOString(),
          persisted: true,
        };
      }
    }

    // 6. Thực sự đang có luồng song song khác xử lý cùng key
    await this.recordRepo.incrementDuplicateHit(existingId, now);
    this.recordMetric(input.scope, 'in_progress');
    return {
      outcome: IDEMPOTENCY_OUTCOME.IN_PROGRESS,
      recordId: existingId,
      scope: input.scope,
      scopeTarget,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      storedFingerprint: existing.requestFingerprint,
      response: null,
      duplicateHits: Number(existing.duplicateHits ?? 0) + 1,
      conflictHits: Number(existing.conflictHits ?? 0),
      lockOwner: existing.lockOwner ?? null,
      expiresAt: existingExpiresAt.toISOString(),
      persisted: true,
    };
  }

  private recordMetric(scope: IdempotencyScope, outcome: MetricOutcome): void {
    this.checksCounter?.inc({ scope, outcome });
  }
}
