import { Injectable } from '@nestjs/common';
import { PrometheusQueryClient } from './prometheus-query.client.js';

/** Số đo HTTP trong cửa sổ; các số đếm `null` khi Prometheus không trả lời (không phải 0). */
export interface HttpMetricsSnapshot {
  windowSeconds: number;
  totalRequests: number | null;
  requestsPerSecond: number | null;
  errorCount: number | null;
  /** Tỷ lệ phản hồi 5xx trong cửa sổ, tính theo %. */
  errorRatePercent: number | null;
  /** `null` khi chưa có request hoặc Prometheus không khả dụng. */
  p95LatencyMs: number | null;
}

const H = 'http_request_duration_seconds';

/** Số liệu HTTP tổng hợp từ Prometheus (`http_request_duration_seconds`) — thay thống kê in-memory cũ. */
@Injectable()
export class HttpMetricsReader {
  constructor(private readonly prom: PrometheusQueryClient) {}

  public async snapshot(windowSeconds = 60): Promise<HttpMetricsSnapshot> {
    const w = `${windowSeconds}s`;
    const [total, errors, p95] = await Promise.all([
      this.prom.value(`sum(increase(${H}_count[${w}]))`),
      this.prom.value(`sum(increase(${H}_count{status=~"5.."}[${w}]))`),
      this.prom.value(`histogram_quantile(0.95, sum by (le) (rate(${H}_bucket[${w}])))`),
    ]);
    if (total === null)
      return {
        windowSeconds,
        totalRequests: null,
        requestsPerSecond: null,
        errorCount: null,
        errorRatePercent: null,
        p95LatencyMs: null,
      };
    const totalRequests = Math.round(total);
    const errorCount = Math.round(errors ?? 0);
    return {
      windowSeconds,
      totalRequests,
      requestsPerSecond: Number((totalRequests / windowSeconds).toFixed(2)),
      errorCount,
      errorRatePercent:
        totalRequests === 0 ? 0 : Number(((errorCount / totalRequests) * 100).toFixed(2)),
      p95LatencyMs: p95 === null ? null : Math.round(p95 * 1000),
    };
  }
}
