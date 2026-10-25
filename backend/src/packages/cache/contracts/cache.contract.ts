export interface CacheGetOrSetOptions {
  /** Thời gian sống của cache (giây). Nếu không truyền sẽ lấy TTL mặc định hợp lý (vd. 300s). */
  ttlSeconds?: number;
  /** Bật khóa chống Cache Stampede liên tiến trình trên Redis (mặc định true). */
  stampedeLock?: boolean;
  /** Thời gian giữ khóa tạo cache tối đa (ms, mặc định 5000ms). */
  lockTtlMs?: number;
  /** Thời gian chờ tối đa khi tiến trình khác đang tạo cache (ms, mặc định 2000ms). */
  waitTimeoutMs?: number;
  /** Chu kỳ kiểm tra lại cache khi đang chờ tiến trình khác (ms, mặc định 25ms). */
  pollIntervalMs?: number;
}

export interface CacheLatencyStats {
  totalCommands: number;
  errorCount: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface CacheContract {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  invalidateModule(moduleName: string): Promise<number>;
  getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: number | CacheGetOrSetOptions,
  ): Promise<T>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
}
