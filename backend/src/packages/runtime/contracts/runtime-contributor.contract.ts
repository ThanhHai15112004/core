import type { MetricValue, RuntimeDescriptor, RuntimeIssue } from './runtime.types.js';

/**
 * Mỗi runtime đăng ký một contributor với `RuntimeAgentService` để cung cấp
 * metric riêng và các hook điều khiển (pause/resume/drain).
 */
export interface RuntimeContributor {
  describe(): RuntimeDescriptor;
  collectMetrics(): Promise<Record<string, MetricValue>>;
  collectIssues?(): Promise<RuntimeIssue[]>;
  /** Dữ liệu có cấu trúc cho trang chi tiết (vd. danh sách task, queue). */
  collectDetails?(): Promise<Record<string, unknown>>;
  /** Ngừng nhận việc mới nhưng process vẫn sống (Stop từ Console). */
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  /** Chờ việc đang chạy hoàn tất trước khi graceful restart. */
  drain?(): Promise<void>;
}
