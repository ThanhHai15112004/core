import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { PromSample, PromSeries, PrometheusStatus } from '../contracts/metrics.types.js';

interface PromResponse {
  status: 'success' | 'error';
  error?: string;
  data?: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string';
    result: unknown;
  };
}

type VectorItem = { metric: Record<string, string>; value: [number, string] };
type MatrixItem = { metric: Record<string, string>; values: Array<[number, string]> };

export class PrometheusUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PrometheusUnavailableError';
  }
}

const toNumber = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * Client đọc Prometheus HTTP API (`/api/v1/query`, `/api/v1/query_range`) bằng `fetch`.
 * Nguồn lịch sử duy nhất cho biểu đồ của System Console — không tự lưu time-series.
 */
@Injectable()
export class PrometheusQueryClient {
  private lastError: string | null = null;

  constructor(private readonly config: CoreConfigService) {}

  public get configured(): boolean {
    return this.config.metrics.prometheusUrl !== '';
  }

  /** Instant query; mẫu có giá trị không hữu hạn (NaN/Inf) bị bỏ. */
  public async query(expr: string): Promise<PromSample[]> {
    const data = await this.request('query', { query: expr });
    if (data.resultType === 'scalar') {
      const [, raw] = data.result as [number, string];
      const value = toNumber(raw);
      return value === null ? [] : [{ labels: {}, value }];
    }
    return (data.result as VectorItem[]).flatMap((item) => {
      const value = toNumber(item.value[1]);
      return value === null ? [] : [{ labels: item.metric, value }];
    });
  }

  /** Giá trị đầu tiên của instant query; `null` khi không có dữ liệu hoặc Prometheus không khả dụng. */
  public async value(expr: string): Promise<number | null> {
    try {
      return (await this.query(expr))[0]?.value ?? null;
    } catch {
      return null;
    }
  }

  /** Như `query` nhưng trả `[]` khi Prometheus không khả dụng. */
  public async safeQuery(expr: string): Promise<PromSample[]> {
    try {
      return await this.query(expr);
    } catch {
      return [];
    }
  }

  /** Range query trong `minutes` phút gần nhất, bước `stepSec` giây. */
  public async range(expr: string, minutes: number, stepSec: number): Promise<PromSeries[]> {
    const end = Math.floor(Date.now() / 1000);
    const start = end - minutes * 60;
    const data = await this.request('query_range', {
      query: expr,
      start: String(start),
      end: String(end),
      step: String(Math.max(1, Math.round(stepSec))),
    });
    return (data.result as MatrixItem[]).map((item) => ({
      labels: item.metric,
      points: item.values.flatMap(([t, raw]) => {
        const v = toNumber(raw);
        return v === null ? [] : [{ t: t * 1000, v }];
      }),
    }));
  }

  /** Như `range` nhưng trả `[]` khi Prometheus không khả dụng. */
  public async safeRange(expr: string, minutes: number, stepSec: number): Promise<PromSeries[]> {
    try {
      return await this.range(expr, minutes, stepSec);
    } catch {
      return [];
    }
  }

  public async status(): Promise<PrometheusStatus> {
    const url = this.config.metrics.prometheusUrl || null;
    if (!url) return { configured: false, up: false, url: null, error: null };
    try {
      const res = await fetch(`${url}/-/ready`, {
        signal: AbortSignal.timeout(this.config.metrics.queryTimeoutMs),
      });
      this.lastError = res.ok ? null : `HTTP ${res.status}`;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    return { configured: true, up: this.lastError === null, url, error: this.lastError };
  }

  private async request(
    path: 'query' | 'query_range',
    params: Record<string, string>,
  ): Promise<NonNullable<PromResponse['data']>> {
    const base = this.config.metrics.prometheusUrl;
    if (!base) throw new PrometheusUnavailableError('PROMETHEUS_URL is not configured');
    let body: PromResponse;
    try {
      const res = await fetch(`${base}/api/v1/${path}?${new URLSearchParams(params).toString()}`, {
        signal: AbortSignal.timeout(this.config.metrics.queryTimeoutMs),
      });
      body = (await res.json()) as PromResponse;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw new PrometheusUnavailableError(this.lastError);
    }
    if (body.status !== 'success' || !body.data) {
      this.lastError = body.error ?? 'Prometheus query failed';
      throw new PrometheusUnavailableError(this.lastError);
    }
    this.lastError = null;
    return body.data;
  }
}
