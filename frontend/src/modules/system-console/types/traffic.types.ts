/** Kiểu dữ liệu HTTP Traffic — khớp với `backend/src/modules/traffic/responses/traffic.response.ts`. */

export type TrafficRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
export type TimeseriesMetric = 'requests' | 'latency' | 'errors' | 'status';
export type EndpointSort = 'traffic' | 'latency' | 'p95' | 'errors';
export type EndpointStatus = 'healthy' | 'slow' | 'high_error' | 'failing' | 'idle' | 'low_traffic';
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export type RequestKind = 'failed' | 'slow' | 'notable';

export interface TrafficRoute {
  id: string;
  method: string;
  route: string;
  module: string;
  internal: boolean;
}

export interface TrafficStats {
  requests: number;
  requestsPerSecond: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  clientErrors: number;
  serverErrors: number;
  errorRatePercent: number;
  clientErrorRatePercent: number;
}

export interface TrafficComparison {
  requestsPercent: number | null;
  p95Percent: number | null;
  errorRateDelta: number | null;
}

export interface StatusCount {
  status: number;
  count: number;
}

export interface TrafficSettings {
  slowMs: number;
  longRunningMs: number;
  endpointP95WarnMs: number;
  errorRateWarnPercent: number;
  errorRateCritPercent: number;
  sampleRate: number;
  captureBodies: boolean;
  flushMs: number;
  requestLogSize: number;
  retention: { tier: string; resolutionSec: number; retentionHours: number }[];
}

export interface TrafficSummary {
  range: TrafficRange;
  generatedAt: string;
  instances: string[];
  modules: string[];
  stats: TrafficStats;
  comparison: TrafficComparison;
  activeRequests: number;
  peakActiveRequests: number;
  requestsToday: number;
  hasTraffic: boolean;
  lastRequestAt: string | null;
  statusClasses: { class: StatusClass; count: number; percent: number }[];
  topStatuses: StatusCount[];
  settings: TrafficSettings;
}

export interface Timeseries {
  range: TrafficRange;
  metric: TimeseriesMetric;
  stepSec: number;
  unit: 'rps' | 'ms' | 'percent';
  series: { id: string; points: { t: number; value: number }[] }[];
  current: number | null;
  average: number | null;
  peak: number | null;
  peakAt: number | null;
}

export interface Reason {
  code: string;
  message: string;
}

export interface EndpointRow extends TrafficRoute {
  stats: TrafficStats;
  status: EndpointStatus;
  reasons: Reason[];
}

export interface EndpointDetail extends EndpointRow {
  range: TrafficRange;
  comparison: TrafficComparison;
  requestsToday: number;
  topStatuses: StatusCount[];
  topErrorCodes: { code: string; count: number }[];
}

export interface RequestSummary {
  id: string;
  at: number;
  method: string;
  routeId: string;
  route: string;
  path: string;
  status: number;
  durationMs: number;
  instance: string;
  correlationId: string | null;
  errorCode: string | null;
  captured: boolean;
}

export interface RequestList {
  items: RequestSummary[];
  total: number;
  nextOffset: number | null;
  retained: number;
}

export type TimelinePhase = 'received' | 'routed' | 'handlerStart' | 'handlerEnd' | 'send' | 'finished';

export interface CapturedBody {
  kind: 'json' | 'text' | 'none';
  value?: unknown;
  truncated: boolean;
  omitted?: 'disabled' | 'empty' | 'binary' | 'tooLarge';
  sizeBytes: number | null;
}

export interface RequestDetailRecord extends RequestSummary {
  captureReason: 'slow' | 'error' | 'sampled';
  query: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  headers: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: CapturedBody;
  responseBody: CapturedBody;
  timeline: { phase: TimelinePhase; offsetMs: number }[];
  error: { code: string; name: string; message: string } | null;
}

export interface RequestDetailResponse {
  summary: RequestSummary;
  detail: RequestDetailRecord | null;
  route: TrafficRoute | null;
}

export interface ErrorAnalysis {
  range: TrafficRange;
  stats: TrafficStats;
  topRoutes: { routeId: string; method: string; route: string; clientErrors: number; serverErrors: number }[];
  topCodes: { code: string; count: number }[];
  topStatuses: StatusCount[];
}

export interface ActiveRequest {
  id: string;
  method: string;
  route: string;
  routeId: string;
  path: string;
  startedAt: number;
  instance: string;
  runningMs: number;
  longRunning: boolean;
}

export interface ActiveRequests {
  generatedAt: string;
  longRunningMs: number;
  items: ActiveRequest[];
}

export interface TrafficProblem {
  kind: string;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  routeId: string | null;
  since: string | null;
}

export interface TrafficInsights {
  generatedAt: string;
  problems: TrafficProblem[];
  security: {
    status: 401 | 403 | 429;
    count: number;
    topRoute: { routeId: string; method: string; route: string; count: number } | null;
  }[];
  rateLimit: { configured: false; message: string };
  last24h: {
    total: number;
    successful: number;
    clientErrors: number;
    serverErrors: number;
    peak: { at: string; requestsPerSecond: number } | null;
    slowest: { from: string; to: string; p95LatencyMs: number } | null;
  };
}

/** Bộ lọc chung (lưu trên query của hash để chia sẻ link). */
export interface TrafficFilters {
  range: TrafficRange;
  method?: string;
  module?: string;
  instance?: string;
  /** `false` = ẩn traffic nội bộ của System Console (/ops, /health). */
  internal: boolean;
  status?: string;
  q?: string;
  minMs?: number;
  sort?: EndpointSort;
}
