export type LogsRange = '15m' | '1h' | '6h' | '24h' | '7d';
export type LogsTab = 'overview' | 'explorer' | 'errors' | 'audit';
export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogsWindow = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
export type LogMetadata = Record<string, unknown>;

/** Bộ lọc Explorer — nằm trên URL (`logs/explorer?level=error&jobId=…`). */
export interface LogFilters {
  q?: string;
  level?: string;
  runtime?: string;
  module?: string;
  correlationId?: string;
  requestId?: string;
  jobId?: string;
  messageId?: string;
  executionId?: string;
  userId?: string;
  id?: string;
  status?: string;
  endpoint?: string;
  errorType?: string;
  instance?: string;
  fingerprint?: string;
  window?: LogsWindow;
  from?: string;
  to?: string;
}

export interface LogRow {
  id: string;
  at: string;
  level: LogLevel;
  runtime: string | null;
  instance: string | null;
  module: string | null;
  message: string;
  correlationId: string | null;
  requestId: string | null;
  jobId: string | null;
  jobType: string | null;
  messageId: string | null;
  executionId: string | null;
  userId: string | null;
  route: string | null;
  errorType: string | null;
  errorCode: string | null;
  durationMs: number | null;
  status: number | null;
  fingerprint: string | null;
  hasStack: boolean;
  hasMetadata: boolean;
}

export interface LogCoverage {
  runtime: string;
  entries: number;
  capacity: number;
  oldestAt: string | null;
}

export type ResolvedIdKind = 'request' | 'job' | 'execution' | 'correlation' | 'log';

export interface ResolvedId {
  id: string;
  kinds: ResolvedIdKind[];
  queue: string | null;
}

export interface LogSearchResult {
  items: LogRow[];
  nextCursor: string | null;
  scanned: number;
  matched: number;
  coverage: LogCoverage[];
  resolved: ResolvedId | null;
}

export interface LogTailResult {
  items: LogRow[];
  more: boolean;
  latestCursor: string | null;
}

export type LogDependency = 'database' | 'cache' | 'storage' | 'messaging' | 'http';

export interface LogLinks {
  request: { id: string; method: string | null; route: string | null; status: number | null } | null;
  job: { id: string; queue: string | null; type: string | null } | null;
  execution: { id: string; taskId: string | null } | null;
  message: { id: string } | null;
  correlationId: string | null;
  dependency: LogDependency | null;
}

export interface LogDetail extends LogRow {
  stack: string | null;
  metadata: LogMetadata | null;
  detailsHidden: boolean;
  links: LogLinks;
  before: LogRow[];
  after: LogRow[];
  group: { fingerprint: string; count: number; firstSeen: string | null } | null;
}

export interface LogIssue {
  key: string;
  severity: 'info' | 'warning' | 'critical' | 'ok';
  params: Record<string, string | number>;
  target: { kind: 'explorer'; query: Record<string, string> } | { kind: 'error'; fingerprint: string } | { kind: 'config' } | null;
}

export interface LogsBackend {
  /** Số log gần nhất được giữ trong stream, chung cho mọi runtime. */
  bufferSize: number;
  consoleFormat: 'json' | 'text';
}

export interface ErrorGroupRow {
  fingerprint: string;
  errorType: string | null;
  template: string;
  module: string | null;
  frame: string | null;
  count: number;
  total: number;
  firstSeen: string | null;
  lastSeen: string | null;
  trend: 'up' | 'down' | 'flat' | 'new';
  changePercent: number | null;
  isNew: boolean;
  spiking: boolean;
  runtimes: string[];
  jobTypes: string[];
  routes: string[];
  spark: number[];
}

export interface ErrorGroups {
  items: ErrorGroupRow[];
  otherCount: number;
}

export interface CountShare {
  name: string;
  count: number;
}

export interface ErrorGroupDetail extends ErrorGroupRow {
  series: { t: string; count: number }[];
  baselinePerMin: number | null;
  currentPerMin: number | null;
  affected: { runtimes: CountShare[]; jobTypes: CountShare[]; routes: CountShare[] };
  samples: LogRow[];
  nearestStart: { runtime: string; minutesBefore: number } | null;
  dependency: LogDependency | null;
}

