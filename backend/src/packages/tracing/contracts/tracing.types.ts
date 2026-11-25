import type { SpanCategory } from '../constants/tracing.constant.js';

export interface TracingModuleOptions {
  readonly runtime: string;
}

export type RecordedSpanKind = 'server' | 'client' | 'producer' | 'consumer' | 'internal';

export type RecordedSpanStatus = 'ok' | 'error' | 'unset';

export interface RecordedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly category: SpanCategory;
  readonly kind: RecordedSpanKind;
  readonly runtime: string;
  readonly service: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly durationMs: number;
  readonly status: RecordedSpanStatus;
  readonly statusMessage: string | null;
  readonly attributes: Record<string, string | number | boolean>;
}

export interface RecentTraceSummary {
  readonly traceId: string;
  readonly rootName: string;
  readonly runtime: string;
  readonly service: string;
  readonly status: 'ok' | 'error';
  readonly durationMs: number;
  readonly spanCount: number;
  readonly startedAt: string;
}

export interface TracingConfigStats {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly runtime: string;
  readonly exporter: string;
  readonly otlpEndpoint: string | null;
  readonly sampler: string;
  readonly samplingRatio: number;
  readonly ignoreRoutes: readonly string[];
  readonly consoleBufferEnabled: boolean;
  readonly consoleBufferMax: number;
  readonly bufferedSpans: number;
  readonly exportedSpans: number;
  readonly droppedSpans: number;
}

export interface TracedOptions {
  readonly category?: SpanCategory;
  readonly attributes?: Record<string, string | number | boolean>;
}
