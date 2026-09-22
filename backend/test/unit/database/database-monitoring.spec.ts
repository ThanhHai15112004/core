import { describe, it, expect } from '@jest/globals';
import {
  MysqlMonitoringProvider,
  classifyDbError,
  parseMysqlExplain,
  retryDelayMs,
  runtimeOfProgram,
  sanitizeDbMessage,
  type MonitoringContext,
} from '@packages/database/index.js';
import {
  buildBlockingChains,
  diffAlerts,
  evaluateDbRules,
  type DbRuleInput,
} from '@modules/database-ops/index.js';

describe('classifyDbError / sanitizeDbMessage', () => {
  it('phân loại lỗi theo mã của mysql2 và pg', () => {
    expect(classifyDbError({ code: 'ER_LOCK_DEADLOCK', errno: 1213 })).toBe('deadlock');
    expect(classifyDbError({ code: '40P01' })).toBe('deadlock');
    expect(classifyDbError({ code: 'ER_LOCK_WAIT_TIMEOUT' })).toBe('lock_timeout');
    expect(classifyDbError({ code: 'ECONNREFUSED' })).toBe('connection');
    expect(classifyDbError({ code: '08006' })).toBe('connection');
    expect(classifyDbError({ code: 'ER_QUERY_INTERRUPTED' })).toBe('cancelled');
    expect(classifyDbError({ driverError: { code: 'ETIMEDOUT' } })).toBe('timeout');
    expect(classifyDbError({ code: 'ER_PARSE_ERROR' })).toBe('query');
  });

  it('bỏ literal khỏi message lỗi (không lộ dữ liệu)', () => {
    expect(
      sanitizeDbMessage(new Error("Duplicate entry 'alice@example.com' for key 'users.email'")),
    ).toBe("Duplicate entry '?' for key '?'");
  });
});

describe('retryDelayMs / runtimeOfProgram', () => {
  it('backoff lũy thừa có trần 30s', () => {
    expect([1, 2, 3, 6, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 30000, 30000]);
  });
  it('map program_name về runtime', () => {
    expect(runtimeOfProgram('core-worker')).toBe('worker');
    expect(runtimeOfProgram('mysql')).toBeNull();
    expect(runtimeOfProgram(null)).toBeNull();
  });
});

describe('parseMysqlExplain', () => {
  it('trải cây plan thành các bước và gắn cờ full scan / filesort / temporary', () => {
    const plan = parseMysqlExplain({
      query_block: {
        cost_info: { query_cost: '511.15' },
        ordering_operation: {
          using_filesort: true,
          grouping_operation: {
            using_temporary_table: true,
            nested_loop: [
              {
                table: {
                  table_name: 'u',
                  access_type: 'ALL',
                  rows_examined_per_scan: 30000,
                  filtered: '10.00',
                  cost_info: { prefix_cost: '301.00' },
                },
              },
              {
                table: {
                  table_name: 'o',
                  access_type: 'ref',
                  key: 'idx_user',
                  possible_keys: ['idx_user'],
                  rows_examined_per_scan: 1,
                },
              },
            ],
          },
        },
      },
    });
    expect(plan.totalCost).toBe(511.15);
    expect(plan.steps.map((s) => [s.depth, s.operation, s.table, s.flags])).toEqual([
      [0, 'ORDER BY', null, ['filesort']],
      [1, 'GROUP BY', null, ['temporary']],
      [2, 'Full table scan', 'u', ['full_scan', 'no_index', 'high_rows']],
      [2, 'Index lookup', 'o', []],
    ]);
  });
});

