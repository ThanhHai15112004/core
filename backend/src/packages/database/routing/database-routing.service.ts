import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import type { Counter } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import { recordDbEvent } from '../monitoring/db-events.js';
import { classifyDbError, sanitizeDbMessage } from '../utils/error-classify.js';
import type {
  ReadIntent,
  ReadOnlyExecutionOptions,
  ReadRoutingConfigSummary,
  ReadRoutingReason,
  ReadRoutingStatsSnapshot,
  ReadRoutingTarget,
} from './database-routing.types.js';

interface RoutingScopeStore {
  primaryPinned: boolean;
  forcePrimary: boolean;
  actorKey?: string | undefined;
}

const REQUEST_CONTEXT_PRIMARY_PIN_KEY = '__dbPrimaryPinned';
const MAX_LOCAL_STICKINESS_ENTRIES = 5_000;

let activeRouterInstance: DatabaseRoutingService | null = null;

/** Trả về bộ điều phối đọc/ghi đang hoạt động (fallback về instance mặc định khi chạy test đơn lẻ). */
export function getActiveDatabaseRouter(): DatabaseRoutingService {
  activeRouterInstance ??= new DatabaseRoutingService();
  return activeRouterInstance;
}

/** Gắn bộ điều phối đọc/ghi toàn cục cho các `BaseTypeOrmRepository`. */
export function setActiveDatabaseRouter(router: DatabaseRoutingService): void {
  activeRouterInstance = router;
}

/** Đặt lại bộ điều phối toàn cục (dùng trong unit test). */
export function resetActiveDatabaseRouter(): void {
  activeRouterInstance = null;
}

/**
 * Bộ điều phối định tuyến Primary / Read Replica:
 * - Read-after-write stickiness 2 tầng: trong cùng request (`AsyncLocalStorage` / `RequestContextService`) và xuyên request theo actor (Redis + bộ nhớ đệm cục bộ).
 * - Circuit breaker + tự fallback về Primary khi Replica lỗi kết nối/timeout/read-only và tự phục hồi sau cooldown.
 * - Theo dõi lag đồng bộ và ghi nhận metric Prometheus + sự kiện Database Monitor.
 */
@Injectable()
export class DatabaseRoutingService implements OnModuleInit {
  private readonly logger = new Logger('DatabaseRouting');
  private readonly scopeStorage = new AsyncLocalStorage<RoutingScopeStore>();
  private readonly localWriteWindows = new Map<string, number>();
  private readonly routingCounter: Counter<'target' | 'intent' | 'reason'> | null;
  private readonly fallbacksCounter: Counter<'reason'> | null;

  private totalReads = 0;
  private replicaReads = 0;
  private primaryReads = 0;
  private reportReplicaReads = 0;
  private readAfterWritePrimaryReads = 0;
  private fallbackCount = 0;
  private lastFallbackAt: string | null = null;
  private circuitOpenUntilMs = 0;
  private lastError: string | null = null;
  private lagMs: number | null = null;
  private replicaAvailable = true;
  private lastCheckedAt: string | null = null;

  constructor(
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() metrics?: MetricsRegistryService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    if (metrics) {
      this.routingCounter = metrics.counter(
        'core_db_read_routing_total',
        'Total read-only database operations routed by target, intent, and reason',
        ['target', 'intent', 'reason'],
      );
      this.fallbacksCounter = metrics.counter(
        'core_db_replica_fallbacks_total',
        'Total automatic read replica fallbacks to primary by error reason',
        ['reason'],
      );
    } else {
      this.routingCounter = null;
      this.fallbacksCounter = null;
    }
  }

  public onModuleInit(): void {
    setActiveDatabaseRouter(this);
  }

  /** Đọc cấu hình định tuyến và ngưỡng lag hiện hành. */
  public getConfigSummary(): ReadRoutingConfigSummary {
    const db = this.config?.database;
    return {
      readAfterWriteWindowMs: db?.readAfterWriteWindowMs ?? 3_000,
      replicaFallbackCooldownMs: db?.replicaFallbackCooldownMs ?? 30_000,
      replicationLagWarnMs: db?.replicationLagWarnMs ?? 1_000,
      replicationLagCritMs: db?.replicationLagCritMs ?? 5_000,
      fallbackOnCriticalLag: db?.fallbackOnCriticalLag ?? true,
    };
  }

  /** Ép mọi thao tác đọc trong `fn` đi qua Primary để bảo đảm nhất quán tuyệt đối. */
  public runWithPrimaryRead<T>(fn: () => T): T {
    const current = this.scopeStorage.getStore();
    return this.scopeStorage.run(
      {
        primaryPinned: current?.primaryPinned ?? false,
        forcePrimary: true,
        actorKey: current?.actorKey,
      },
      fn,
    );
  }

