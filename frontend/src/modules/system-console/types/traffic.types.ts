/** Kiểu dữ liệu HTTP Traffic — khớp với `backend/src/modules/traffic/responses/traffic.response.ts`. */

export type TrafficRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
export type TimeseriesMetric = 'requests' | 'latency' | 'errors' | 'status';
export type EndpointSort = 'traffic' | 'latency' | 'p95' | 'errors';
export type EndpointStatus = 'healthy' | 'slow' | 'high_error' | 'failing' | 'idle' | 'low_traffic';
export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

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

/** Ngưỡng đánh giá từ cấu hình `TRAFFIC_*`. */
export interface TrafficSettings {
  endpointP95WarnMs: number;
  errorRateWarnPercent: number;
  errorRateCritPercent: number;
}

export interface TrafficSummary {
  stats: TrafficStats;
  comparison: TrafficComparison;
  /** Từ 0 giờ hôm nay; null khi Prometheus không trả lời. */
  requestsToday: number | null;
  hasTraffic: boolean;
  statusClasses: { class: StatusClass; count: number; percent: number }[];
  topStatuses: StatusCount[];
  settings: TrafficSettings;
}

export interface Timeseries {
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
  requestsToday: number | null;
  topStatuses: StatusCount[];
}

export interface ErrorAnalysis {
  stats: TrafficStats;
  topRoutes: { routeId: string; method: string; route: string; clientErrors: number; serverErrors: number }[];
  /** Status lỗi (≥ 400) nhiều nhất. */
  topStatuses: StatusCount[];
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
  problems: TrafficProblem[];
  security: {
    status: 401 | 403 | 429;
    count: number;
    topRoute: { method: string; route: string } | null;
  }[];
  rateLimit: { configured: boolean; mode: string; message: string };
  last24h: {
    total: number;
    successful: number;
    clientErrors: number;
    serverErrors: number;
    peak: { at: string; requestsPerSecond: number } | null;
    slowest: { from: string; to: string; p95LatencyMs: number } | null;
  };
}

export interface GatewayConsistencyCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: Record<string, unknown>;
}

export interface GatewayServiceDomain {
  domain: string;
  serviceName: string;
  upstreamDefault: string;
  prefixes: string[];
  stripPrefix: boolean;
  stability: 'v1-stable';
  description: string;
}

export interface TrafficGatewayConfig {
  status: 'ok' | 'warn' | 'fail';
  proxy: {
    trustMode: string;
    trustedCidrs: string[];
    maxHops: number;
    ipHeaders: string[];
    forwardedPrefixHeader: string;
  };
  timeouts: {
    lbConnectTimeoutMs: number;
    lbSendTimeoutMs: number;
    lbReadTimeoutMs: number;
    lbKeepAliveTimeoutMs: number;
    apiConnectionTimeoutMs: number;
    apiRequestTimeoutMs: number;
    apiKeepAliveTimeoutMs: number;
    apiHeadersTimeoutMs: number;
  };
  bodyLimits: {
    gatewayMaxBodySizeBytes: number;
    apiMaxBodySizeBytes: number;
    apiJsonBodyLimitBytes: number;
    maxParamLength: number;
  };
  rateLimit: {
    layerMode: string;
    gatewaySourceHeader: string;
    gatewaySourceValue: string;
    skipBackendIpWhenEdgeApplied: boolean;
    alwaysEnforceIpRoutes: string[];
    gatewayEdgeRps: number;
    gatewayEdgeBurst: number;
    backendDefaultRule: {
      windowSeconds: number;
      maxRequestsPerIp: number;
      maxRequestsPerUser: number;
      maxRequestsPerApi: number;
    } | null;
    distributedStoreReady: boolean;
  };
  gateway: {
    vendor: string;
    sharedSecretHeader: string;
    sharedSecretConfigured: boolean;
    strictConsistencyCheck: boolean;
  };
  checks: GatewayConsistencyCheck[];
  serviceRouting: {
    apiPrefix: string;
    valid: boolean;
    collisions: { prefix: string; domains: string[] }[];
    domains: GatewayServiceDomain[];
  };
}

/** Bộ lọc chung (lưu trên query của hash để chia sẻ link). */
export interface TrafficFilters {
  range: TrafficRange;
  method?: string;
  /** `false` = ẩn traffic nội bộ của System Console (/ops, /health). */
  internal: boolean;
}
