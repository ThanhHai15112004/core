import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { cacheKeys } from '../constants/cache.keys.js';
import type {
  CacheOperationAction,
  CacheOperationRecord,
} from '../contracts/cache-events.types.js';
import { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { unlinkMatching } from '../drivers/redis-cache.driver.js';
import { BaseCacheProvider } from '../providers/cache.provider.js';
import { CacheConnectionService } from '../providers/cache-connection.service.js';
import { CacheMonitoringService } from '../monitoring/cache-monitoring.service.js';
import { recordCacheEvent, recordCacheOperation } from '../utils/cache-events.js';
import { sanitizeCacheMessage } from '../utils/cache-errors.js';
import { namespaceOf, namespacePattern } from '../utils/namespace.js';

export type CacheOperationErrorCode =
  | 'ACTIONS_DISABLED'
  | 'FLUSH_DISABLED'
  | 'UNAVAILABLE'
  | 'KEY_NOT_FOUND'
  | 'NAMESPACE_EMPTY'
  | 'BUSY'
  | 'FAILED';

export class CacheOperationError extends Error {
  constructor(
    public readonly code: CacheOperationErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

export interface OperationContext {
  ip: string | null;
  actor: string | null;
}

export interface OperationResult {
  record: CacheOperationRecord;
}

/** Thao tác lớn (clear namespace / flush) có thể lâu với cache lớn — khoá tối đa chừng này. */
const LOCK_MS = 5 * 60_000;

/**
 * Thao tác quản trị cache: test kết nối, xoá key, clear namespace, flush cache của core.
 * Mọi thao tác xoá chỉ trong vùng `<prefix>cache:*` (không FLUSHDB/KEYS), ghi audit + sự kiện.
 */
@Injectable()
export class CacheOperationsService {
  constructor(
    private readonly cache: BaseCacheProvider,
    private readonly connection: CacheConnectionService,
    private readonly monitoring: CacheMonitoringService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  private get memory(): MemoryCacheDriver | null {
    return this.cache.driver instanceof MemoryCacheDriver ? this.cache.driver : null;
  }

  public async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number | null;
    error: string | null;
    state: string;
  }> {
    try {
      if (!this.monitoring.usable()) throw new Error(this.redis?.getLastError() ?? 'not connected');
      const latencyMs = await this.monitoring.provider.ping();
      this.connection.markSuccess();
      return { ok: true, latencyMs, error: null, state: this.connection.getStatus().state };
    } catch (err) {
      return {
        ok: false,
        latencyMs: null,
        error: sanitizeCacheMessage(err),
        state: this.connection.getStatus().state,
      };
    }
  }

  private ensure(flush = false): void {
    if (flush ? !this.config.cache.flushEnabled : !this.config.cache.actionsEnabled)
      throw new CacheOperationError(flush ? 'FLUSH_DISABLED' : 'ACTIONS_DISABLED');
    if (!this.monitoring.usable()) throw new CacheOperationError('UNAVAILABLE');
  }

  public async deleteKey(key: string, ctx: OperationContext): Promise<OperationResult> {
    this.ensure();
    const info = await this.monitoring.provider.keyInfo(key);
    if (!info) throw new CacheOperationError('KEY_NOT_FOUND', key);
    return this.run('delete_key', key, ctx, async () => {
      await this.cache.driver.delete(key);
      return 1;
    });
  }

  public async clearNamespace(ns: string, ctx: OperationContext): Promise<OperationResult> {
    this.ensure();
    const depth = this.config.cache.namespaceDepth;
    const matches = (k: string) => namespaceOf(k, depth) === ns;
    return this.locked(() =>
      this.run('clear_namespace', ns, ctx, async () => {
        const memory = this.memory;
        const n = memory
          ? memory.deleteWhere(matches)
          : await unlinkMatching(
              this.redis!,
              namespacePattern(cacheKeys(this.redis!).dataPrefix(), ns),
              matches,
            );
        if (n === 0) throw new CacheOperationError('NAMESPACE_EMPTY', ns);
        return n;
      }),
    );
  }

  public async flushAll(ctx: OperationContext): Promise<OperationResult> {
    this.ensure(true);
    return this.locked(() => this.run('flush_all', '*', ctx, () => this.cache.flush()));
  }

  /** Một thao tác xoá lớn tại một thời điểm (giữa mọi instance API). */
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.redis?.isReady()) return fn();
    const key = cacheKeys(this.redis).flushLock();
    const token = `${process.pid}:${Date.now()}`;
    const ok = await this.redis.client.set(key, token, 'PX', LOCK_MS, 'NX');
    if (ok !== 'OK') throw new CacheOperationError('BUSY');
    try {
      return await fn();
    } finally {
      if ((await this.redis.client.get(key)) === token) await this.redis.client.del(key);
    }
  }

  private async run(
    action: CacheOperationAction,
    target: string,
    ctx: OperationContext,
    fn: () => Promise<number>,
  ): Promise<OperationResult> {
    const started = performance.now();
    let affected = 0;
    let error: string | null = null;
    try {
      affected = await fn();
    } catch (err) {
      if (err instanceof CacheOperationError && err.code !== 'FAILED') throw err;
      error = sanitizeCacheMessage(err);
    }
    const base = {
      at: Date.now(),
      action,
      target,
      result: error ? ('failed' as const) : ('success' as const),
      affected,
      durationMs: Number((performance.now() - started).toFixed(1)),
      actor: ctx.actor,
      ip: ctx.ip,
      error,
    };
    const record = this.redis?.isReady()
      ? await recordCacheOperation(this.redis, base)
      : { id: 'local', ...base };
    if (!error) {
      await recordCacheEvent(this.redis, {
        type:
          action === 'delete_key'
            ? 'key_deleted'
            : action === 'clear_namespace'
              ? 'namespace_cleared'
              : 'cache_flushed',
        severity: action === 'flush_all' ? 'warning' : 'info',
        params: { target, affected },
        runtime: this.identity?.id ?? null,
      });
      // Số liệu keyspace cập nhật ngay sau thao tác.
      await this.monitoring.refreshKeyspace().catch(() => undefined);
    }
    if (error) throw new CacheOperationError('FAILED', error);
    return { record };
  }
}
