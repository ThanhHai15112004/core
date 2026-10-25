import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { cacheKeys } from '../constants/cache.keys.js';

export const DEFAULT_DISTRIBUTED_LOCK_TTL_MS = 30_000;
export const MIN_DISTRIBUTED_LOCK_TTL_MS = 50;

export interface AcquireLockOptions {
  /** Thời gian hết hạn của khóa (ms). Bắt buộc dương (mặc định 30_000ms) để tránh khóa bị giữ vĩnh viễn. */
  ttlMs?: number;
  /** Token định danh chủ sở hữu khóa (mặc định tự sinh UUID duy nhất). */
  ownerToken?: string;
  /** Số lần thử lại nếu khóa đang bị tiến trình khác giữ (mặc định 0 — trả về null ngay). */
  retryCount?: number;
  /** Thời gian chờ giữa các lần thử lại (ms, mặc định 50ms). */
  retryDelayMs?: number;
}

export interface DistributedLockHandle {
  /** Tên tài nguyên được khóa (chưa gồm prefix Redis). */
  resource: string;
  /** Khóa đầy đủ trong bộ lưu trữ. */
  lockKey: string;
  /** Token duy nhất của chủ sở hữu đã chiếm khóa. */
  token: string;
  /** Thời gian hết hạn được cấp (ms). */
  ttlMs: number;
  /** Thời điểm chiếm khóa thành công (epoch ms). */
  acquiredAt: number;
  /** Thời điểm dự kiến hết hạn (epoch ms). */
  expiresAt: number;
  /** Giải phóng khóa an toàn (chỉ giải phóng nếu vẫn là chủ sở hữu). */
  release: () => Promise<boolean>;
  /** Gia hạn thời gian sống của khóa (chỉ gia hạn nếu vẫn là chủ sở hữu). */
  extend: (additionalTtlMs: number) => Promise<boolean>;
}

export class DistributedLockConflictError extends Error {
  public readonly code = 'DISTRIBUTED_LOCK_CONFLICT';

  constructor(public readonly resource: string) {
    super(`Resource "${resource}" is currently locked by another execution`);
  }
}

interface MemoryLockEntry {
  token: string;
  expiresAt: number;
}

/**
 * 7.5.6 & 7.5.7 — Dịch vụ Khóa phân tán (Distributed Lock) dùng chung cho Job, Scheduler và các thao tác dễ trùng:
 * - Tự động dùng Redis (`SET key token PX ttlMs NX`) ở Production và hỗ trợ fallback In-Memory ở Test.
 * - Bắt buộc mọi khóa đều có thời gian hết hạn (`ttlMs` >= 50ms, mặc định 30s) để tránh giữ khóa vĩnh viễn khi crash.
 * - Giải phóng (`release`) và gia hạn (`extend`) kiểm tra đúng `token` chủ sở hữu để không bao giờ xóa nhầm khóa của tiến trình khác.
 */
@Injectable()
export class DistributedLockService {
  private readonly memoryLocks = new Map<string, MemoryLockEntry>();

