import {
  formatLokiPayload,
  formatOpenSearchBulkPayload,
  formatSiemPayload,
  maskSinkEndpoint,
} from './log-sink.formatters.js';
import type { FormattedSinkRequest, LogSinkConfig, LogSinkStats } from './log-sink.types.js';

export type SinkFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText: string }>;

/**
 * Đích xuất log tập trung bất đồng bộ (multistream của Pino) gửi theo lô sang Loki, OpenSearch hoặc SIEM.
 * Không bao giờ ném lỗi hay gọi lại logger để tránh đệ quy vô hạn; dự án nhỏ có thể tắt mặc định (`LOG_SINK_ENABLED=false`).
 */
export class ExternalLogSinkDestination {
  private buffer: string[] = [];
  private config: LogSinkConfig | null = null;
  private env = 'development';
  private serviceName = 'core-app';
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  public sent = 0;
  public dropped = 0;
  public lastSuccessAt: number | null = null;
  public lastErrorAt: number | null = null;
  public lastError: string | null = null;

  constructor(private readonly fetchImpl: SinkFetch = globalThis.fetch as SinkFetch) {}

  /** Nạp cấu hình sink khi ứng dụng khởi động. */
  public configure(config: LogSinkConfig | null, env: string, serviceName: string): void {
    this.config = config;
    this.env = env || 'development';
    this.serviceName = serviceName || 'core-app';
  }

  /** Xóa cấu hình và bộ đệm hiện tại (dùng khi shutdown hoặc reset trong test). */
  public reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.config = null;
    this.buffer = [];
    this.flushing = false;
    this.sent = 0;
    this.dropped = 0;
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
  }

  /** Kiểm tra sink đã bật, chọn driver hợp lệ và có endpoint hay chưa. */
  public isActive(): boolean {
    return Boolean(
      this.config &&
      this.config.enabled &&
      this.config.driver !== 'none' &&
      this.config.endpoint.trim().length > 0,
    );
  }

  /** Nhận một dòng JSON từ Pino multistream vào buffer. */
  public write(line: string): void {
    if (!this.isActive() || !this.config) return;
    const trimmed = line.trimEnd();
    if (!trimmed) return;

    if (this.buffer.length >= this.config.maxBuffer) {
      this.dropped++;
      return;
    }

    this.buffer.push(trimmed);
    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.config.flushMs);
      this.timer.unref();
    }
  }

  /** Đẩy toàn bộ log đang chờ trong buffer sang đích tập trung. */
  public async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const cfg = this.config;
    if (this.flushing || !cfg || !this.isActive() || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const request = this.formatBatch(batch, cfg);
      if (!request.body) return;

      const res = await this.fetchImpl(cfg.endpoint.trim(), {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });

      if (!res.ok) {
        this.dropped += batch.length;
        this.lastErrorAt = Date.now();
        this.lastError = `HTTP ${res.status} ${res.statusText}`.trim();
        return;
      }

      this.sent += batch.length;
      this.lastSuccessAt = Date.now();
      this.lastError = null;
    } catch (err) {
      this.dropped += batch.length;
      this.lastErrorAt = Date.now();
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.flushing = false;
    }
  }

  /** Thống kê tình trạng gửi log tập trung (che thông tin xác thực trong endpoint). */
  public getStats(): LogSinkStats {
    const cfg = this.config;
    return {
      enabled: this.isActive(),
      driver: cfg?.driver ?? 'none',
      endpoint: cfg?.endpoint ? maskSinkEndpoint(cfg.endpoint) : null,
      batchSize: cfg?.batchSize ?? 100,
      flushMs: cfg?.flushMs ?? 2000,
      indexPrefix: cfg?.indexPrefix ?? 'app-logs',
      sent: this.sent,
      dropped: this.dropped,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastErrorAt: this.lastErrorAt ? new Date(this.lastErrorAt).toISOString() : null,
      lastError: this.lastError,
    };
  }

  private formatBatch(batch: readonly string[], cfg: LogSinkConfig): FormattedSinkRequest {
    const ctx = { env: this.env, serviceName: this.serviceName };
    switch (cfg.driver) {
      case 'loki':
        return formatLokiPayload(batch, cfg, ctx);
      case 'opensearch':
        return formatOpenSearchBulkPayload(batch, cfg);
      case 'siem':
      default:
        return formatSiemPayload(batch, cfg, ctx);
    }
  }
}
