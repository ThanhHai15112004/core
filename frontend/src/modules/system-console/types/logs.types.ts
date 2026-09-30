export type LogsRange = '15m' | '1h' | '6h' | '24h' | '7d';
export type LogsTab = 'overview' | 'explorer' | 'errors' | 'traces' | 'audit' | 'configuration';
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
  newestAt: string | null;
}

export type ResolvedIdKind = 'request' | 'job' | 'execution' | 'correlation' | 'log';

export interface ResolvedId {
  id: string;
  kinds: ResolvedIdKind[];
  queue: string | null;
  correlationId: string | null;
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
  group: { fingerprint: string; count: number; firstSeen: string | null; lastSeen: string | null } | null;
}

export interface LogIssue {
  key: string;
  severity: 'info' | 'warning' | 'critical' | 'ok';
  params: Record<string, string | number>;
  target: { kind: 'explorer'; query: Record<string, string> } | { kind: 'error'; fingerprint: string } | { kind: 'config' } | null;
}

export interface LogsBackend {
  provider: 'redis-buffer';
  historicalSearch: 'limited';
  fullText: 'scan';
  bufferPerRuntime: number;
  metricsRetentionDays: number;
  consoleFormat: 'json' | 'text';
}

export interface ErrorGroupRow {
  fingerprint: string;
  errorType: string | null;
  template: string;
  module: string | null;
  frame: string | null;
  level: LogLevel;
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
  sample: {
    id: string | null;
    message: string;
    at: string | null;
    runtime: string | null;
    jobId: string | null;
    requestId: string | null;
    correlationId: string | null;
  };
}

export interface ErrorGroups {
  range: LogsRange;
  items: ErrorGroupRow[];
  otherCount: number;
}

export interface CountShare {
  name: string;
  count: number;
}

export interface ErrorGroupDetail extends ErrorGroupRow {
  series: { t: string; count: number }[];
  bucketSec: number;
  baselinePerMin: number | null;
  currentPerMin: number | null;
  affected: { runtimes: CountShare[]; jobTypes: CountShare[]; routes: CountShare[] };
  samples: LogRow[];
  nearestStart: { runtime: string; at: string; minutesBefore: number } | null;
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
  range: LogsRange;
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
    overrideUntil: string | null;
    overrideModules: string[];
    dropped: number;
    written: number;
    suppressed: number;
    redacted: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    updatedAt: string;
  }[];
  override: { level: string; previous: string; until: string | null; modules: string[]; setAt: string; actor: string | null } | null;
}

export interface Redaction {
  enabled: true;
  keys: string[];
  patterns: string[];
}

export interface LogsOverview {
  status: 'streaming' | 'idle' | 'degraded' | 'unavailable';
  range: LogsRange;
  environment: string;
  lastEventAt: string | null;
  lastIngestAt: string | null;
  backend: LogsBackend;
  kpis: {
    logsPerMin: number | null;
    total: number | null;
    errors: number | null;
    warnings: number | null;
    fatal: number | null;
    sources: number;
    errorRatePercent: number | null;
    uniqueErrors: number;
    traceablePercent: number | null;
    dropped: number | null;
    redacted: number | null;
  };
  levels: { level: LogLevel; count: number; percent: number | null }[];
  sources: { runtime: string; total: number; perMin: number | null; errors: number; warnings: number; instances: number }[];
  modules: { module: string; total: number; errors: number }[];
  issues: LogIssue[];
  topErrors: ErrorGroupRow[];
  recentAudit: AuditEvent[];
  redaction: Redaction;
  levelsActive: { runtime: string; level: string; until: string | null; modules: string[] }[];
}

export interface TraceEvent {
  at: string;
  component: string;
  kind: 'request' | 'log' | 'job' | 'execution';
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
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: 'failed' | 'ok' | 'running' | 'unknown';
  services: string[];
  counts: { logs: number; errors: number; warnings: number; jobs: number; requests: number };
  root: { kind: TraceEvent['kind']; label: string; at: string } | null;
  failurePoint: { component: string; label: string; at: string; errorType: string | null; logId: string | null } | null;
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
  from: string;
  to: string;
  available: boolean;
}

export interface LogsConfig {
  backend: LogsBackend;
  environment: string;
  runtimes: LevelState[];
  buffers: LogCoverage[];
  storage: {
    todayBytes: number | null;
    weekBytes: number | null;
    avgPerDayBytes: number | null;
    bySource: { runtime: string; bytes: number; percent: number | null }[];
  };
  retention: { key: string; value: string | number }[];
  redaction: Redaction;
  permissions: { levelChange: boolean; levelPermanent: boolean; export: boolean; exportMax: number; details: boolean; audit: boolean };
  rules: Record<string, number>;
  modules: string[];
}

export type OverrideLevel = 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type ExportFormat = 'json' | 'csv' | 'ndjson';