  constructor(
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  private get usesRedis(): boolean {
    const preferMemory = this.config?.cache.driver === 'memory';
    return !preferMemory && Boolean(this.redis?.isReady());
  }

  private normalizeResource(resource: string): string {
    const cleaned = resource.trim().replace(/^:+|:+$/g, '');
    if (!cleaned) {
      throw new Error('Distributed lock resource name must not be empty');
    }
    return cleaned;
  }

  /** Chuẩn hóa thời gian hết hạn của lock (`ttlMs`), đảm bảo luôn có hạn sử dụng hữu hạn (> 0). */
  public resolveLockTtlMs(ttlMs?: number): number {
    if (ttlMs === undefined || ttlMs === null) {
      return DEFAULT_DISTRIBUTED_LOCK_TTL_MS;
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(
        `Invalid lock TTL "${String(ttlMs)}": lock must have a positive expiration time`,
      );
    }
    return Math.max(MIN_DISTRIBUTED_LOCK_TTL_MS, Math.round(ttlMs));
  }

  private buildLockKey(resource: string): string {
    const norm = this.normalizeResource(resource);
    if (this.redis) {
      return cacheKeys(this.redis).distributedLock(norm);
    }
    return `lock:${norm}`;
  }

  private pruneExpiredMemoryLock(lockKey: string, now = Date.now()): void {
    const existing = this.memoryLocks.get(lockKey);
    if (existing && now >= existing.expiresAt) {
      this.memoryLocks.delete(lockKey);
    }
  }

  /**
   * 7.5.6 & 7.5.7 — Chiếm giữ khóa phân tán với thời gian hết hạn bắt buộc (`ttlMs`).
   * Trả về `DistributedLockHandle` nếu chiếm được khóa, hoặc `null` nếu khóa đang bận.
   */
  public async acquire(
    resource: string,
    options: AcquireLockOptions = {},
  ): Promise<DistributedLockHandle | null> {
    const normResource = this.normalizeResource(resource);
    const ttlMs = this.resolveLockTtlMs(options.ttlMs);
    const token = options.ownerToken?.trim() || `${process.pid}:${Date.now()}:${randomUUID()}`;
    const retryCount = Math.max(0, Math.trunc(options.retryCount ?? 0));
    const retryDelayMs = Math.max(5, Math.trunc(options.retryDelayMs ?? 50));
    const lockKey = this.buildLockKey(normResource);

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      const now = Date.now();
      const acquired = await this.tryAcquireOnce(lockKey, token, ttlMs, now);
      if (acquired) {
        const handle: DistributedLockHandle = {
          resource: normResource,
          lockKey,
          token,
          ttlMs,
          acquiredAt: now,
          expiresAt: now + ttlMs,
          release: () => this.release({ resource: normResource, token }),
          extend: (additionalTtlMs: number) =>
            this.extend({ resource: normResource, token }, additionalTtlMs),
        };
        return handle;
      }

      if (attempt < retryCount) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    return null;
  }

  private async tryAcquireOnce(
    lockKey: string,
    token: string,
    ttlMs: number,
    now: number,
  ): Promise<boolean> {
    if (this.usesRedis && this.redis) {
      const res = await this.redis.client.set(lockKey, token, 'PX', ttlMs, 'NX').catch(() => null);
      if (res === 'OK') {
        return true;
      }
      const currentHolder = await this.redis.client.get(lockKey).catch(() => null);
      if (currentHolder === token) {
        await this.redis.client.pexpire(lockKey, ttlMs).catch(() => undefined);
        return true;
      }
      return false;
    }

    this.pruneExpiredMemoryLock(lockKey, now);
    const existing = this.memoryLocks.get(lockKey);
    if (!existing || existing.token === token) {
      this.memoryLocks.set(lockKey, { token, expiresAt: now + ttlMs });
      return true;
    }
    return false;
  }

  /**
   * Giải phóng khóa phân tán an toàn (chỉ xóa khóa khi `token` khớp với chủ sở hữu hiện tại).
   */
  public async release(input: { resource: string; token: string }): Promise<boolean> {
    const normResource = this.normalizeResource(input.resource);
    const lockKey = this.buildLockKey(normResource);

    if (this.usesRedis && this.redis) {
      const currentHolder = await this.redis.client.get(lockKey).catch(() => null);
      if (currentHolder !== input.token) {
        return false;
      }
      const deleted = await this.redis.client.del(lockKey).catch(() => 0);
      return deleted > 0;
    }

    this.pruneExpiredMemoryLock(lockKey);
    const existing = this.memoryLocks.get(lockKey);
    if (!existing || existing.token !== input.token) {
      return false;
    }
    this.memoryLocks.delete(lockKey);
    return true;
  }

  /**
   * Gia hạn thời gian hết hạn của khóa nếu tiến trình hiện tại vẫn đang giữ khóa.
   */
  public async extend(input: { resource: string; token: string }, ttlMs: number): Promise<boolean> {
    const effectiveTtlMs = this.resolveLockTtlMs(ttlMs);
    const normResource = this.normalizeResource(input.resource);
    const lockKey = this.buildLockKey(normResource);

    if (this.usesRedis && this.redis) {
      const currentHolder = await this.redis.client.get(lockKey).catch(() => null);
      if (currentHolder !== input.token) {
        return false;
      }
      const updated = await this.redis.client.pexpire(lockKey, effectiveTtlMs).catch(() => 0);
      return Number(updated) > 0;
    }

    const now = Date.now();
    this.pruneExpiredMemoryLock(lockKey, now);
    const existing = this.memoryLocks.get(lockKey);
    if (!existing || existing.token !== input.token) {
      return false;
    }
    existing.expiresAt = now + effectiveTtlMs;
    return true;
  }

  /** Kiểm tra xem tài nguyên hiện đang bị khóa hay không. */
  public async isLocked(resource: string): Promise<boolean> {
    return (await this.getHolder(resource)) !== null;
  }

  /** Lấy token của chủ sở hữu đang giữ khóa (hoặc `null` nếu khóa đang rảnh / đã hết hạn). */
  public async getHolder(resource: string): Promise<string | null> {
    const normResource = this.normalizeResource(resource);
    const lockKey = this.buildLockKey(normResource);

    if (this.usesRedis && this.redis) {
      const pttl = await this.redis.client.pttl(lockKey).catch(() => -2);
      if (pttl === -2 || (pttl >= 0 && pttl === 0)) {
        return null;
      }
      return this.redis.client.get(lockKey).catch(() => null);
    }

    this.pruneExpiredMemoryLock(lockKey);
    return this.memoryLocks.get(lockKey)?.token ?? null;
  }

  /**
   * Thực thi hàm `fn` bên trong vùng bảo vệ của Distributed Lock và tự động nhả khóa trong `finally`.
   * Nếu không chiếm được khóa sẽ ném `DistributedLockConflictError`.
   */
  public async withLock<T>(
    resource: string,
    fn: (handle: DistributedLockHandle) => Promise<T>,
    options: AcquireLockOptions = {},
  ): Promise<T> {
    const handle = await this.acquire(resource, options);
    if (!handle) {
      throw new DistributedLockConflictError(resource);
    }
    try {
      return await fn(handle);
    } finally {
      await handle.release();
    }
  }
}