  /** Mở ngữ cảnh đọc/ghi riêng cho 1 request hoặc tác vụ nền (giữ pin Primary khi có thao tác ghi). */
  public runInReadWriteScope<T>(fn: () => T, options?: { readonly actorKey?: string }): T {
    const current = this.scopeStorage.getStore();
    return this.scopeStorage.run(
      {
        primaryPinned: current?.primaryPinned ?? false,
        forcePrimary: current?.forcePrimary ?? false,
        actorKey: options?.actorKey ?? current?.actorKey,
      },
      fn,
    );
  }

  /** Đánh dấu vừa có thao tác ghi (trong request hiện tại và cửa sổ Read-After-Write theo actor). */
  public markWrite(actorKey?: string): void {
    const scope = this.scopeStorage.getStore();
    if (scope) {
      scope.primaryPinned = true;
    }
    const reqCtx = RequestContextService.current();
    if (reqCtx) {
      (reqCtx as Record<string, unknown>)[REQUEST_CONTEXT_PRIMARY_PIN_KEY] = true;
    }

    const effectiveKey = this.resolveActorKey(actorKey);
    const windowMs = this.getConfigSummary().readAfterWriteWindowMs;
    if (!effectiveKey || windowMs <= 0) {
      return;
    }

    this.pruneExpiredLocalWindows();
    this.localWriteWindows.set(effectiveKey, Date.now() + windowMs);

    if (this.redis?.isReady()) {
      void this.redis.client
        .set(
          databaseKeys(this.redis).writeStickiness(effectiveKey),
          String(Date.now()),
          'PX',
          windowMs,
        )
        .catch(() => undefined);
    }
  }

  /** Kiểm tra actor hiện tại có đang nằm trong cửa sổ Read-After-Write hay không. */
  public async hasActiveWriteWindow(actorKey?: string): Promise<boolean> {
    const effectiveKey = this.resolveActorKey(actorKey);
    const windowMs = this.getConfigSummary().readAfterWriteWindowMs;
    if (!effectiveKey || windowMs <= 0) {
      return false;
    }

    const now = Date.now();
    const localExpiresAt = this.localWriteWindows.get(effectiveKey);
    if (localExpiresAt !== undefined) {
      if (localExpiresAt > now) {
        return true;
      }
      this.localWriteWindows.delete(effectiveKey);
    }

    if (this.redis?.isReady()) {
      const value = await this.redis.client
        .get(databaseKeys(this.redis).writeStickiness(effectiveKey))
        .catch(() => null);
      if (value !== null) {
        this.localWriteWindows.set(effectiveKey, now + Math.min(windowMs, 1_000));
        return true;
      }
    }

    return false;
  }

  /** Quyết định đích đọc (`PRIMARY` hoặc `REPLICA`) và lý do tương ứng. */
  public async decideReadTarget(params: {
    readonly hasReplication: boolean;
    readonly inTransaction: boolean;
    readonly options?: ReadOnlyExecutionOptions | undefined;
  }): Promise<{ readonly target: ReadRoutingTarget; readonly reason: ReadRoutingReason }> {
    const intent: ReadIntent = params.options?.intent ?? 'default';
    const scope = this.scopeStorage.getStore();

    if (params.options?.forcePrimary || scope?.forcePrimary) {
      return { target: 'PRIMARY', reason: 'forced_primary' };
    }
    if (params.inTransaction) {
      return { target: 'PRIMARY', reason: 'in_transaction' };
    }
    if (!params.hasReplication) {
      return { target: 'PRIMARY', reason: 'no_replica' };
    }
    if (this.isCircuitOpen()) {
      return { target: 'PRIMARY', reason: 'replica_circuit_open' };
    }

    if (intent !== 'report') {
      const reqCtx = RequestContextService.current();
      const inRequestPinned = Boolean(
        scope?.primaryPinned || reqCtx?.[REQUEST_CONTEXT_PRIMARY_PIN_KEY],
      );
      if (inRequestPinned) {
        return { target: 'PRIMARY', reason: 'read_after_write_request' };
      }

      if (await this.hasActiveWriteWindow(params.options?.stickinessKey)) {
        return { target: 'PRIMARY', reason: 'read_after_write_window' };
      }

      const cfg = this.getConfigSummary();
      if (cfg.fallbackOnCriticalLag && this.lagMs !== null && this.lagMs >= cfg.replicationLagCritMs) {
        return { target: 'PRIMARY', reason: 'replication_lag_critical' };
      }
    }

    return { target: 'REPLICA', reason: 'replica_ok' };
  }

  /** Ghi nhận kết quả điều hướng cho thống kê & Prometheus. */
  public recordReadOutcome(
    target: ReadRoutingTarget,
    intent: ReadIntent,
    reason: ReadRoutingReason,
  ): void {
    this.totalReads += 1;
    if (target === 'REPLICA') {
      this.replicaReads += 1;
      if (intent === 'report') {
        this.reportReplicaReads += 1;
      }
    } else {
      this.primaryReads += 1;
      if (reason === 'read_after_write_request' || reason === 'read_after_write_window') {
        this.readAfterWritePrimaryReads += 1;
      }
    }
    this.routingCounter?.inc({ target, intent, reason });
  }

