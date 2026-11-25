import { Injectable } from '@nestjs/common';
import type { Context, Span } from '@opentelemetry/api';
import type {
  RecentTraceSummary,
  RecordedSpan,
  TracingConfigStats,
} from '../contracts/tracing.types.js';
import { runInSpan, type RunInSpanOptions } from '../utils/span.util.js';
import {
  extractTraceContext,
  getActiveSpanContext,
  injectTraceContext,
  type ActiveSpanContextInfo,
} from '../utils/trace-context.util.js';
import { TracingSdkService } from './tracing-sdk.service.js';

/**
 * Facade dùng chung cho các module nghiệp vụ và System Console truy vấn span,
 * mở custom span và thao tác W3C TraceContext.
 */
@Injectable()
export class TracingService {
  constructor(private readonly sdk: TracingSdkService) {}

  public runInSpan<T>(name: string, options: RunInSpanOptions, fn: (span: Span) => T): T {
    return runInSpan(name, options, fn);
  }

  public getActiveSpanContext(): ActiveSpanContextInfo | null {
    return getActiveSpanContext();
  }

  public injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
    return injectTraceContext(carrier);
  }

  public extractTraceContext(carrier: Record<string, unknown> | null | undefined): Context {
    return extractTraceContext(carrier);
  }

  public getSpansByTraceId(traceId: string): Promise<RecordedSpan[]> {
    return this.sdk.spanBuffer.getSpansByTraceId(traceId);
  }

  public getRecentTraces(limit = 20): Promise<RecentTraceSummary[]> {
    return this.sdk.spanBuffer.getRecentTraces(limit);
  }

  public getStats(): TracingConfigStats {
    return this.sdk.getStats();
  }
}
