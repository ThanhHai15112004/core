import { SpanKind, SpanStatusCode, type Context } from '@opentelemetry/api';
import { hrTimeToMilliseconds } from '@opentelemetry/core';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { safeJsonParse } from '@packages/kernel/index.js';
import type { RedisService } from '@packages/redis/index.js';
import {
  SPAN_CATEGORY_ATTR,
  TRACING_STREAM_PREFIX,
  type SpanCategory,
} from '../constants/tracing.constant.js';
import type {
  RecentTraceSummary,
  RecordedSpan,
  RecordedSpanKind,
  RecordedSpanStatus,
} from '../contracts/tracing.types.js';
import { sanitizeSpanAttributes } from '../utils/span.util.js';

type StreamRow = [id: string, fields: string[]];

const SPAN_KIND_MAP: Record<SpanKind, RecordedSpanKind> = {
  [SpanKind.SERVER]: 'server',
  [SpanKind.CLIENT]: 'client',
  [SpanKind.PRODUCER]: 'producer',
  [SpanKind.CONSUMER]: 'consumer',
  [SpanKind.INTERNAL]: 'internal',
};

const SPAN_STATUS_MAP: Record<SpanStatusCode, RecordedSpanStatus> = {
  [SpanStatusCode.UNSET]: 'unset',
  [SpanStatusCode.OK]: 'ok',
  [SpanStatusCode.ERROR]: 'error',
};

const VALID_CATEGORIES = new Set<SpanCategory>(['api', 'db', 'http', 'job', 'usecase', 'internal']);

function resolveCategory(span: ReadableSpan): SpanCategory {
  const raw = span.attributes[SPAN_CATEGORY_ATTR];
  if (typeof raw === 'string' && VALID_CATEGORIES.has(raw as SpanCategory)) {
    return raw as SpanCategory;
  }
  if (span.kind === SpanKind.SERVER) return 'api';
  if (span.kind === SpanKind.PRODUCER || span.kind === SpanKind.CONSUMER) return 'job';
  if (typeof span.attributes['db.system'] === 'string') return 'db';
  if (typeof span.attributes['http.request.method'] === 'string') return 'http';
  return 'internal';
}

function toFlatAttributes(
  raw: ReadableSpan['attributes'],
): Record<string, string | number | boolean> {
  const input: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      input[k] = v;
    } else if (Array.isArray(v)) {
      input[k] = v.map((item) => String(item)).join(', ');
    }
  }
  const sanitized = sanitizeSpanAttributes(input);
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(sanitized)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

/**
 * SpanProcessor nhẹ giữ các span gần nhất trong ring-buffer bộ nhớ và Redis Stream (`traces:<env>`)
 * để System Console hiển thị waterfall cơ bản ngay cả khi chưa cài đặt Jaeger/Tempo.
 */
export class SpanBufferProcessor implements SpanProcessor {
  private readonly buffer: RecordedSpan[] = [];
  private redis: RedisService | null = null;
  private streamKey: string | null = null;
  private exportedCount = 0;
  private droppedCount = 0;

  constructor(
    private readonly options: {
      readonly maxSize: number;
      readonly runtime: string;
      readonly serviceName: string;
    },
  ) {}

  /** Gắn RedisService khi module sẵn sàng để chia sẻ span giữa API / Worker / Scheduler. */
  public attachRedis(redis: RedisService, envName: string): void {
    this.redis = redis;
    this.streamKey = redis.key(TRACING_STREAM_PREFIX, envName);
  }

  public get bufferedCount(): number {
    return this.buffer.length;
  }

  public get exportedSpans(): number {
    return this.exportedCount;
  }

  public get droppedSpans(): number {
    return this.droppedCount;
  }

  public onStart(_span: Span, _parentContext: Context): void {
    // Không xử lý khi span mới mở để tránh tốn chi phí
  }

  public onEnd(span: ReadableSpan): void {
    const sc = span.spanContext();
    const startTimeMs = Math.round(hrTimeToMilliseconds(span.startTime));
    const endTimeMs = Math.round(hrTimeToMilliseconds(span.endTime));
    const durationMs = Math.max(
      0,
      Math.round(hrTimeToMilliseconds(span.duration) * 100) / 100,
    );

    const recorded: RecordedSpan = {
      traceId: sc.traceId,
      spanId: sc.spanId,
      parentSpanId: span.parentSpanContext?.spanId ?? null,
      name: span.name,
      category: resolveCategory(span),
      kind: SPAN_KIND_MAP[span.kind] ?? 'internal',
      runtime: this.options.runtime,
      service: this.options.serviceName,
      startTimeMs,
      endTimeMs,
      durationMs,
      status: SPAN_STATUS_MAP[span.status.code] ?? 'unset',
      statusMessage: span.status.message ?? null,
      attributes: toFlatAttributes(span.attributes),
    };

    this.pushMemory(recorded);
    this.exportedCount += 1;
    this.writeRedis(recorded);
  }