  /** Mở circuit breaker khi Read Replica lỗi hạ tầng và phát sự kiện fallback. */
  public recordReplicaFailure(err: unknown): void {
    const cfg = this.getConfigSummary();
    const kind = classifyDbError(err);
    const sanitized = sanitizeDbMessage(err);
    const wasOpen = this.isCircuitOpen();

    this.fallbackCount += 1;
    this.lastFallbackAt = new Date().toISOString();
    this.lastError = sanitized;
    this.replicaAvailable = false;
    this.circuitOpenUntilMs = Date.now() + cfg.replicaFallbackCooldownMs;
    this.fallbacksCounter?.inc({ reason: kind });

    if (!wasOpen) {
      this.logger.warn(
        `Read replica failed (${kind}): ${sanitized} — falling back to primary for ${cfg.replicaFallbackCooldownMs}ms`,
      );
      void recordDbEvent(this.redis, {
        type: 'replica_fallback',
        severity: 'warning',
        params: { reason: kind, message: sanitized },
        runtime: this.identity?.id ?? null,
      });
    }
  }

  /** Đóng circuit breaker khi Read Replica phục hồi. */
  public recordReplicaSuccess(): void {
    const hadIssue = this.circuitOpenUntilMs > 0 || !this.replicaAvailable;
    this.circuitOpenUntilMs = 0;
    this.replicaAvailable = true;
    this.lastError = null;
    if (hadIssue) {
      this.logger.log('Read replica recovered — resuming replica reads');
      void recordDbEvent(this.redis, {
        type: 'replica_recovered',
        severity: 'success',
        params: {},
        runtime: this.identity?.id ?? null,
      });
    }
  }

  /** Cập nhật trạng thái sức khỏe & độ trễ đồng bộ từ trình giám sát nền. */
  public updateReplicationHealth(info: {
    readonly available: boolean;
    readonly lagMs: number | null;
    readonly error?: string | null | undefined;
    readonly checkedAt?: string | undefined;
    readonly openCircuitOnFailure?: boolean | undefined;
  }): void {
    this.lagMs = info.lagMs;
    this.lastCheckedAt = info.checkedAt ?? new Date().toISOString();
    if (info.available) {
      this.recordReplicaSuccess();
      return;
    }

    this.replicaAvailable = false;
    if (info.error !== undefined) {
      this.lastError = info.error;
    }
    if (info.openCircuitOnFailure) {
      this.circuitOpenUntilMs = Date.now() + this.getConfigSummary().replicaFallbackCooldownMs;
    }
  }

  /** Ảnh chụp chỉ số điều hướng & circuit breaker cho System Console. */
  public getSnapshot(): ReadRoutingStatsSnapshot {
    const open = this.isCircuitOpen();
    return {
      totalReads: this.totalReads,
      replicaReads: this.replicaReads,
      primaryReads: this.primaryReads,
      reportReplicaReads: this.reportReplicaReads,
      readAfterWritePrimaryReads: this.readAfterWritePrimaryReads,
      fallbackCount: this.fallbackCount,
      lastFallbackAt: this.lastFallbackAt,
      circuitState: open ? 'open' : 'closed',
      circuitOpenUntil: open ? new Date(this.circuitOpenUntilMs).toISOString() : null,
      lastError: this.lastError,
      lagMs: this.lagMs,
      replicaAvailable: this.replicaAvailable,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  private isCircuitOpen(now = Date.now()): boolean {
    if (this.circuitOpenUntilMs <= 0) {
      return false;
    }
    if (now >= this.circuitOpenUntilMs) {
      this.circuitOpenUntilMs = 0;
      return false;
    }
    return true;
  }

  private resolveActorKey(explicit?: string): string | null {
    const trimmed = explicit?.trim();
    if (trimmed) return trimmed;
    const scopeActor = this.scopeStorage.getStore()?.actorKey?.trim();
    if (scopeActor) return scopeActor;
    const reqCtx = RequestContextService.current();
    if (reqCtx?.userId && String(reqCtx.userId).trim()) {
      return String(reqCtx.userId).trim();
    }
    const actor = reqCtx?.actor as { id?: string | number } | undefined;
    if (actor?.id !== undefined && actor.id !== null) {
      const str = String(actor.id).trim();
      if (str) return str;
    }
    return null;
  }

  private pruneExpiredLocalWindows(): void {
    if (this.localWriteWindows.size <= MAX_LOCAL_STICKINESS_ENTRIES) {
      return;
    }
    const now = Date.now();
    for (const [key, expiresAt] of this.localWriteWindows.entries()) {
      if (expiresAt <= now) {
        this.localWriteWindows.delete(key);
      }
    }
  }
}
