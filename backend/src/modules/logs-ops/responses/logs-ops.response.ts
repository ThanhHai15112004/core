import type { LogEntryLevel, LogMetadata } from '@packages/logging/index.js';

export type LogsRange = '15m' | '1h' | '6h' | '24h' | '7d';

/** Một dòng trong Log Explorer — chỉ các cột cơ bản + ID ngữ cảnh; metadata / stack xem ở chi tiết. */
export interface LogRowDto {
  id: string;
  /** ISO 8601 */
  at: string;
  level: LogEntryLevel;
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
  /** HTTP status (log request). */
  status: number | null;
  fingerprint: string | null;
  hasStack: boolean;
  hasMetadata: boolean;
}

/** Phạm vi dữ liệu tìm được của từng runtime — trang nói thật "chỉ tìm được N log gần nhất". */
export interface LogCoverageDto {
  runtime: string;
  entries: number;
  capacity: number;
  oldestAt: string | null;
  newestAt: string | null;
}

export interface LogSearchDto {
  items: LogRowDto[];
  nextCursor: string | null;
  /** Số log đã đọc (toàn bộ buffer) và số khớp bộ lọc. */
  scanned: number;
  matched: number;
  coverage: LogCoverageDto[];
  /** Tìm theo ID: ID đó là gì (để mở đúng màn). */
  resolved: ResolvedIdDto | null;
}

export interface LogTailDto {
  items: LogRowDto[];
  /** Còn log mới hơn chưa trả (vượt giới hạn một lần). */
  more: boolean;
  latestCursor: string | null;
}

export type ResolvedIdKind = 'request' | 'job' | 'execution' | 'correlation' | 'log';

export interface ResolvedIdDto {
  id: string;
  kinds: ResolvedIdKind[];
  /** Job: queue để mở trang Job. */
  queue: string | null;
  correlationId: string | null;
}

export interface LogLinksDto {
  request: {
    id: string;
    method: string | null;
    route: string | null;
    status: number | null;
  } | null;
  job: { id: string; queue: string | null; type: string | null } | null;
  execution: { id: string; taskId: string | null } | null;
  message: { id: string } | null;
  /** Có log / sự kiện khác cùng correlation → xem trace. */
  correlationId: string | null;
  /** Thành phần hạ tầng liên quan (theo loại lỗi / metadata) → mở màn tương ứng. */
  dependency: 'database' | 'cache' | 'storage' | 'messaging' | 'http' | null;
}

export interface LogDetailDto extends LogRowDto {
  stack: string | null;
  metadata: LogMetadata | null;
  /** Metadata / stack bị ẩn do cấu hình quyền (`OPS_LOGS_DETAILS_ENABLED=false`). */
  detailsHidden: boolean;
  links: LogLinksDto;
  /** Log ngay trước / sau trên cùng instance — chuỗi sự kiện quanh lỗi. */
  before: LogRowDto[];
  after: LogRowDto[];
  group: {
    fingerprint: string;
    count: number;
    firstSeen: string | null;
    lastSeen: string | null;
  } | null;
}

export interface LogIssueDto {
  key: string;
  severity: 'info' | 'warning' | 'critical' | 'ok';
  params: Record<string, string | number>;
  /** Nơi xem tiếp: explorer với bộ lọc, nhóm lỗi, cấu hình. */
  target:
    | { kind: 'explorer'; query: Record<string, string> }
    | { kind: 'error'; fingerprint: string }
    | { kind: 'config' }
    | null;
}

export interface LogsBackendDto {
  /** `redis-buffer`: ring buffer Redis mỗi runtime (chưa có kho log tập trung như Loki / OpenSearch). */
  provider: 'redis-buffer';
  /** Tìm được log cũ tới đâu: `limited` = chỉ N log gần nhất mỗi runtime. */
  historicalSearch: 'limited';
  fullText: 'scan';
  bufferPerRuntime: number;
  /** Số đo volume / nhóm lỗi giữ lâu hơn buffer (telemetry). */
  metricsRetentionDays: number;
  consoleFormat: 'json' | 'text';
}

export interface LogsKpisDto {
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
}

export interface LogSourceDto {
  runtime: string;
  total: number;
  perMin: number | null;
  errors: number;
  warnings: number;
  instances: number;
}

export interface LogModuleDto {
  module: string;
  total: number;
  errors: number;
}

export interface LogLevelShareDto {
  level: LogEntryLevel;
  count: number;
  percent: number | null;
}

