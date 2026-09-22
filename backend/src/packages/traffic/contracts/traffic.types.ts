import { TELEMETRY_TIERS, type TelemetryTier } from '@packages/telemetry/index.js';

export { LATENCY_BUCKETS_MS, HISTOGRAM_SIZE } from '@packages/telemetry/index.js';

/** Các tầng lưu aggregate của traffic — dùng chung tầng với số đo hiệu năng. */
export const TRAFFIC_TIERS = TELEMETRY_TIERS;
export type TrafficTier = TelemetryTier;

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