describe('MysqlMonitoringProvider', () => {
  const ctxOf = (rows: Record<string, unknown>[][]): MonitoringContext & { sql: string[] } => {
    const sql: string[] = [];
    let i = 0;
    return {
      sql,
      database: 'core_db',
      user: 'core',
      run: (async (q: string) => {
        sql.push(q);
        return rows[i++] ?? [];
      }) as MonitoringContext['run'],
    };
  };
  const provider = new MysqlMonitoringProvider();

  it('digest: timer bị tràn (≥ 2^63 ps) → thời gian không đáng tin, không hiện số sai', async () => {
    const ctx = ctxOf([
      [
        {
          id: 'a'.repeat(64),
          sqlText: 'SELECT * FROM `t` WHERE `id` = ?',
          calls: 10,
          total: '18446738456520179616',
          avg: '1',
          max: '18446737904709491616',
          sample: 'SELECT * FROM t WHERE id = 1',
          truncated: 0,
        },
        {
          id: 'b'.repeat(64),
          sqlText: 'UPDATE `t` SET `x` = ?',
          calls: 2,
          total: 4_000_000_000,
          avg: 2_000_000_000,
          max: 3_000_000_000,
          sample: 'UPDATE t SET x = 1',
          truncated: 0,
        },
        {
          id: 'c'.repeat(64),
          sqlText: 'SELECT * FROM performance_schema . threads',
          calls: 99,
          total: 1,
          avg: 1,
          max: 1,
        },
      ],
    ]);
    const stats = await provider.digestStats(ctx, 10);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({
      timingReliable: false,
      avgMs: null,
      totalMs: null,
      explainable: true,
    });
    expect(stats[1]).toMatchObject({
      timingReliable: true,
      avgMs: 2,
      totalMs: 4,
      maxMs: 3,
      explainable: false,
    });
    expect(ctx.sql[0]).toContain('SCHEMA_NAME = ?');
  });

  it('explain chỉ chạy cho SELECT đầy đủ, không cho câu ghi / FOR UPDATE', async () => {
    const write = ctxOf([[{ sample: 'DELETE FROM t', truncated: 0 }]]);
    expect(await provider.explain(write, 'a'.repeat(32))).toBeNull();
    expect(write.sql).toHaveLength(1);
    const forUpdate = ctxOf([[{ sample: 'SELECT * FROM t FOR UPDATE', truncated: 0 }]]);
    expect(await provider.explain(forUpdate, 'a'.repeat(32))).toBeNull();
    expect(await provider.explain(ctxOf([]), "x'; DROP TABLE t; --")).toBeNull();
  });

  it('cancel/terminate chỉ nhận id số', async () => {
    const ctx = ctxOf([]);
    await provider.cancel(ctx, '42');
    expect(ctx.sql).toEqual(['KILL QUERY 42']);
    await expect(provider.terminate(ctx, '1; DROP TABLE t')).rejects.toThrow('Invalid session id');
  });

  it('session: bị chặn, đang chạy, connection của Console được đánh dấu isSelf', async () => {
    const ctx = ctxOf([
      [
        {
          id: 7,
          user: 'core',
          host: '10.0.0.2:5123',
          db: 'core_db',
          command: 'Query',
          time: 3,
          info: "UPDATE t SET a = 'x' WHERE id = 1",
          stmtWait: 3_200_000_000_000,
          stmtEnded: null,
          txState: 'ACTIVE',
          autocommit: 'NO',
          txWait: 5_000_000_000_000,
          program: 'core-worker',
          isSelf: 0,
        },
        {
          id: 8,
          user: 'core',
          host: 'localhost',
          db: 'core_db',
          command: 'Query',
          time: 0,
          info: 'SELECT * FROM performance_schema.threads',
          stmtWait: 1,
          stmtEnded: null,
          program: 'core-api',
          isSelf: 0,
        },
        {
          id: 9,
          user: 'core',
          host: 'localhost',
          db: 'core_db',
          command: 'Sleep',
          time: 40,
          info: null,
          stmtEnded: 5,
          txState: 'COMMITTED',
          autocommit: 'YES',
          program: 'core-api',
          isSelf: 0,
        },
      ],
      [
        {
          waiting: 7,
          blocking: 9,
          waitingInfo: 'UPDATE t',
          blockingInfo: null,
          object: 't',
          lockMode: 'X',
          waitingTime: 3,
        },
      ],
    ]);
    const sessions = await provider.sessions(ctx);
    expect(sessions.map((s) => [s.id, s.runtime, s.state, s.isSelf])).toEqual([
      ['7', 'worker', 'blocked', false],
      ['8', 'api', 'active', true],
      ['9', 'api', 'idle', false],
    ]);
    expect(sessions[0]).toMatchObject({
      client: '10.0.0.2',
      queryMs: 3200,
      transactionSec: 5,
      blockedBy: ['9'],
    });
    expect(sessions[0]!.query).toBe('UPDATE t SET a = ? WHERE id = ?');
  });
});

