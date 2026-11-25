import { Injectable, Logger } from '@nestjs/common';
import {
  IDEMPOTENCY_DEFAULTS,
  IDEMPOTENCY_OUTCOME,
  IDEMPOTENCY_SCOPE,
  type IIdempotencyPort,
  type IIdempotencyStoreDelegate,
  type IdempotencyAcquireInput,
  type IdempotencyAcquireResult,
  type IdempotencyCompleteInput,
  type IdempotencyExecuteInput,
  type IdempotencyExecuteResult,
  type IdempotencyFailInput,
  type IdempotencyGuardWebhookInput,
  type IdempotencyMetricsSnapshot,
  type IdempotencyRecordExternalInput,
} from '../contracts/idempotency.contract.js';
import {
  IdempotencyInProgressException,
  IdempotencyPayloadMismatchException,
} from '../errors/idempotency.exception.js';
import {
  computeIdempotencyFingerprint,
  normalizeIdempotencyScopeTarget,
} from '../utils/idempotency.util.js';

/**
 * Port / Registry trung tâm cho cơ chế chống xử lý trùng (`@packages/kernel`, Phase 11.3):
 * - Ủy quyền thao tác lưu trữ & khóa chống trùng xuống `IdempotencyModule` qua `registerStore(...)`.
 * - Giúp HTTP Interceptor, Worker `BaseQueueProcessor`, `DomainEventBusService` và các module nghiệp vụ
 *   dùng chung một điểm truy cập duy nhất mà không tạo phụ thuộc vòng hay import chéo module.
 * - Khi chưa có store (unit test cô lập không nạp `IdempotencyModule`), tự trả `ACQUIRED` (`persisted: false`)
 *   để không phá vỡ các test hiện hữu.
 */
@Injectable()
export class IdempotencyRegistryService implements IIdempotencyPort {
  private readonly logger = new Logger(IdempotencyRegistryService.name);
  private store: IIdempotencyStoreDelegate | null = null;

  /** Đăng ký bộ lưu trữ Idempotency bền vững (do `IdempotencyModule` gọi lúc bootstrap). */
  public registerStore(store: IIdempotencyStoreDelegate): () => void {
    this.store = store;
    return () => {
      if (this.store === store) {
        this.store = null;
      }
    };
  }

  public isReady(): boolean {
    return this.store !== null;
  }

  public async acquire(input: IdempotencyAcquireInput): Promise<IdempotencyAcquireResult> {
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);
    const now = input.now ?? new Date();
    const defaultTtl = this.defaultTtlForScope(input.scope);
    const ttlSec = input.ttlSec && input.ttlSec > 0 ? Math.round(input.ttlSec) : defaultTtl;

