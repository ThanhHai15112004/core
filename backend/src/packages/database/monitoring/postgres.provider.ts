import { normalizeSql } from '../instrumentation/sql-normalize.js';
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

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const pid = (id: string) => {
  if (!/^\d+$/.test(id)) throw new Error('Invalid session id');
  return Number(id);
};
const INTERNAL =
  /pg_stat_|pg_catalog|information_schema|^\s*SELECT \$?\d*\s*$|^\s*(SHOW|SET|EXPLAIN)\b/i;

/**
 * PostgreSQL qua pg_stat_activity / pg_locks / pg_stat_user_* và pg_stat_statements (nếu extension đã bật).
 * Chỉ nhìn database + user của app. EXPLAIN không hỗ trợ vì pg_stat_statements lưu câu có tham số ($1).
 */
export class PostgresMonitoringProvider implements DatabaseMonitoringProvider {
  public readonly driver = 'postgres';
  public readonly capabilities: ReadonlySet<MonitoringCapability> = new Set<MonitoringCapability>([
    'serverInfo',
    'sessions',
    'digestStats',
    'transactions',
    'locks',
    'tables',
    'indexUsage',
    'tableIo',
    'storage',
    'cancel',
    'terminate',
  ]);

  public async serverInfo(ctx: MonitoringContext) {
    const [row] = await ctx.run(
      `SELECT current_setting('server_version') AS version, current_setting('max_connections')::int AS max,
              EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::bigint AS uptime`,
    );
    return {
      product: 'PostgreSQL',
      version: String(row?.['version'] ?? ''),
      uptimeSec: toNumber(row?.['uptime']),
      maxConnections: toNumber(row?.['max']),
    };
  }

  public async sessions(ctx: MonitoringContext): Promise<DbSession[]> {
    const rows = await ctx.run(
      `SELECT pid, usename, client_addr::text AS client, application_name AS program, datname, state, query,
              EXTRACT(EPOCH FROM now() - backend_start) AS connected,
              EXTRACT(EPOCH FROM now() - COALESCE(query_start, state_change)) * 1000 AS query_ms,
              EXTRACT(EPOCH FROM now() - xact_start) AS tx,
              pg_blocking_pids(pid) AS blocked_by, pid = pg_backend_pid() AS is_self
         FROM pg_stat_activity
        WHERE datname = current_database() AND usename = current_user AND backend_type = 'client backend'
        ORDER BY pid`,
    );
    return rows.map((r) => {
      const blockedBy = Array.isArray(r['blocked_by'])
        ? (r['blocked_by'] as unknown[]).map(String)
        : [];
      const raw = str(r['state']);
      const state: SessionState = blockedBy.length
        ? 'blocked'
        : raw === 'active'
          ? 'active'
          : raw === 'idle'
            ? 'idle'
            : raw?.startsWith('idle in transaction')
              ? 'idle_in_transaction'
              : 'other';
      const program = str(r['program']);
      return {
        id: String(r['pid']),
        user: str(r['usename']),
        client: str(r['client'])?.replace(/\/\d+$/, '') ?? null,
        program,
        runtime: runtimeOfProgram(program),
        database: str(r['datname']),
        state,
        command: raw,
        connectedSec: toNumber(r['connected']) === null ? null : Math.round(Number(r['connected'])),
        queryMs: toNumber(r['query_ms']) === null ? null : Math.round(Number(r['query_ms'])),
        query:
          state === 'active' || state === 'blocked' ? normalizeSql(String(r['query'] ?? '')) : null,
        transactionSec: toNumber(r['tx']) === null ? null : Math.round(Number(r['tx']) * 10) / 10,
        blockedBy,
        isSelf: r['is_self'] === true || INTERNAL.test(String(r['query'] ?? '')),
      };
    });
  }

  public async digestStats(ctx: MonitoringContext, limit: number): Promise<DbDigestStat[]> {
    const ext = await ctx.run(`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`);
    if (ext.length === 0) throw new Error('pg_stat_statements extension is not installed');
    const rows = await ctx.run(
      `SELECT queryid::text AS id, query, calls, total_exec_time AS total, mean_exec_time AS avg, max_exec_time AS max,
              rows
         FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid
        WHERE d.datname = current_database()
        ORDER BY total_exec_time DESC LIMIT $1`,
      [limit * 3],
    );
    return rows
      .filter((r) => !INTERNAL.test(String(r['query'] ?? '')))
      .slice(0, limit)
      .map((r) => ({
        id: String(r['id']),
        sql: normalizeSql(String(r['query'] ?? '')),
        calls: Number(r['calls'] ?? 0),
        totalMs: Number(r['total'] ?? 0),
        avgMs: Number(r['avg'] ?? 0),
        maxMs: toNumber(r['max']),
        timingReliable: true,
        rowsExamined: null,
        rowsReturned: toNumber(r['rows']),
        errors: 0,
        noIndexUsed: null,
        firstSeen: null,
        lastSeen: null,
        explainable: false,
      }));
  }

  public async explain(): Promise<null> {
    return null;
  }