describe('evaluateDbRules / diffAlerts', () => {
  const cfg = {
    db: { slowQueryAlertCount: 10, longTransactionSec: 10, storageWarnPercent: 80 },
    dbP95Ms: { warn: 300, crit: 1000 },
    dbPoolPercent: { warn: 85, crit: 95 },
    errorRatePercent: { warn: 2, crit: 10 },
    minQueries: 20,
  };
  const base: DbRuleInput = {
    connection: 'connected',
    pool: { used: 2, limit: 10, waiting: 0 },
    queries: 100,
    p95Ms: 40,
    errorRatePercent: 0,
    slowQueries15m: 0,
    longestTransactionSec: 1,
    lockWaits: { count: 0, maxWaitMs: 0 },
    storage: { bytes: 10, limitBytes: null },
  };

  it('khoẻ → không cảnh báo; mất kết nối → chỉ DB_UNAVAILABLE', () => {
    expect(evaluateDbRules(base, cfg)).toEqual([]);
    expect(
      evaluateDbRules({ ...base, connection: 'unavailable', p95Ms: 5000 }, cfg).map((v) => v.id),
    ).toEqual(['DB_UNAVAILABLE']);
  });

  it('pool, latency, transaction dài, lock, storage', () => {
    const v = evaluateDbRules(
      {
        ...base,
        pool: { used: 9.6, limit: 10, waiting: 3 },
        p95Ms: 400,
        longestTransactionSec: 70,
        lockWaits: { count: 2, maxWaitMs: 1000 },
        storage: { bytes: 85, limitBytes: 100 },
        slowQueries15m: 12,
      },
      cfg,
    );
    expect(v.map((x) => [x.id, x.severity])).toEqual([
      ['POOL_PRESSURE', 'critical'],
      ['LONG_TRANSACTION', 'critical'],
      ['POOL_WAITING', 'warning'],
      ['QUERY_LATENCY', 'warning'],
      ['SLOW_QUERIES', 'warning'],
      ['LOCK_WAITS', 'warning'],
      ['STORAGE', 'warning'],
    ]);
  });

  it('không kết luận latency khi quá ít query', () => {
    expect(evaluateDbRules({ ...base, queries: 3, p95Ms: 9000 }, cfg)).toEqual([]);
  });

  it('diffAlerts: bắt đầu, giữ nguyên thời điểm since, hồi phục', () => {
    const v = evaluateDbRules({ ...base, p95Ms: 400 }, cfg);
    const first = diffAlerts(v, new Map(), 1000);
    expect(first.started.map((s) => s.id)).toEqual(['QUERY_LATENCY']);
    const second = diffAlerts(v, first.set, 5000);
    expect(second.started).toEqual([]);
    expect(second.set.get('QUERY_LATENCY')!.since).toBe(1000);
    const done = diffAlerts([], second.set, 61_000);
    expect(done.recovered).toEqual([{ id: 'QUERY_LATENCY', durationMs: 60_000 }]);
  });
});

describe('buildBlockingChains', () => {
  const w = (waiting: string, blocking: string) => ({
    waitingSession: waiting,
    waitingQuery: `q${waiting}`,
    waitingRuntime: 'api',
    blockingSession: blocking,
    blockingQuery: `q${blocking}`,
    blockingRuntime: 'worker',
    object: 'orders',
    lockMode: 'X',
    waitMs: 100,
  });

  it('dựng cây chặn từ gốc (session chặn nhưng không bị chặn)', () => {
    const [root] = buildBlockingChains([w('2', '1'), w('3', '2'), w('4', '1')]);
    expect(root!.session).toBe('1');
    expect(root!.children.map((c) => c.session)).toEqual(['2', '4']);
    expect(root!.children[0]!.children.map((c) => c.session)).toEqual(['3']);
  });

  it('vòng khoá (deadlock đang hình thành) không lặp vô hạn', () => {
    const chains = buildBlockingChains([w('1', '2'), w('2', '1')]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.children[0]!.children).toEqual([]);
  });
});