    if (!this.store) {
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
        lockOwner: input.lockOwner ?? null,
        expiresAt: new Date(now.getTime() + ttlSec * 1000).toISOString(),
        persisted: false,
      };
    }

    return this.store.acquire({
      ...input,
      scopeTarget,
      now,
    });
  }

  public async complete(input: IdempotencyCompleteInput): Promise<void> {
    if (!this.store) return;
    await this.store.complete({
      ...input,
      scopeTarget: normalizeIdempotencyScopeTarget(input.scopeTarget),
    });
  }

  public async fail(input: IdempotencyFailInput): Promise<void> {
    if (!this.store) return;
    await this.store.fail({
      ...input,
      scopeTarget: normalizeIdempotencyScopeTarget(input.scopeTarget),
    });
  }

  public async recordExternalObservation(input: IdempotencyRecordExternalInput): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.recordExternalObservation({
        ...input,
        scopeTarget: normalizeIdempotencyScopeTarget(input.scopeTarget),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record external idempotency observation (${input.scope}:${input.scopeTarget}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Thực thi an toàn một tác vụ bất đồng bộ có bảo vệ chống xử lý trùng:
   * - Nếu đã `COMPLETED` cùng fingerprint → trả kết quả đã lưu (`duplicate: true`) không chạy lại `run()`.
   * - Nếu khác fingerprint → ném `IdempotencyPayloadMismatchException` (`409`).
   * - Nếu đang chạy đồng thời → ném `IdempotencyInProgressException` (`409`).
   * - Nếu `run()` thất bại → đánh dấu `FAILED` để lần retry sau vẫn chạy lại được.
   */
  public async execute<T>(input: IdempotencyExecuteInput<T>): Promise<IdempotencyExecuteResult<T>> {
    const scopeTarget = normalizeIdempotencyScopeTarget(input.scopeTarget);
    const requestFingerprint =
      input.requestFingerprint ?? computeIdempotencyFingerprint(input.payload);

    const acquired = await this.acquire({
      scope: input.scope,
      scopeTarget,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      ttlSec: input.ttlSec,
      leaseSec: input.leaseSec,
      lockOwner: input.lockOwner,
      clientIdentifier: input.clientIdentifier,
      correlationId: input.correlationId,
      allowSameOwnerRetry: input.allowSameOwnerRetry,
    });

    if (acquired.outcome === IDEMPOTENCY_OUTCOME.PAYLOAD_MISMATCH) {
      throw new IdempotencyPayloadMismatchException({
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        reason: 'Same idempotency key was reused with a different payload fingerprint',
      });
    }

    if (acquired.outcome === IDEMPOTENCY_OUTCOME.IN_PROGRESS) {
      throw new IdempotencyInProgressException({
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        reason: 'Another execution with the same idempotency key is currently in progress',
      });
    }

    if (acquired.outcome === IDEMPOTENCY_OUTCOME.REPLAYED) {
      return {
        duplicate: true,
        recordId: acquired.recordId,
        result: (acquired.response?.body ?? null) as T,
        duplicateHits: acquired.duplicateHits,
        persisted: acquired.persisted,
      };
    }

    try {
      const result = await input.run();
      await this.complete({
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        recordId: acquired.recordId,
        lockOwner: acquired.lockOwner,
        statusCode: input.statusCode ?? 200,
        responseBody: result,
      });
      return {
        duplicate: false,
        recordId: acquired.recordId,
        result,
        duplicateHits: acquired.duplicateHits,
        persisted: acquired.persisted,
      };
    } catch (err) {
      const errCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code ?? 'EXECUTION_FAILED')
          : err instanceof Error
            ? err.name
            : 'EXECUTION_FAILED';
      const errMessage = err instanceof Error ? err.message : String(err);
      await this.fail({
        scope: input.scope,
        scopeTarget,
        idempotencyKey: input.idempotencyKey,
        recordId: acquired.recordId,
        lockOwner: acquired.lockOwner,
        errorCode: errCode.slice(0, 80),
        errorMessage: errMessage.slice(0, 1000),
      });
      throw err;
    }
  }

  /**
   * Wrapper chuyên biệt cho luồng Webhook đối tác dựa trên `(providerCode, externalEventId)`.
   * Dùng chung cho mọi endpoint nhận webhook mới hoặc tích hợp bổ sung bên cạnh `inbound-webhooks`.
   */
  public async guardWebhook<T>(
    input: IdempotencyGuardWebhookInput<T>,
  ): Promise<IdempotencyExecuteResult<T>> {
    const providerCode = input.providerCode.trim().toLowerCase() || 'unknown';
    return this.execute<T>({
      scope: IDEMPOTENCY_SCOPE.WEBHOOK,
      scopeTarget: providerCode,
      idempotencyKey: input.externalEventId.trim(),
      payload: input.payload,
      requestFingerprint: input.payloadHash,
      ttlSec: input.ttlSec,
      clientIdentifier: `provider:${providerCode}`,
      correlationId: input.correlationId,
      run: input.run,
    });
  }

  public async getMetricsSnapshot(windowHours?: number): Promise<IdempotencyMetricsSnapshot | null> {
    if (!this.store) return null;
    try {
      return await this.store.getMetricsSnapshot(windowHours);
    } catch {
      return null;
    }
  }

  public resetForTesting(): void {
    this.store = null;
  }

  private defaultTtlForScope(scope: IdempotencyAcquireInput['scope']): number {
    switch (scope) {
      case IDEMPOTENCY_SCOPE.JOB:
        return IDEMPOTENCY_DEFAULTS.JOB_TTL_SEC;
      case IDEMPOTENCY_SCOPE.WEBHOOK:
        return IDEMPOTENCY_DEFAULTS.WEBHOOK_TTL_SEC;
      case IDEMPOTENCY_SCOPE.EVENT:
        return IDEMPOTENCY_DEFAULTS.EVENT_TTL_SEC;
      case IDEMPOTENCY_SCOPE.API:
      default:
        return IDEMPOTENCY_DEFAULTS.API_TTL_SEC;
    }
  }
}

export const defaultIdempotencyRegistry = new IdempotencyRegistryService();
