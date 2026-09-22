import { normalizeSql } from '../instrumentation/sql-normalize.js';
import { parseMysqlExplain } from './mysql-explain.js';
import {
  runtimeOfProgram,
  toNumber,
  type DatabaseMonitoringProvider,
  type DbDigestStat,
  type DbIndex,
  type DbLockWait,
  type DbSession,
  type DbTable,
  type DbTableDetail,
  type DbTransaction,
  type MonitoringCapability,
  type MonitoringContext,
  type SessionState,
} from './monitoring.types.js';

/** performance_schema dùng picosecond. */
const PS_PER_MS = 1e9;
/**
 * Timer ≥ 2^63 ps (~106 ngày) chỉ xuất hiện khi bộ đếm unsigned bị tràn do đồng hồ trả thời lượng âm
 * (hay gặp trên VM/WSL) → coi là không đáng tin.
 */
const TIMER_OVERFLOW = 2 ** 63;
const timerMs = (v: unknown): number | null => {
  const n = toNumber(v);
  return n === null || n >= TIMER_OVERFLOW ? null : n / PS_PER_MS;
};
/** Câu của chính Console (đọc performance_schema/information_schema, health check) không phải query của app. */
const INTERNAL_DIGEST =
  /performance_schema|information_schema|`?sys`?\s*\.|@@|^\s*(SHOW|EXPLAIN|SET|KILL)\b|^\s*SELECT \?\s*$|^\s*SELECT `?(VERSION|CONNECTION_ID|CURRENT_USER)`?\s*\(/i;
const EXPLAINABLE = /^\s*(SELECT|WITH)\b/i;
const UNSAFE_FOR_EXPLAIN = /\b(INTO|FOR\s+UPDATE|FOR\s+SHARE|LOCK\s+IN\s+SHARE\s+MODE)\b/i;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** Epoch giây do server tính (`UNIX_TIMESTAMP`) → ISO; tránh lệch múi giờ của DATETIME. */
const iso = (v: unknown): string | null => {
  const sec = toNumber(v);
  return sec === null || sec <= 0 ? null : new Date(sec * 1000).toISOString();
};
const sessionId = (id: string) => {
  if (!/^\d+$/.test(id)) throw new Error('Invalid session id');
  return id;
};

/**
 * MySQL 8 qua performance_schema + information_schema. Chạy được với user CHỈ có quyền trên database của app
 * và SELECT performance_schema (không cần PROCESS) — mọi truy vấn lọc theo user + database của app.
 */
export class MysqlMonitoringProvider implements DatabaseMonitoringProvider {
  public readonly driver = 'mysql';
  public readonly capabilities: ReadonlySet<MonitoringCapability> = new Set<MonitoringCapability>([
    'serverInfo',
    'sessions',
    'digestStats',
    'explain',
    'transactions',
    'locks',
    'tables',
    'indexUsage',
    'tableIo',
    'storage',
    'cancel',
    'terminate',
  ]);

  public async prepare(ctx: MonitoringContext): Promise<void> {
    // information_schema.TABLES mặc định cache thống kê 24h → đọc số mới nhất cho session này.
    await ctx.run('SET SESSION information_schema_stats_expiry = 0').catch(() => undefined);
  }

  public async serverInfo(ctx: MonitoringContext) {
    const [row] = await ctx.run('SELECT VERSION() AS version, @@max_connections AS maxConnections');
    const uptime = await ctx.run("SHOW GLOBAL STATUS LIKE 'Uptime'").catch(() => [] as Row[]);
    const version = str(row?.['version']) ?? '';
    return {
      product: /mariadb/i.test(version) ? 'MariaDB' : 'MySQL',
      version,
      uptimeSec: toNumber(uptime[0]?.['Value']),
      maxConnections: toNumber(row?.['maxConnections']),
    };
  }

  public async sessions(ctx: MonitoringContext): Promise<DbSession[]> {
    const rows = await ctx.run(
      `SELECT t.PROCESSLIST_ID AS id, t.PROCESSLIST_USER AS user, t.PROCESSLIST_HOST AS host, t.PROCESSLIST_DB AS db,
              t.PROCESSLIST_COMMAND AS command, t.PROCESSLIST_TIME AS time, t.PROCESSLIST_STATE AS state,
              t.PROCESSLIST_INFO AS info, s.TIMER_WAIT AS stmtWait, s.END_EVENT_ID AS stmtEnded,
              tx.TIMER_WAIT AS txWait, tx.STATE AS txState, tx.AUTOCOMMIT AS autocommit,
              (SELECT a.ATTR_VALUE FROM performance_schema.session_connect_attrs a
                WHERE a.PROCESSLIST_ID = t.PROCESSLIST_ID AND a.ATTR_NAME = 'program_name' LIMIT 1) AS program,
              t.PROCESSLIST_ID = CONNECTION_ID() AS isSelf
         FROM performance_schema.threads t
         LEFT JOIN performance_schema.events_statements_current s ON s.THREAD_ID = t.THREAD_ID
         LEFT JOIN performance_schema.events_transactions_current tx ON tx.THREAD_ID = t.THREAD_ID
        WHERE t.TYPE = 'FOREGROUND' AND t.PROCESSLIST_USER = ? AND (t.PROCESSLIST_DB = ? OR t.PROCESSLIST_DB IS NULL)
        ORDER BY t.PROCESSLIST_ID`,
      [ctx.user, ctx.database],
    );
    const waits = await this.lockWaits(ctx).catch(() => [] as DbLockWait[]);
    return rows.map((r) => {
      const id = String(r['id']);
      const command = str(r['command']);
      const inTx = r['txState'] === 'ACTIVE' && r['autocommit'] === 'NO';
      const running = command === 'Query' && !r['stmtEnded'];
      const blockedBy = waits.filter((w) => w.waitingSession === id).map((w) => w.blockingSession);
      const state: SessionState = blockedBy.length
        ? 'blocked'
        : running
          ? 'active'
          : command === 'Sleep'
            ? inTx
              ? 'idle_in_transaction'
              : 'idle'
            : 'other';
      const stmtMs = timerMs(r['stmtWait']);
      const txMs = timerMs(r['txWait']);
      const program = str(r['program']);
      return {
        id,
        user: str(r['user']),
        client: str(r['host'])?.replace(/:\d+$/, '') ?? null,
        program,
        runtime: runtimeOfProgram(program),
        database: str(r['db']),
        state,
        command,
        connectedSec: null,
        queryMs:
          running && stmtMs !== null ? Math.round(stmtMs) : (toNumber(r['time']) ?? 0) * 1000,
        query: running && r['info'] ? normalizeSql(String(r['info'])) : null,
        transactionSec: inTx && txMs !== null ? Math.round(txMs / 100) / 10 : null,
        blockedBy,
        // Connection của chính Console (đang đọc số liệu) không phải tải của app.
        isSelf: Number(r['isSelf']) === 1 || INTERNAL_DIGEST.test(String(r['info'] ?? '')),
      };
    });
  }

  public async digestStats(ctx: MonitoringContext, limit: number): Promise<DbDigestStat[]> {
    const rows = await ctx.run(
      `SELECT DIGEST AS id, DIGEST_TEXT AS sqlText, COUNT_STAR AS calls, SUM_TIMER_WAIT AS total, AVG_TIMER_WAIT AS avg,
              MAX_TIMER_WAIT AS max, SUM_ROWS_EXAMINED AS examined, SUM_ROWS_SENT AS sent, SUM_ERRORS AS errors,
              SUM_NO_INDEX_USED AS noIndex, UNIX_TIMESTAMP(FIRST_SEEN) AS firstSeen, UNIX_TIMESTAMP(LAST_SEEN) AS lastSeen,
              QUERY_SAMPLE_TEXT AS sample, (CHAR_LENGTH(QUERY_SAMPLE_TEXT) >= @@performance_schema_max_sql_text_length) AS truncated
         FROM performance_schema.events_statements_summary_by_digest
        WHERE SCHEMA_NAME = ? AND DIGEST IS NOT NULL
        ORDER BY SUM_TIMER_WAIT DESC
        LIMIT ?`,
      [ctx.database, limit * 3],
    );
    return rows
      .filter((r) => !INTERNAL_DIGEST.test(String(r['sqlText'] ?? '')))
      .slice(0, limit)
      .map((r) => this.digestOf(r));
  }

  private digestOf(r: Row): DbDigestStat {
    const sample = String(r['sample'] ?? '');
    const total = timerMs(r['total']);
    const reliable = total !== null && timerMs(r['max']) !== null;
    return {
      id: String(r['id']),
      sql: String(r['sqlText'] ?? ''),
      calls: Number(r['calls'] ?? 0),
      totalMs: reliable ? total : null,
      avgMs: reliable ? timerMs(r['avg']) : null,
      maxMs: reliable ? timerMs(r['max']) : null,
      timingReliable: reliable,
      rowsExamined: toNumber(r['examined']),
      rowsReturned: toNumber(r['sent']),
      errors: Number(r['errors'] ?? 0),
      noIndexUsed: toNumber(r['noIndex']),
      firstSeen: iso(r['firstSeen']),
      lastSeen: iso(r['lastSeen']),
      explainable:
        EXPLAINABLE.test(sample) &&
        !UNSAFE_FOR_EXPLAIN.test(sample) &&
        Number(r['truncated']) !== 1,
    };
  }

  public async explain(ctx: MonitoringContext, digestId: string) {
    if (!/^[0-9a-f]{32,64}$/i.test(digestId)) return null;
    const [row] = await ctx.run(
      `SELECT QUERY_SAMPLE_TEXT AS sample, (CHAR_LENGTH(QUERY_SAMPLE_TEXT) >= @@performance_schema_max_sql_text_length) AS truncated
         FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME = ? AND DIGEST = ? LIMIT 1`,
      [ctx.database, digestId],
    );
    const sample = String(row?.['sample'] ?? '');
    // EXPLAIN (không ANALYZE) không thực thi câu lệnh; chỉ cho SELECT/WITH đầy đủ.
    if (
      !sample ||
      Number(row?.['truncated']) === 1 ||
      !EXPLAINABLE.test(sample) ||
      UNSAFE_FOR_EXPLAIN.test(sample)
    )
      return null;
    const [plan] = await ctx.run(`EXPLAIN FORMAT=JSON ${sample}`);
    return parseMysqlExplain(plan?.['EXPLAIN'] ?? Object.values(plan ?? {})[0]);
  }

  public async transactions(ctx: MonitoringContext): Promise<DbTransaction[]> {
    const rows = await ctx.run(
      `SELECT tx.THREAD_ID AS threadId, tx.EVENT_ID AS eventId, t.PROCESSLIST_ID AS sessionId, tx.STATE AS state,
              tx.TIMER_WAIT AS wait, tx.ISOLATION_LEVEL AS isolation, t.PROCESSLIST_INFO AS info,
              (SELECT a.ATTR_VALUE FROM performance_schema.session_connect_attrs a
                WHERE a.PROCESSLIST_ID = t.PROCESSLIST_ID AND a.ATTR_NAME = 'program_name' LIMIT 1) AS program,
              (SELECT COUNT(*) FROM performance_schema.data_locks l
                WHERE l.THREAD_ID = tx.THREAD_ID AND l.OBJECT_SCHEMA = ?) AS locks
         FROM performance_schema.events_transactions_current tx
         JOIN performance_schema.threads t ON t.THREAD_ID = tx.THREAD_ID
        WHERE tx.STATE = 'ACTIVE' AND tx.AUTOCOMMIT = 'NO' AND t.PROCESSLIST_USER = ?
          AND (t.PROCESSLIST_DB = ? OR t.PROCESSLIST_DB IS NULL) AND t.PROCESSLIST_ID <> CONNECTION_ID()
        ORDER BY tx.TIMER_WAIT DESC`,
      [ctx.database, ctx.user, ctx.database],
    );
    return rows.map((r) => ({
      id: `${r['threadId']}:${r['eventId']}`,
      sessionId: str(r['sessionId']),
      runtime: runtimeOfProgram(str(r['program'])),
      state: String(r['state'] ?? 'ACTIVE').toLowerCase(),
      ageSec: Math.round((timerMs(r['wait']) ?? 0) / 100) / 10,
      isolation: str(r['isolation']),
      locksHeld: toNumber(r['locks']),
      query: r['info'] ? normalizeSql(String(r['info'])) : null,
    }));
  }

  public async lockWaits(ctx: MonitoringContext): Promise<DbLockWait[]> {
    const rows = await ctx.run(
      `SELECT rt.PROCESSLIST_ID AS waiting, rt.PROCESSLIST_INFO AS waitingInfo, rt.PROCESSLIST_TIME AS waitingTime,
              bt.PROCESSLIST_ID AS blocking, bt.PROCESSLIST_INFO AS blockingInfo,
              rl.OBJECT_NAME AS object, rl.LOCK_MODE AS lockMode,
              (SELECT a.ATTR_VALUE FROM performance_schema.session_connect_attrs a
                WHERE a.PROCESSLIST_ID = rt.PROCESSLIST_ID AND a.ATTR_NAME = 'program_name' LIMIT 1) AS waitingProgram,
              (SELECT a.ATTR_VALUE FROM performance_schema.session_connect_attrs a
                WHERE a.PROCESSLIST_ID = bt.PROCESSLIST_ID AND a.ATTR_NAME = 'program_name' LIMIT 1) AS blockingProgram
         FROM performance_schema.data_lock_waits w
         JOIN performance_schema.data_locks rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
         JOIN performance_schema.threads rt ON rt.THREAD_ID = w.REQUESTING_THREAD_ID
         JOIN performance_schema.threads bt ON bt.THREAD_ID = w.BLOCKING_THREAD_ID
        WHERE rl.OBJECT_SCHEMA = ?`,
      [ctx.database],
    );
    return rows.map((r) => ({
      waitingSession: String(r['waiting']),
      waitingQuery: r['waitingInfo'] ? normalizeSql(String(r['waitingInfo'])) : null,
      waitingRuntime: runtimeOfProgram(str(r['waitingProgram'])),
      blockingSession: String(r['blocking']),
      blockingQuery: r['blockingInfo'] ? normalizeSql(String(r['blockingInfo'])) : null,
      blockingRuntime: runtimeOfProgram(str(r['blockingProgram'])),
      object: str(r['object']),
      lockMode: str(r['lockMode']),
      waitMs: toNumber(r['waitingTime']) === null ? null : Number(r['waitingTime']) * 1000,
    }));
  }

  public async tables(ctx: MonitoringContext): Promise<DbTable[]> {
    const rows = await ctx.run(
      `SELECT t.TABLE_NAME AS name, t.TABLE_ROWS AS \`rows\`, t.DATA_LENGTH AS data, t.INDEX_LENGTH AS idx, t.ENGINE AS engine,
              io.COUNT_READ AS \`reads\`, io.COUNT_WRITE AS \`writes\`
         FROM information_schema.TABLES t
         LEFT JOIN performance_schema.table_io_waits_summary_by_table io
           ON io.OBJECT_SCHEMA = t.TABLE_SCHEMA AND io.OBJECT_NAME = t.TABLE_NAME
        WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY (t.DATA_LENGTH + t.INDEX_LENGTH) DESC`,
      [ctx.database],
    );
    return rows.map((r) => this.tableOf(r));
  }

  private tableOf(r: Row): DbTable {
    const data = toNumber(r['data']);
    const idx = toNumber(r['idx']);
    return {
      name: String(r['name']),
      rows: toNumber(r['rows']),
      dataBytes: data,
      indexBytes: idx,
      totalBytes: data === null && idx === null ? null : (data ?? 0) + (idx ?? 0),
      engine: str(r['engine']),
      reads: toNumber(r['reads']),
      writes: toNumber(r['writes']),
    };
  }

  public async tableDetail(ctx: MonitoringContext, name: string): Promise<DbTableDetail | null> {
    const table = (await this.tables(ctx)).find((t) => t.name === name);
    if (!table) return null;
    const [columns, stats, usage] = await Promise.all([
      ctx.run(
        `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [ctx.database, name],
      ),
      ctx.run(
        `SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS nonUnique
           FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [ctx.database, name],
      ),
      ctx.run(
        `SELECT INDEX_NAME AS name, COUNT_STAR AS scans
           FROM performance_schema.table_io_waits_summary_by_index_usage
          WHERE OBJECT_SCHEMA = ? AND OBJECT_NAME = ? AND INDEX_NAME IS NOT NULL`,
        [ctx.database, name],
      ),
    ]);
    const indexes = new Map<string, DbIndex>();
    for (const s of stats) {
      const key = String(s['name']);
      const index = indexes.get(key) ?? {
        name: key,
        columns: [],
        unique: Number(s['nonUnique']) === 0,
        primary: key === 'PRIMARY',
        scans: toNumber(usage.find((u) => u['name'] === key)?.['scans']),
        sizeBytes: null,
      };
      index.columns.push(String(s['col']));
      indexes.set(key, index);
    }
    return {
      ...table,
      columns: columns.map((c) => ({
        name: String(c['name']),
        type: String(c['type']),
        nullable: c['nullable'] === 'YES',
      })),
      indexes: [...indexes.values()],
    };
  }

  public async storage(ctx: MonitoringContext) {
    const [row] = await ctx.run(
      `SELECT COUNT(*) AS tables, SUM(DATA_LENGTH) AS data, SUM(INDEX_LENGTH) AS idx
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [ctx.database],
    );
    const data = toNumber(row?.['data']) ?? 0;
    const idx = toNumber(row?.['idx']) ?? 0;
    return {
      totalBytes: data + idx,
      dataBytes: data,
      indexBytes: idx,
      tables: Number(row?.['tables'] ?? 0),
    };
  }

  public async cancel(ctx: MonitoringContext, id: string): Promise<void> {
    await ctx.run(`KILL QUERY ${sessionId(id)}`);
  }

  public async terminate(ctx: MonitoringContext, id: string): Promise<void> {
    await ctx.run(`KILL ${sessionId(id)}`);
  }
}
