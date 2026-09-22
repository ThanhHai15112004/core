import type { CacheDriver, CacheReadResult } from './cache-driver.js';

export interface MemoryEntry {
  value: unknown;
  /** epoch ms; null = không hết hạn */
  expiresAt: number | null;
  /** Kích thước ước lượng (độ dài JSON, byte). */
  bytes: number;
}

const sizeOf = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
};

/** Cache trong RAM của process (mỗi runtime một bản riêng). Hết hạn lười + dọn định kỳ khi được đọc/snapshot. */
export class MemoryCacheDriver implements CacheDriver {
  public readonly name = 'memory' as const;
  private readonly store = new Map<string, MemoryEntry>();
  /** Số key đã hết hạn và bị dọn (cộng dồn từ lúc khởi động). */
  public expiredTotal = 0;

  public async get(key: string): Promise<CacheReadResult> {
    const entry = this.store.get(key);
    if (!entry) return { found: false, value: null };
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      this.expiredTotal++;
      return { found: false, value: null };
    }
    return { found: true, value: entry.value };
  }

  public async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      bytes: Buffer.byteLength(key, 'utf8') + sizeOf(value),
    });
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  public async has(key: string): Promise<boolean> {
    return (await this.get(key)).found;
  }

  public async clear(): Promise<number> {
    const n = this.store.size;
    this.store.clear();
    return n;
  }

  /** Xoá các key thuộc điều kiện; trả số key đã xoá. */
  public deleteWhere(match: (key: string) => boolean): number {
    let n = 0;
    for (const key of [...this.store.keys()]) {
      if (match(key)) {
        this.store.delete(key);
        n++;
      }
    }
    return n;
  }

  /** Dọn key hết hạn rồi trả danh sách còn lại (cho monitor). */
  public entries(now = Date.now()): [string, MemoryEntry][] {
    for (const [key, e] of this.store) {
      if (e.expiresAt !== null && now >= e.expiresAt) {
        this.store.delete(key);
        this.expiredTotal++;
      }
    }
    return [...this.store.entries()];
  }

  public entry(key: string): MemoryEntry | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && Date.now() >= e.expiresAt) return null;
    return e;
  }
}