export interface LogsSeriesPoint {
  t: string;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

export interface LogsSeries {
  bucketSec: number;
  points: LogsSeriesPoint[];
  spike: { at: string; beforePerMin: number; afterPerMin: number } | null;
}

export type AuditDomain = 'cache' | 'storage' | 'queue' | 'messaging' | 'scheduler' | 'jobs' | 'database' | 'runtime' | 'logs';

export interface AuditEvent {
  id: string;
  at: string;
  domain: AuditDomain;
  action: string;
  target: string | null;
  result: 'success' | 'failed';
  actor: string | null;
  ip: string | null;
  detail: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface AuditList {
  items: AuditEvent[];
  nextCursor: string | null;
  total: number;
  domains: { domain: AuditDomain; entries: number; oldestAt: string | null }[];
}

export interface LevelState {
  runtime: string;
  running: boolean;
  instances: {
    instance: string;
    level: string;
    baseLevel: string;
    dropped: number;
    written: number;
    lastSuccessAt: string | null;
    lastError: string | null;
  }[];
  override: { level: string; previous: string; until: string | null; modules: string[] } | null;
}

export interface Redaction {
  keys: string[];
  patterns: string[];
}

export interface LogsOverview {
  status: 'streaming' | 'idle' | 'degraded' | 'unavailable';
  lastIngestAt: string | null;
  kpis: {
    logsPerMin: number | null;
    errors: number | null;
    warnings: number | null;
    fatal: number | null;
    errorRatePercent: number | null;
    uniqueErrors: number;
    dropped: number | null;
  };
  levels: { level: LogLevel; count: number; percent: number | null }[];
  sources: { runtime: string; perMin: number | null; errors: number; warnings: number; instances: number }[];
  modules: { module: string; total: number; errors: number }[];
  issues: LogIssue[];
  topErrors: ErrorGroupRow[];
  recentAudit: AuditEvent[];
  levelsActive: { runtime: string; level: string; modules: string[] }[];
}

export interface TraceEvent {
  at: string;
  component: string;
  level: 'info' | 'warn' | 'error';
  label: string;
  detail: string | null;
  module: string | null;
  logId: string | null;
  link: { kind: 'request' | 'job' | 'execution'; id: string; queue?: string | null } | null;
}

export interface TraceNode {
  component: string;
  label: string;
  status: 'ok' | 'error';
  events: number;
  firstAt: string;
  link: TraceEvent['link'];
}

export interface Trace {
  id: string;
  resolvedFrom: ResolvedIdKind[];
  correlationId: string | null;
  durationMs: number | null;
  status: 'failed' | 'ok' | 'running' | 'unknown';
  services: string[];
  counts: { logs: number; errors: number; jobs: number; requests: number };
  root: { label: string; at: string } | null;
  failurePoint: { component: string; label: string; errorType: string | null; logId: string | null } | null;
  flow: TraceNode[];
  events: TraceEvent[];
  truncated: boolean;
}

export interface LogsReportTotals {
  logs: number | null;
  errors: number | null;
  warnings: number | null;
  fatal: number | null;
  uniqueErrors: number;
  peakPerMin: number | null;
  topError: { fingerprint: string; label: string; count: number } | null;
  topErrorSource: { runtime: string; count: number } | null;
}

export interface LogsReport {
  current: LogsReportTotals;
  previous: LogsReportTotals;
  available: boolean;
}

export interface LogsConfig {
  backend: LogsBackend;
  environment: string;
  runtimes: LevelState[];
  buffers: LogCoverage[];
  retention: { key: string; value: string | number }[];
  redaction: Redaction;
  permissions: { levelChange: boolean; levelPermanent: boolean; export: boolean; exportMax: number; details: boolean; audit: boolean };
  rules: Record<string, number>;
  modules: string[];
}

export type OverrideLevel = 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type ExportFormat = 'json' | 'csv' | 'ndjson';
