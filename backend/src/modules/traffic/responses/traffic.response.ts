import type {
  ActiveRequest,
  RequestDetail,
  RequestSummary,
  TrafficRoute,
} from '@packages/traffic/index.js';

export type EndpointStatus = 'healthy' | 'slow' | 'high_error' | 'failing' | 'idle' | 'low_traffic';
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

export interface ReasonDto {
  code: string;
  message: string;
}

/** Thống kê của một tập request (toàn hệ thống hoặc một endpoint). */
export interface TrafficStatsDto {
  requests: number;
  requestsPerSecond: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  clientErrors: number;
  serverErrors: number;
  /** % response 5xx. */
  errorRatePercent: number;
  /** % response 4xx. */
  clientErrorRatePercent: number;
}

/** So sánh với khoảng liền trước cùng độ dài; `null` khi khoảng trước vượt thời gian lưu. */
export interface TrafficComparisonDto {
  requestsPercent: number | null;
  p95Percent: number | null;
  /** Chênh lệch điểm phần trăm 5xx. */
  errorRateDelta: number | null;
}

export interface StatusCountDto {
  status: number;
  count: number;
}

export interface StatusClassDto {
  class: StatusClass;
  count: number;
  percent: number;
}

export interface TrafficSettingsDto {
  slowMs: number;
  longRunningMs: number;
  endpointP95WarnMs: number;
  errorRateWarnPercent: number;
  errorRateCritPercent: number;
  sampleRate: number;
  captureBodies: boolean;
  flushMs: number;
  requestLogSize: number;
  /** Tầng lưu: độ phân giải (giây) và thời gian giữ (giờ). */
  retention: { tier: string; resolutionSec: number; retentionHours: number }[];
}

export interface TrafficSummaryDto {
  range: string;
  generatedAt: string;
  instances: string[];
  modules: string[];
  stats: TrafficStatsDto;
  comparison: TrafficComparisonDto;
  activeRequests: number;
  peakActiveRequests: number;
  requestsToday: number;
  /** Có bất kỳ request nào trong thời gian lưu (để phân biệt "chưa có traffic"). */
  hasTraffic: boolean;
  lastRequestAt: string | null;
  statusClasses: StatusClassDto[];
  topStatuses: StatusCountDto[];
  settings: TrafficSettingsDto;
}

export type TimeseriesMetric = 'requests' | 'latency' | 'errors' | 'status';

export interface SeriesPointDto {
  t: number;
  value: number;
}

export interface TimeseriesDto {
  range: string;
  metric: TimeseriesMetric;
  stepSec: number;
  unit: 'rps' | 'ms' | 'percent';
  series: { id: string; points: SeriesPointDto[] }[];
  /** Thống kê của series chính (requests: rps, latency: p95, errors: 5xx %, status: tổng rps). */
  current: number | null;
  average: number | null;
  peak: number | null;
  peakAt: number | null;
}

export interface EndpointRowDto extends TrafficRoute {
  stats: TrafficStatsDto;
  status: EndpointStatus;
  reasons: ReasonDto[];
}

export interface EndpointDetailDto extends EndpointRowDto {
  range: string;
  comparison: TrafficComparisonDto;
  requestsToday: number;
  topStatuses: StatusCountDto[];
  topErrorCodes: { code: string; count: number }[];
}

export interface RequestListDto {
  items: RequestSummary[];
  total: number;
  nextOffset: number | null;
  /** Số request tối đa được giữ trong log (cũ hơn thì không còn). */
  retained: number;
}

export interface RequestDetailDto {
  summary: RequestSummary;
  /** `null` khi request không được lưu chi tiết (không chậm/lỗi/lấy mẫu) hoặc đã hết hạn. */
  detail: RequestDetail | null;
  route: TrafficRoute | null;
}

export interface ErrorAnalysisDto {
  range: string;
  stats: TrafficStatsDto;
  topRoutes: {
    routeId: string;
    method: string;
    route: string;
    clientErrors: number;
    serverErrors: number;
  }[];
  topCodes: { code: string; count: number }[];
  topStatuses: StatusCountDto[];
}

export interface ActiveRequestDto extends ActiveRequest {
  runningMs: number;
  longRunning: boolean;
}

export interface ActiveRequestsDto {
  generatedAt: string;
  longRunningMs: number;
  items: ActiveRequestDto[];
}

export type ProblemKind =
  | 'trafficSpike'
  | 'errorSpike'
  | 'latency'
  | 'endpoint.slow'
  | 'endpoint.high_error'
  | 'endpoint.failing';

export interface TrafficProblemDto {
  kind: ProblemKind;
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  routeId: string | null;
  since: string | null;
}

export interface SecurityTrafficDto {
  status: 401 | 403 | 429;
  count: number;
  topRoute: { routeId: string; method: string; route: string; count: number } | null;
}

export interface TrafficSummary24hDto {
  total: number;
  successful: number;
  clientErrors: number;
  serverErrors: number;
  peak: { at: string; requestsPerSecond: number } | null;
  slowest: { from: string; to: string; p95LatencyMs: number } | null;
}

export interface TrafficInsightsDto {
  generatedAt: string;
  problems: TrafficProblemDto[];
  security: SecurityTrafficDto[];
  rateLimit: { configured: false; message: string };
  last24h: TrafficSummary24hDto;
}