export interface ErrorGroupRowDto {
  fingerprint: string;
  errorType: string | null;
  template: string;
  module: string | null;
  frame: string | null;
  level: LogEntryLevel;
  /** Số lần trong khoảng thời gian đang xem (telemetry) và tổng từ khi theo dõi. */
  count: number;
  total: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** So với nửa đầu khoảng thời gian. */
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

export interface ErrorGroupsDto {
  range: LogsRange;
  items: ErrorGroupRowDto[];
  /** Nhóm lỗi vượt giới hạn metric riêng (gộp `other`). */
  otherCount: number;
}

export interface CountShareDto {
  name: string;
  count: number;
}

export interface ErrorGroupDetailDto extends ErrorGroupRowDto {
  series: { t: string; count: number }[];
  bucketSec: number;
  baselinePerMin: number | null;
  currentPerMin: number | null;
  affected: { runtimes: CountShareDto[]; jobTypes: CountShareDto[]; routes: CountShareDto[] };
  samples: LogRowDto[];
  /** Runtime khởi động gần nhất trước lần đầu xuất hiện (chỉ là tương quan thời gian, không kết luận nguyên nhân). */
  nearestStart: { runtime: string; at: string; minutesBefore: number } | null;
  dependency: LogLinksDto['dependency'];
}

export interface LogsSeriesPointDto {
  t: string;
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
}

export interface LogsSeriesDto {
  range: LogsRange;
  bucketSec: number;
  points: LogsSeriesPointDto[];
  /** Spike lỗi phát hiện trong khoảng (lỗi/phút trước → sau). */
  spike: { at: string; beforePerMin: number; afterPerMin: number } | null;
}

export type AuditDomain =
  | 'cache'
  | 'storage'
  | 'queue'
  | 'messaging'
  | 'scheduler'
  | 'jobs'
  | 'database'
  | 'runtime'
  | 'logs';

export interface AuditEventDto {
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

export interface AuditListDto {
  items: AuditEventDto[];
  nextCursor: string | null;
  total: number;
  /** Mỗi nguồn audit giữ tối đa N bản ghi gần nhất (theo cấu hình từng module). */
  domains: { domain: AuditDomain; entries: number; oldestAt: string | null }[];
}

export interface LevelStateDto {
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
  override: {
    level: string;
    previous: string;
    until: string | null;
    modules: string[];
    setAt: string;
    actor: string | null;
  } | null;
}

export interface LogsOverviewDto {
  status: 'streaming' | 'idle' | 'degraded' | 'unavailable';
  range: LogsRange;
  environment: string;
  lastEventAt: string | null;
  lastIngestAt: string | null;
  backend: LogsBackendDto;
  kpis: LogsKpisDto;
  levels: LogLevelShareDto[];
  sources: LogSourceDto[];
  modules: LogModuleDto[];
  issues: LogIssueDto[];
  topErrors: ErrorGroupRowDto[];
  recentAudit: AuditEventDto[];
  redaction: { enabled: true; keys: string[]; patterns: string[] };
  levelsActive: { runtime: string; level: string; until: string | null; modules: string[] }[];
}

export interface TraceEventDto {
  at: string;
  component: string;
  kind: 'request' | 'log' | 'job' | 'execution';
  level: 'info' | 'warn' | 'error';
  label: string;
  detail: string | null;
  module: string | null;
  errorType?: string | null;
  logId: string | null;
  link: { kind: 'request' | 'job' | 'execution'; id: string; queue?: string | null } | null;
}

export interface TraceNodeDto {
  component: string;
  label: string;
  status: 'ok' | 'error';
  events: number;
  firstAt: string;
  link: TraceEventDto['link'];
}

export interface TraceDto {
  id: string;
  resolvedFrom: ResolvedIdKind[];
  correlationId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: 'failed' | 'ok' | 'running' | 'unknown';
  services: string[];
  counts: { logs: number; errors: number; warnings: number; jobs: number; requests: number };
  root: { kind: TraceEventDto['kind']; label: string; at: string } | null;
  /** Điểm lỗi đầu tiên theo thời gian — không khẳng định là nguyên nhân gốc. */
  failurePoint: {
    component: string;
    label: string;
    at: string;
    errorType: string | null;
    logId: string | null;
  } | null;
  flow: TraceNodeDto[];
  events: TraceEventDto[];
  /** Log ngoài buffer (đã bị ghi đè) thì không còn trong trace. */
  truncated: boolean;
}

export interface LogsReportTotalsDto {
  logs: number | null;
  errors: number | null;
  warnings: number | null;
  fatal: number | null;
  uniqueErrors: number;
  peakPerMin: number | null;
  topError: { fingerprint: string; label: string; count: number } | null;
  topErrorSource: { runtime: string; count: number } | null;
}

export interface LogsReportDto {
  current: LogsReportTotalsDto;
  previous: LogsReportTotalsDto;
  /** Từ 0h hôm nay (giờ server) tới giờ; hôm qua cùng khung giờ. */
  from: string;
  to: string;
  available: boolean;
}

export interface LogsConfigDto {
  backend: LogsBackendDto;
  environment: string;
  runtimes: LevelStateDto[];
  buffers: LogCoverageDto[];
  storage: {
    todayBytes: number | null;
    weekBytes: number | null;
    avgPerDayBytes: number | null;
    bySource: { runtime: string; bytes: number; percent: number | null }[];
  };
  retention: { key: string; value: string | number }[];
  redaction: { enabled: true; keys: string[]; patterns: string[] };
  permissions: {
    levelChange: boolean;
    levelPermanent: boolean;
    export: boolean;
    exportMax: number;
    details: boolean;
    audit: boolean;
  };
  rules: Record<string, number>;
  modules: string[];
}
