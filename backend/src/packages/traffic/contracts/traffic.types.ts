/** Cận trên (ms) của từng ô histogram latency; ô cuối cùng là "> 10s". */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const HISTOGRAM_SIZE = LATENCY_BUCKETS_MS.length + 1;

/** Các tầng lưu aggregate: độ phân giải và thời gian giữ. */
export const TRAFFIC_TIERS = {
  s10: { seconds: 10, ttlSec: 2 * 3600 },
  m1: { seconds: 60, ttlSec: 25 * 3600 },
  h1: { seconds: 3600, ttlSec: 8 * 24 * 3600 },
} as const;
export type TrafficTier = keyof typeof TRAFFIC_TIERS;

/** Endpoint không khớp route nào (404) — gom chung để không đưa URL thô vào key. */
export const UNMATCHED_ROUTE = '(unmatched)';

export interface TrafficRoute {
  id: string;
  method: string;
  /** Route template, vd. `/api/v1/users/:id`. */
  route: string;
  /** Segment đầu sau API prefix, vd. `users`. */
  module: string;
  internal: boolean;
}

export type TimelinePhase =
  'received' | 'routed' | 'handlerStart' | 'handlerEnd' | 'send' | 'finished';

export interface TimelineMark {
  phase: TimelinePhase;
  /** ms kể từ lúc nhận request */
  offsetMs: number;
}

export interface RequestErrorInfo {
  code: string;
  name: string;
  message: string;
}

/** Bản ghi nhẹ cho mọi request (không header/body). */
export interface RequestSummary {
  id: string;
  /** epoch ms lúc nhận request */
  at: number;
  method: string;
  routeId: string;
  route: string;
  /** Đường dẫn thực tế, không có query string. */
  path: string;
  status: number;
  durationMs: number;
  instance: string;
  correlationId: string | null;
  errorCode: string | null;
  /** Có bản chi tiết (headers/body/timeline) hay không. */
  captured: boolean;
}

export type CaptureReason = 'slow' | 'error' | 'sampled';

export interface CapturedBody {
  kind: 'json' | 'text' | 'none';
  value?: unknown;
  truncated: boolean;
  /** Vì sao không có nội dung. */
  omitted?: 'disabled' | 'empty' | 'binary' | 'tooLarge';
  sizeBytes: number | null;
}

export interface RequestDetail extends RequestSummary {
  captureReason: CaptureReason;
  query: Record<string, unknown>;
  /** IP đã che bớt (IPv4: octet cuối). */
  ip: string | null;
  userAgent: string | null;
  headers: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: CapturedBody;
  responseBody: CapturedBody;
  timeline: TimelineMark[];
  error: RequestErrorInfo | null;
}

export interface ActiveRequest {
  id: string;
  method: string;
  route: string;
  routeId: string;
  path: string;
  /** epoch ms */
  startedAt: number;
  instance: string;
}

export interface ActiveSnapshot {
  instance: string;
  at: number;
  active: ActiveRequest[];
}
