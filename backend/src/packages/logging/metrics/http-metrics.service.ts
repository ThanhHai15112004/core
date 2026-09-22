import { Injectable } from '@nestjs/common';

export interface HttpMetricsSnapshot {
  windowSeconds: number;
  totalRequests: number;
  requestsPerSecond: number;
  errorCount: number;
  /** Tỷ lệ phản hồi 5xx trong cửa sổ, tính theo %. */
  errorRatePercent: number;
  /** `null` khi chưa có request nào trong cửa sổ. */
  p95LatencyMs: number | null;
}

interface RequestSample {
  at: number;
  durationMs: number;
  isError: boolean;
}

/** Thống kê HTTP trong bộ nhớ theo cửa sổ trượt (mặc định 60 giây) của process hiện tại. */
@Injectable()
export class HttpMetricsService {
  private readonly windowMs = 60_000;
  private samples: RequestSample[] = [];
  private active = 0;

  /** Gọi khi request bắt đầu / kết thúc để đếm request đang xử lý. */
  public begin(): void {
    this.active++;
  }

  public end(): void {
    this.active = Math.max(0, this.active - 1);
  }

  public activeRequests(): number {
    return this.active;
  }

  public record(durationMs: number, statusCode: number): void {
    const now = Date.now();
    this.samples.push({ at: now, durationMs, isError: statusCode >= 500 });
    this.prune(now);
  }

  public snapshot(): HttpMetricsSnapshot {
    this.prune(Date.now());

    const total = this.samples.length;
    const errorCount = this.samples.filter((s) => s.isError).length;
    const windowSeconds = this.windowMs / 1000;

    return {
      windowSeconds,
      totalRequests: total,
      requestsPerSecond: Number((total / windowSeconds).toFixed(2)),
      errorCount,
      errorRatePercent: total === 0 ? 0 : Number(((errorCount / total) * 100).toFixed(2)),
      p95LatencyMs: this.percentile(95),
    };
  }

  private percentile(p: number): number | null {
    if (this.samples.length === 0) {
      return null;
    }
    const sorted = this.samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[index] ?? null;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    const firstValid = this.samples.findIndex((s) => s.at >= cutoff);
    this.samples = firstValid === -1 ? [] : this.samples.slice(firstValid);
  }
}
