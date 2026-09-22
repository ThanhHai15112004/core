/** Trạng thái pool kết nối đọc được từ driver; `null` khi driver không lộ số liệu này. */
export interface PoolStats {
  /** Kết nối đang được dùng. */
  used: number;
  idle: number;
  /** Yêu cầu đang chờ kết nối. */
  waiting: number;
  total: number;
}

const lengthOf = (v: unknown): number | null => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object' && typeof (v as { length?: unknown }).length === 'number')
    return (v as { length: number }).length;
  return null;
};

/**
 * Đọc pool của driver TypeORM: `pg.Pool` (postgres) có API công khai; `mysql2` chỉ có trường nội bộ
 * nên đọc thận trọng. Driver khác → `null` ("Không khả dụng").
 */
export function readPoolStats(driver: unknown): PoolStats | null {
  const d = driver as { master?: unknown; pool?: unknown } | null;
  const pg = d?.master as { totalCount?: unknown; idleCount?: unknown; waitingCount?: unknown };
  if (pg && typeof pg.totalCount === 'number' && typeof pg.idleCount === 'number') {
    const waiting = typeof pg.waitingCount === 'number' ? pg.waitingCount : 0;
    return {
      used: pg.totalCount - pg.idleCount,
      idle: pg.idleCount,
      waiting,
      total: pg.totalCount,
    };
  }
  const mysql = d?.pool as {
    _allConnections?: unknown;
    _freeConnections?: unknown;
    _connectionQueue?: unknown;
  };
  const all = lengthOf(mysql?._allConnections);
  const free = lengthOf(mysql?._freeConnections);
  if (all !== null && free !== null) {
    return {
      used: all - free,
      idle: free,
      waiting: lengthOf(mysql?._connectionQueue) ?? 0,
      total: all,
    };
  }
  return null;
}
