/** Tuỳ chọn của `MetricsModule.forRuntime()`. */
export interface MetricsModuleOptions {
  /** Nhãn `runtime` gắn vào mọi metric (api, worker, scheduler, cli). */
  runtime: string;
  /** Cổng HTTP `/metrics` riêng cho runtime không có HTTP server (worker 9101, scheduler 9102). */
  port?: number;
  /** Nhãn `instance` định danh tiến trình/pod (mặc định đọc `INSTANCE_ID` hoặc `hostname:pid`). */
  instance?: string;
  /** Nhãn `version` phiên bản ứng dụng (mặc định đọc `APP_VERSION`). */
  version?: string;
}

export const METRICS_OPTIONS = Symbol('METRICS_OPTIONS');

/** Một mẫu của PromQL instant query. */
export interface PromSample {
  labels: Record<string, string>;
  value: number;
}

/** Một chuỗi của PromQL range query (`t` epoch ms). */
export interface PromSeries {
  labels: Record<string, string>;
  points: Array<{ t: number; v: number }>;
}

export interface PrometheusStatus {
  configured: boolean;
  up: boolean;
  url: string | null;
  error: string | null;
}
