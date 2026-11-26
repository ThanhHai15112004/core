import * as os from 'node:os';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
  type MetricObjectWithValues,
  type MetricValue,
} from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { METRICS_OPTIONS, type MetricsModuleOptions } from '../contracts/metrics.types.js';

/** Bucket (giây) cho thời gian xử lý HTTP/job — đủ mịn để tính p95/p99 bằng `histogram_quantile`. */
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/**
 * Registry prom-client của runtime. Mỗi instance có registry riêng (không dùng registry toàn cục) để test tạo nhiều
 * app trong cùng process không bị "metric already registered". Mọi metric mang nhãn `runtime`, `instance`, `version`.
 */
@Injectable()
export class MetricsRegistryService {
  public readonly registry = new Registry();
  public readonly runtime: string;
  public readonly instance: string;
  public readonly version: string;
  public readonly httpDuration: Histogram<'method' | 'route' | 'status' | 'module'>;
  public readonly httpRequestsTotal: Counter<
    'method' | 'route' | 'status' | 'status_class' | 'module'
  >;
  public readonly httpRequestsInFlight: Gauge;

  constructor(
    @Inject(METRICS_OPTIONS) options: MetricsModuleOptions,
    @Optional() config?: CoreConfigService,
  ) {
    this.runtime = options.runtime;
    this.instance = options.instance ?? config?.app.instanceId ?? `${os.hostname()}:${process.pid}`;
    this.version = options.version ?? config?.app.version ?? '1.0.0';
    this.registry.setDefaultLabels({
      runtime: this.runtime,
      instance: this.instance,
      version: this.version,
    });
    collectDefaultMetrics({ register: this.registry });
    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status', 'module'],
      buckets: DURATION_BUCKETS,
      registers: [this.registry],
    });
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP API requests by method, route, status, status_class and module',
      labelNames: ['method', 'route', 'status', 'status_class', 'module'],
      registers: [this.registry],
    });
    this.httpRequestsInFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'Current number of in-flight inbound HTTP API requests being processed',
      registers: [this.registry],
    });
    this.httpRequestsInFlight.set(0);
  }

  /** Lấy counter đã có hoặc tạo mới (package khác dùng để khai báo metric riêng). */
  public counter<L extends string>(name: string, help: string, labelNames: L[] = []): Counter<L> {
    const existing = this.registry.getSingleMetric(name);
    if (existing) return existing as Counter<L>;
    return new Counter({ name, help, labelNames, registers: [this.registry] });
  }

  /** Khởi tạo hoặc cập nhật chỉ số đo lường Gauge cho Prometheus */
  public gauge<L extends string>(name: string, help: string, labelNames: L[] = []): Gauge<L> {
    const existing = this.registry.getSingleMetric(name);
    if (existing) return existing as Gauge<L>;
    return new Gauge({ name, help, labelNames, registers: [this.registry] });
  }

  /** Khởi tạo hoặc lấy chỉ số đo lường Histogram cho Prometheus */
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

  /** Xuất toàn bộ metric trong registry ở dạng JSON (dùng cho local fallback khi không có Prometheus). */
  public getMetricsJson(): Promise<MetricObjectWithValues<MetricValue<string>>[]> {
    return this.registry.getMetricsAsJSON();
  }

  /** Đếm tổng số lượng mẫu đo lường hiện có */
  public metricCount(): number {
    return this.registry.getMetricsAsArray().length;
  }
}