  public async forceFlush(): Promise<void> {
    // Buffer ghi tức thì theo từng span
  }

  public async shutdown(): Promise<void> {
    // Không cần đóng tài nguyên riêng (RedisService tự quản lý shutdown)
  }

  /** Xóa buffer bộ nhớ (chủ yếu dùng cho unit test). */
  public clear(): void {
    this.buffer.length = 0;
    this.exportedCount = 0;
    this.droppedCount = 0;
  }

  /** Lấy danh sách span thuộc một `traceId` (hợp nhất Redis + bộ nhớ cục bộ, sắp xếp theo thời gian). */
  public async getSpansByTraceId(traceId: string): Promise<RecordedSpan[]> {
    const all = await this.readCombinedSpans();
    return all
      .filter((s) => s.traceId === traceId)
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
  }

  /** Tóm tắt các trace gần nhất từ buffer để hiển thị danh sách chọn nhanh trên System Console. */
  public async getRecentTraces(limit = 20): Promise<RecentTraceSummary[]> {
    const all = await this.readCombinedSpans();
    const grouped = new Map<string, RecordedSpan[]>();
    for (const span of all) {
      const list = grouped.get(span.traceId);
      if (list) list.push(span);
      else grouped.set(span.traceId, [span]);
    }

    const summaries: RecentTraceSummary[] = [];
    for (const [traceId, spans] of grouped.entries()) {
      spans.sort((a, b) => a.startTimeMs - b.startTimeMs);
      const root = spans.find((s) => !s.parentSpanId) ?? spans[0];
      if (!root) continue;
      const minStart = spans[0]?.startTimeMs ?? root.startTimeMs;
      const maxEnd = spans.reduce((acc, s) => Math.max(acc, s.endTimeMs), root.endTimeMs);
      const hasError = spans.some((s) => s.status === 'error');
      summaries.push({
        traceId,
        rootName: root.name,
        runtime: root.runtime,
        service: root.service,
        status: hasError ? 'error' : 'ok',
        durationMs: Math.max(root.durationMs, maxEnd - minStart),
        spanCount: spans.length,
        startedAt: new Date(minStart).toISOString(),
      });
    }

    return summaries
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(1, limit));
  }

  private pushMemory(span: RecordedSpan): void {
    this.buffer.push(span);
    if (this.buffer.length > this.options.maxSize) {
      this.buffer.splice(0, this.buffer.length - this.options.maxSize);
    }
  }

  private writeRedis(span: RecordedSpan): void {
    if (!this.redis?.isReady() || !this.streamKey) return;
    try {
      const payload = JSON.stringify(span);
      void this.redis.client
        .xadd(this.streamKey, 'MAXLEN', '~', String(this.options.maxSize), '*', 'd', payload)
        .catch(() => {
          this.droppedCount += 1;
        });
    } catch {
      this.droppedCount += 1;
    }
  }

  private async readCombinedSpans(): Promise<RecordedSpan[]> {
    const bySpanId = new Map<string, RecordedSpan>();
    for (const local of this.buffer) {
      bySpanId.set(`${local.traceId}:${local.spanId}`, local);
    }

    if (this.redis?.isReady() && this.streamKey) {
      try {
        const rows = (await this.redis.client.xrevrange(
          this.streamKey,
          '+',
          '-',
          'COUNT',
          this.options.maxSize,
        )) as StreamRow[];
        for (const [, fields] of rows) {
          const idx = fields.indexOf('d');
          const raw = idx >= 0 ? fields[idx + 1] : undefined;
          if (!raw) continue;
          const parsed = safeJsonParse<RecordedSpan | null>(raw, null);
          if (parsed && typeof parsed.traceId === 'string' && typeof parsed.spanId === 'string') {
            bySpanId.set(`${parsed.traceId}:${parsed.spanId}`, parsed);
          }
        }
      } catch {
        // Fail-open: fallback về buffer trong bộ nhớ
      }
    }

    return [...bySpanId.values()];
  }
}
