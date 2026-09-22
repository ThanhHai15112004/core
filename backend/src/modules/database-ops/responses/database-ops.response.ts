import type {
  ConnectionState,
  DbDigestStat,
  DbErrorKind,
  DbLockWait,
  DbServerInfo,
  DbSession,
  DbTable,
  DbTableDetail,
  DbTransaction,
  ExplainResult,
  MigrationInfo,
  MigrationRun,
  MonitoringCapability,
} from '@packages/database/index.js';

export type DbRange = '15m' | '1h' | '6h' | '24h';
export type DbHealthStatus =
  'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown' | 'disabled';
export type DbSeverity = 'warning' | 'critical';

/** Phần số liệu không có → lý do (không làm "down" cả trang). */
export type SectionDto<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

export interface DbReasonDto {
  code: string;
  message: string;
}

export interface DbAlertDto {
  id: string;
  rule: string;
  severity: DbSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string | null;
  /** Tab của trang Database để xử lý. */
  tab: string;
}

export interface DbRuntimeConnectionDto {
  instance: string;
  runtime: string;
  state: ConnectionState;
  lastPingMs: number | null;
  lastSuccessAt: string | null;
  lastError: { code: string | null; message: string } | null;
}

export interface DbPoolDto {
  used: number | null;
  idle: number | null;
  waiting: number | null;
  limit: number;
  percent: number | null;
  peakToday: number | null;
}

export interface DbReportDto {
  queries: number;
  avgMs: number | null;
  p95Ms: number | null;
  slowQueries: number;
  failedQueries: number;
  peakConnections: number | null;
  deadlocks: number;
  growthBytes: number | null;
}

export interface DbOverviewDto {
  generatedAt: string;
  range: DbRange;
  driver: string;
  environment: string;
  database: string;
  capabilities: MonitoringCapability[];
  health: {
    status: DbHealthStatus;
    reasons: DbReasonDto[];
    since: string;
    lastSuccessAt: string | null;
    pingMs: number | null;
    lastError: { code: string | null; message: string } | null;
  };
  server: SectionDto<DbServerInfo>;
  runtimes: DbRuntimeConnectionDto[];
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
  pool: DbPoolDto;
  alerts: DbAlertDto[];
  liveQueries: SectionDto<DbSession[]>;
  transactions: {
    active: number | null;
    longestSec: number | null;
    committedPerMin: number | null;
    rolledBackPerMin: number | null;
  };
  largestTables: SectionDto<(DbTable & { growthPercent: number | null })[]>;
  report: { today: DbReportDto; yesterday: DbReportDto };
  events: DbEventDto[];
  settings: {
    slowQueryMs: number;
    longTransactionSec: number;
    actionsEnabled: boolean;
    migrationsEnabled: boolean;
  };
}

export interface DbSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export type DbMetric = 'queries' | 'latency' | 'connections' | 'errors' | 'transactions';

export interface DbMetricsDto {
  metric: DbMetric;
  range: DbRange;
  resolutionSec: number | null;
  unit: string;
  series: DbSeriesDto[];
}

export interface DbLiveQueriesDto {
  sessions: SectionDto<DbSession[]>;
  slowQueryMs: number;
  actionsEnabled: boolean;
}

export interface DbQueryStatDto extends DbDigestStat {
  /** Số lần chạy / thời gian TB trong khoảng đang chọn (từ snapshot định kỳ); `null` khi chưa có lịch sử. */
  rangeCalls: number | null;
  rangeAvgMs: number | null;
  slow: boolean;
}

export interface DbQueryStatsDto {
  stats: SectionDto<DbQueryStatDto[]>;
  minMs: number;
  range: DbRange;
  note: 'cumulative';
}

export interface DbQueryDetailDto {
  stat: DbQueryStatDto;
  history: { calls: DbSeriesDto; avgMs: DbSeriesDto };
  relatedSlow: { at: number; durationMs: number; correlationId: string | null; instance: string }[];
}

export interface DbExplainDto {
  available: boolean;
  reason: string | null;
  plan: ExplainResult | null;
}

export interface DbConnectionsDto {
  sessions: SectionDto<DbSession[]>;
  byRuntime: { runtime: string; count: number; active: number }[];
  pool: DbPoolDto;
  maxConnections: number | null;
  actionsEnabled: boolean;
}

export interface DbConnectionDetailDto {
  session: DbSession;
  transaction: DbTransaction | null;
  waits: DbLockWait[];
  actionsEnabled: boolean;
}

export interface BlockingNodeDto {
  session: string;
  runtime: string | null;
  query: string | null;
  waitMs: number | null;
  object: string | null;
  lockMode: string | null;
  children: BlockingNodeDto[];
}

export interface DbTransactionsDto {
  transactions: SectionDto<DbTransaction[]>;
  stats: {
    active: number | null;
    longestSec: number | null;
    committedPerMin: number | null;
    rolledBackPerMin: number | null;
    avgDurationMs: number | null;
  };
  lockWaits: SectionDto<DbLockWait[]>;
  blockingChains: BlockingNodeDto[];
  deadlocks: { today: number; last24h: number; recent: DbErrorRecordDto[] };
  longTransactionSec: number;
}

export interface DbTableRowDto extends DbTable {
  growthPercent: number | null;
  readsPerSec: number | null;
  writesPerSec: number | null;
}

export interface DbTablesDto {
  tables: SectionDto<DbTableRowDto[]>;
}

export interface DbTableDetailDto extends DbTableDetail {
  growthPercent: number | null;
  readsPerSec: number | null;
  writesPerSec: number | null;
}

export interface DbStorageDto {
  storage: SectionDto<{
    totalBytes: number | null;
    dataBytes: number | null;
    indexBytes: number | null;
    tables: number;
  }>;
  limitBytes: number | null;
  percent: number | null;
  growthTodayBytes: number | null;
  growth30dBytes: number | null;
  history: { t: number; value: number }[];
  topTables: { name: string; totalBytes: number | null }[];
}

export interface DbMigrationsDto {
  items: MigrationInfo[];
  applied: number;
  pending: number;
  lastRun: MigrationRun | null;
  enabled: boolean;
  environment: string;
  database: string;
  tableName: string;
}

export interface DbEventDto {
  id: string;
  at: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: string | null;
}

export interface DbErrorRecordDto {
  at: string;
  kind: DbErrorKind;
  code: string | null;
  message: string;
  sql: string;
  runtime: string | null;
  correlationId: string | null;
}

export interface DbErrorsDto {
  counts: Record<DbErrorKind, number>;
  total: number;
  items: DbErrorRecordDto[];
  range: DbRange;
}

export interface DbConfigDto {
  items: { key: string; value: string | number | boolean | null; sensitive?: boolean }[];
}
