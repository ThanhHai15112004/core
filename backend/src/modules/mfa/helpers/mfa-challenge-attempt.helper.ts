import type { BaseCacheProvider } from '@packages/cache/index.js';
import { type SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import { MFA_CHALLENGE_ATTEMPT_TTL_SEC, MFA_CHALLENGE_MAX_L1_ENTRIES } from '../enum/mfa.enum.js';

/**
 * Bộ theo dõi số lần thử thách thức MFA hỗ trợ đồng bộ đa tiến trình (Multi-instance) qua L2 Cache (Redis)
 * kèm bộ đệm L1 có giới hạn kích thước và tự động thu hồi theo TTL (chống rò rỉ bộ nhớ).
 */
export class MfaChallengeAttemptTracker {
  private readonly l1Store = new Map<string, { count: number; expiresAtMs: number }>();

  constructor(
    private readonly getCacheProvider?: () => BaseCacheProvider | null | undefined,
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
  ) {}

  private getAttemptTtlSeconds(): number {
    return Math.max(
      60,
      this.settingRegistry.getNumber(
        'security.mfa.challenge_ttl_seconds',
        undefined,
        MFA_CHALLENGE_ATTEMPT_TTL_SEC,
      ),
    );
  }

  private buildCacheKey(challengeHash: string): string {
    return `auth:mfa:challenge:attempts:${challengeHash}`;
  }

  private pruneExpiredL1(nowMs: number): void {
    if (this.l1Store.size < MFA_CHALLENGE_MAX_L1_ENTRIES) {
      return;
    }
    for (const [k, entry] of this.l1Store.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.l1Store.delete(k);
      }
    }
    if (this.l1Store.size >= MFA_CHALLENGE_MAX_L1_ENTRIES) {
      const oldestKey = this.l1Store.keys().next().value;
      if (oldestKey) {
        this.l1Store.delete(oldestKey);
      }
    }
  }

  public async getAttempts(challengeHash: string): Promise<number> {
    const nowMs = Date.now();
    const local = this.l1Store.get(challengeHash);
    const localCount = local && local.expiresAtMs > nowMs ? local.count : 0;
    if (local && local.expiresAtMs <= nowMs) {
      this.l1Store.delete(challengeHash);
    }

    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        const remoteCount = await cache.get<number>(this.buildCacheKey(challengeHash));
        if (typeof remoteCount === 'number' && Number.isFinite(remoteCount)) {
          return Math.max(localCount, remoteCount);
        }
      } catch {
        // Fallback to L1
      }
    }
    return localCount;
  }

  public async incrementAttempts(challengeHash: string, currentAttempts: number): Promise<number> {
    const nextAttempts = currentAttempts + 1;
    const nowMs = Date.now();
    const ttlSec = this.getAttemptTtlSeconds();
    this.pruneExpiredL1(nowMs);
    this.l1Store.set(challengeHash, {
      count: nextAttempts,
      expiresAtMs: nowMs + ttlSec * 1000,
    });

    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        await cache.set(this.buildCacheKey(challengeHash), nextAttempts, ttlSec);
      } catch {
        // Ignore L2 cache errors
      }
    }
    return nextAttempts;
  }

  public async clearAttempts(challengeHash: string): Promise<void> {
    this.l1Store.delete(challengeHash);
    const cache = this.getCacheProvider?.();
    if (cache) {
      try {
        await cache.delete(this.buildCacheKey(challengeHash));
      } catch {
        // Ignore L2 cache errors
      }
    }
  }
}
