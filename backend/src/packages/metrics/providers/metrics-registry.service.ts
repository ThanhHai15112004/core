import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { METRICS_OPTIONS, type MetricsModuleOptions } from '../contracts/metrics.types.js';

/** Bucket (giây) cho thời gian xử lý HTTP/job — đủ mịn để tính p95/p99 bằng `histogram_quantile`. */
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/**
 * Registry prom-client của runtime. Mỗi instance có registry riêng (không dùng registry toàn cục) để test tạo nhiều
 * app trong cùng process không bị "metric already registered". Mọi metric mang nhãn `runtime`.
 */
@Injectable()
export class MetricsRegistryService {
  public readonly registry = new Registry();
  public readonly runtime: string;
  public readonly httpDuration: Histogram<'method' | 'route' | 'status'>;

  constructor(@Inject(METRICS_OPTIONS) options: MetricsModuleOptions) {
    this.runtime = options.runtime;
    this.registry.setDefaultLabels({ runtime: options.runtime });
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: DURATION_BUCKETS,
      registers: [this.registry],
    });
  }

  /** Lấy counter đã có hoặc tạo mới (package khác dùng để khai báo metric riêng). */
  public counter<L extends string>(name: string, help: string, labelNames: L[] = []): Counter<L> {
    const existing = this.registry.getSingleMetric(name);
    if (existing) return existing as Counter<L>;
    return new Counter({ name, help, labelNames, registers: [this.registry] });
  }

  public gauge<L extends string>(name: string, help: string, labelNames: L[] = []): Gauge<L> {
    const existing = this.registry.getSingleMetric(name);
    if (existing) return existing as Gauge<L>;
    return new Gauge({ name, help, labelNames, registers: [this.registry] });
  }

  public histogram<L extends string>(
    name: string,
    help: string,
    labelNames: L[] = [],
    buckets: number[] = DURATION_BUCKETS,
  ): Histogram<L> {
    const existing = this.registry.getSingleMetric(name);
    if (existing) return existing as Histogram<L>;
    return new Histogram({ name, help, labelNames, buckets, registers: [this.registry] });
  }

  public get contentType(): string {
    return this.registry.contentType;
  }

  /** Nội dung định dạng text exposition của Prometheus. */
  public metrics(): Promise<string> {
    return this.registry.metrics();
  }

  public metricCount(): number {
    return this.registry.getMetricsAsArray().length;
  }
}