  public async transactions(ctx: MonitoringContext): Promise<DbTransaction[]> {
    const rows = await ctx.run(
      `SELECT a.pid, a.application_name AS program, a.state, a.query, EXTRACT(EPOCH FROM now() - a.xact_start) AS age,
              current_setting('transaction_isolation') AS isolation,
              (SELECT count(*) FROM pg_locks l WHERE l.pid = a.pid AND l.granted) AS locks
         FROM pg_stat_activity a
        WHERE a.datname = current_database() AND a.usename = current_user AND a.xact_start IS NOT NULL
          AND a.pid <> pg_backend_pid()
        ORDER BY a.xact_start`,
    );
    return rows.map((r) => ({
      id: String(r['pid']),
      sessionId: String(r['pid']),
      runtime: runtimeOfProgram(str(r['program'])),
      state: String(r['state'] ?? ''),
      ageSec: Math.round(Number(r['age'] ?? 0) * 10) / 10,
      isolation: str(r['isolation']),
      locksHeld: toNumber(r['locks']),
      query: r['query'] ? normalizeSql(String(r['query'])) : null,
    }));
  }

  public async lockWaits(ctx: MonitoringContext): Promise<DbLockWait[]> {
    const rows = await ctx.run(
      `SELECT w.pid AS waiting, w.query AS waiting_query, w.application_name AS waiting_program,
              b.pid AS blocking, b.query AS blocking_query, b.application_name AS blocking_program,
              EXTRACT(EPOCH FROM now() - w.query_start) * 1000 AS wait_ms,
              (SELECT l.relation::regclass::text FROM pg_locks l WHERE l.pid = w.pid AND NOT l.granted LIMIT 1) AS object,
              (SELECT l.mode FROM pg_locks l WHERE l.pid = w.pid AND NOT l.granted LIMIT 1) AS mode
         FROM pg_stat_activity w
         JOIN LATERAL unnest(pg_blocking_pids(w.pid)) AS bp(pid) ON true
         JOIN pg_stat_activity b ON b.pid = bp.pid
        WHERE w.datname = current_database()`,
    );
    return rows.map((r) => ({
      waitingSession: String(r['waiting']),
      waitingQuery: r['waiting_query'] ? normalizeSql(String(r['waiting_query'])) : null,
      waitingRuntime: runtimeOfProgram(str(r['waiting_program'])),
      blockingSession: String(r['blocking']),
      blockingQuery: r['blocking_query'] ? normalizeSql(String(r['blocking_query'])) : null,
      blockingRuntime: runtimeOfProgram(str(r['blocking_program'])),
      object: str(r['object']),
      lockMode: str(r['mode']),
      waitMs: toNumber(r['wait_ms']) === null ? null : Math.round(Number(r['wait_ms'])),
    }));
  }

  public async tables(ctx: MonitoringContext): Promise<DbTable[]> {
    const rows = await ctx.run(
      `SELECT relname AS name, n_live_tup AS rows, pg_table_size(relid) AS data, pg_indexes_size(relid) AS idx,
              COALESCE(seq_tup_read, 0) + COALESCE(idx_tup_fetch, 0) AS reads,
              COALESCE(n_tup_ins, 0) + COALESCE(n_tup_upd, 0) + COALESCE(n_tup_del, 0) AS writes
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`,
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
      engine: null,
      reads: toNumber(r['reads']),
      writes: toNumber(r['writes']),
    };
  }

  public async tableDetail(ctx: MonitoringContext, name: string): Promise<DbTableDetail | null> {
    const table = (await this.tables(ctx)).find((t) => t.name === name);
    if (!table) return null;
    const [columns, indexes] = await Promise.all([
      ctx.run(
        `SELECT column_name AS name, data_type AS type, is_nullable AS nullable
           FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
        [name],
      ),
      ctx.run(
        `SELECT i.indexrelname AS name, i.idx_scan AS scans, pg_relation_size(i.indexrelid) AS size,
                x.indisunique AS unique, x.indisprimary AS primary,
                array(SELECT a.attname FROM pg_attribute a WHERE a.attrelid = x.indrelid AND a.attnum = ANY(x.indkey)) AS columns
           FROM pg_stat_user_indexes i JOIN pg_index x ON x.indexrelid = i.indexrelid
          WHERE i.relname = $1`,
        [name],
      ),
    ]);
    return {
      ...table,
      columns: columns.map((c) => ({
        name: String(c['name']),
        type: String(c['type']),
        nullable: c['nullable'] === 'YES',
      })),
      indexes: indexes.map((i): DbIndex => ({
        name: String(i['name']),
        columns: Array.isArray(i['columns']) ? (i['columns'] as unknown[]).map(String) : [],
        unique: i['unique'] === true,
        primary: i['primary'] === true,
        scans: toNumber(i['scans']),
        sizeBytes: toNumber(i['size']),
      })),
    };
  }

  public async storage(ctx: MonitoringContext) {
    const [row] = await ctx.run(
      `SELECT pg_database_size(current_database()) AS total,
              (SELECT COALESCE(sum(pg_table_size(relid)), 0) FROM pg_stat_user_tables) AS data,
              (SELECT COALESCE(sum(pg_indexes_size(relid)), 0) FROM pg_stat_user_tables) AS idx,
              (SELECT count(*) FROM pg_stat_user_tables) AS tables`,
    );
    return {
      totalBytes: toNumber(row?.['total']),
      dataBytes: toNumber(row?.['data']),
      indexBytes: toNumber(row?.['idx']),
      tables: Number(row?.['tables'] ?? 0),
    };
  }

  public async cancel(ctx: MonitoringContext, id: string): Promise<void> {
    await ctx.run('SELECT pg_cancel_backend($1)', [pid(id)]);
  }

  public async terminate(ctx: MonitoringContext, id: string): Promise<void> {
    await ctx.run('SELECT pg_terminate_backend($1)', [pid(id)]);
  }
}
