export type DbRange = '15m' | '1h' | '6h' | '24h';
export type DbHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown' | 'disabled';
export type DbMetric = 'queries' | 'latency' | 'connections' | 'errors' | 'transactions';
export type DbTab = 'overview' | 'queries' | 'connections' | 'transactions' | 'tables' | 'migrations' | 'errors' | 'configuration';
export type MonitoringCapability =
  | 'serverInfo'
  | 'sessions'
  | 'digestStats'
  | 'explain'
  | 'transactions'
  | 'locks'
  | 'tables'
  | 'indexUsage'
  | 'tableIo'
  | 'storage'
  | 'cancel'
  | 'terminate';

export type Section<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

export interface DbSession {
  id: string;
  user: string | null;
  client: string | null;
  program: string | null;
  runtime: string | null;
  database: string | null;
  state: 'active' | 'idle' | 'idle_in_transaction' | 'blocked' | 'other';
  command: string | null;
  connectedSec: number | null;
  queryMs: number | null;
  query: string | null;
  transactionSec: number | null;
  blockedBy: string[];
  isSelf: boolean;
}

export interface DbServerInfo {
  product: string;
  version: string;
  uptimeSec: number | null;
  maxConnections: number | null;
}

export interface DbTable {
  name: string;
  rows: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  totalBytes: number | null;
  engine: string | null;
  reads: number | null;
  writes: number | null;
  growthPercent: number | null;
  readsPerSec?: number | null;
  writesPerSec?: number | null;
}

export interface DbAlert {
  id: string;
  rule: string;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string | null;
  tab: DbTab;
}

export interface DbEvent {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: DbTab | null;
}

export interface DbPool {
  used: number | null;
  idle: number | null;
  waiting: number | null;
  limit: number;
  percent: number | null;
  peakToday: number | null;
}

export interface DbReport {
  queries: number;
  avgMs: number | null;
  p95Ms: number | null;
  slowQueries: number;
  failedQueries: number;
  peakConnections: number | null;
  deadlocks: number;
  growthBytes: number | null;
}

export interface DbConnectionError {
  code: string | null;
  message: string;
}

export interface DbOverview {
  generatedAt: string;
  range: DbRange;
  driver: string;
  environment: string;
  database: string;
  capabilities: MonitoringCapability[];
  health: {
    status: DbHealthStatus;
    reasons: { code: string; message: string }[];
    since: string;
    lastSuccessAt: string | null;
    pingMs: number | null;
    lastError: DbConnectionError | null;
  };
  server: Section<DbServerInfo>;
  runtimes: {
    instance: string;
    runtime: string;
    state: string;
    lastPingMs: number | null;
    lastSuccessAt: string | null;
    lastError: DbConnectionError | null;
  }[];
  kpis: {
    connections: { used: number | null; limit: number; percent: number | null };
    sessions: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    queriesPerSec: number | null;
    errorRatePercent: number | null;
    failedQueries: number;
    slowQueries: number;
    activeTransactions: number | null;
    lockWaits: number | null;
    deadlocks24h: number;
    sizeBytes: number | null;
  };
  pool: DbPool;
  alerts: DbAlert[];
  liveQueries: Section<DbSession[]>;
  transactions: { active: number | null; longestSec: number | null; committedPerMin: number | null; rolledBackPerMin: number | null };
  largestTables: Section<DbTable[]>;
  report: { today: DbReport; yesterday: DbReport };
  events: DbEvent[];
  settings: { slowQueryMs: number; longTransactionSec: number; actionsEnabled: boolean; migrationsEnabled: boolean };
}

export interface DbSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface DbMetrics {
  metric: DbMetric;
  range: DbRange;
  resolutionSec: number | null;
  unit: string;
  series: DbSeries[];
}

export interface DbQueryStat {
  id: string;
  sql: string;
  calls: number;
  totalMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  timingReliable: boolean;
  rowsExamined: number | null;
  rowsReturned: number | null;
  errors: number;
  noIndexUsed: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  explainable: boolean;
  rangeCalls: number | null;
  rangeAvgMs: number | null;
  slow: boolean;
}

