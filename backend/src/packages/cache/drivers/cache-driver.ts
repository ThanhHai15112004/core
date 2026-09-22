import type { CacheDriverName } from '@packages/config/index.js';

export interface CacheReadResult {
  found: boolean;
  value: unknown;
}

/** Lưu trữ thật phía sau `BaseCacheProvider`. Key truyền vào không có prefix. */
export interface CacheDriver {
  readonly name: CacheDriverName;
  get(key: string): Promise<CacheReadResult>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Xoá toàn bộ dữ liệu cache của driver (chỉ vùng cache của core). Trả về số key đã xoá. */
  clear(): Promise<number>;
}

/** Driver không dùng được lúc này (vd. Redis chưa kết nối) — tính là miss, không làm hỏng caller. */
export class CacheUnavailableError extends Error {
  public readonly code = 'ECONNREFUSED';

  constructor(state: string) {
    super(`Cache backend is ${state}`);
  }
}