export interface DbQueryDetail {
  stat: DbQueryStat;
  history: { calls: DbSeries; avgMs: DbSeries };
  relatedSlow: { at: number; durationMs: number; correlationId: string | null; instance: string }[];
}

export type ExplainFlag = 'full_scan' | 'high_rows' | 'filesort' | 'temporary' | 'no_index';

export interface DbExplain {
  available: boolean;
  reason: string | null;
  plan: {
    totalCost: number | null;
    steps: {
      depth: number;
      operation: string;
      table: string | null;
      accessType: string | null;
      key: string | null;
      possibleKeys: string[];
      rows: number | null;
      filteredPercent: number | null;
      cost: number | null;
      condition: string | null;
      flags: ExplainFlag[];
    }[];
  } | null;
}

export interface DbTransaction {
  id: string;
  sessionId: string | null;
  runtime: string | null;
  state: string;
  ageSec: number;
  isolation: string | null;
  locksHeld: number | null;
  query: string | null;
}

export interface DbLockWait {
  waitingSession: string;
  waitingQuery: string | null;
  waitingRuntime: string | null;
  blockingSession: string;
  blockingQuery: string | null;
  blockingRuntime: string | null;
  object: string | null;
  lockMode: string | null;
  waitMs: number | null;
}

export interface BlockingNode {
  session: string;
  runtime: string | null;
  query: string | null;
  waitMs: number | null;
  object: string | null;
  lockMode: string | null;
  children: BlockingNode[];
}

export interface DbErrorRecord {
  at: string;
  kind: 'query' | 'timeout' | 'connection' | 'deadlock' | 'lock_timeout' | 'cancelled';
  code: string | null;
  message: string;
  sql: string;
  runtime: string | null;
  correlationId: string | null;
}

export interface DbConnections {
  sessions: Section<DbSession[]>;
  byRuntime: { runtime: string; count: number; active: number }[];
  pool: DbPool;
  maxConnections: number | null;
  actionsEnabled: boolean;
}

export interface DbConnectionDetail {
  session: DbSession;
  transaction: DbTransaction | null;
  waits: DbLockWait[];
  actionsEnabled: boolean;
}

export interface DbTransactions {
  transactions: Section<DbTransaction[]>;
  stats: { active: number | null; longestSec: number | null; committedPerMin: number | null; rolledBackPerMin: number | null; avgDurationMs: number | null };
  lockWaits: Section<DbLockWait[]>;
  blockingChains: BlockingNode[];
  deadlocks: { today: number; last24h: number; recent: DbErrorRecord[] };
  longTransactionSec: number;
}

export interface DbTableDetail extends DbTable {
  columns: { name: string; type: string; nullable: boolean }[];
  indexes: { name: string; columns: string[]; unique: boolean; primary: boolean; scans: number | null; sizeBytes: number | null }[];
}

export interface DbStorage {
  storage: Section<{ totalBytes: number | null; dataBytes: number | null; indexBytes: number | null; tables: number }>;
  limitBytes: number | null;
  percent: number | null;
  growthTodayBytes: number | null;
  growth30dBytes: number | null;
  history: { t: number; value: number }[];
  topTables: { name: string; totalBytes: number | null }[];
}

export interface DbMigrations {
  items: { name: string; timestamp: number | null; status: 'applied' | 'pending'; appliedAt: string | null }[];
  applied: number;
  pending: number;
  lastRun: { at: string; status: 'completed' | 'failed'; executed: string[]; error: string | null; durationMs: number } | null;
  enabled: boolean;
  environment: string;
  database: string;
  tableName: string;
}

export interface DbErrors {
  counts: Record<DbErrorRecord['kind'], number>;
  total: number;
  items: DbErrorRecord[];
  range: DbRange;
}

export interface DbConfig {
  items: { key: string; value: string | number | boolean | null; sensitive?: boolean }[];
}

export interface DbPing {
  ok: boolean;
  latencyMs: number | null;
  error: DbConnectionError | null;
  checkedAt: string;
  state: string;
}
