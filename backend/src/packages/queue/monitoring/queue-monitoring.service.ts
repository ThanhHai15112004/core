import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingConnectionService,
  QueueRegistry,
  sanitizeMessagingMessage,
  type MessagingConnectionStatus,
} from '@packages/messaging/index.js';
import { BullMqQueueProvider } from '../providers/bullmq-queue.provider.js';
import { QueueOperationError } from '../utils/queue-errors.js';
import type {
  QueueCapability,
  QueueInfo,
  QueueMonitoringProvider,
  QueueSection,
} from '../contracts/queue-monitoring.types.js';

/** Snapshot queue dùng lại trong chừng này (nhiều bảng trên cùng trang gọi cùng lúc). */
const SNAPSHOT_TTL_MS = 5000;

/**
 * Đọc số liệu công việc nền qua queue provider (hiện tại: BullMQ). Chỉ đọc.
 * Queue provider độc lập với messaging provider về khái niệm; hiện hai bên dùng chung kết nối BullMQ/Redis
 * nên trạng thái kết nối lấy từ `MessagingConnectionService` (PING định kỳ tới đúng Redis đó).
 */
@Injectable()
export class QueueMonitoringService {
  public readonly provider: QueueMonitoringProvider;
  private cache: { at: number; data: Promise<QueueInfo[]> } | null = null;

  constructor(
    registry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    config: CoreConfigService,
    redis: RedisService,
  ) {
    const { host, port, db } = config.cache.redis;
    this.provider = new BullMqQueueProvider(registry, redis, `${host}:${port}/${db}`);
  }

  /** Kiểm tra xem tính năng chỉ định có được hỗ trợ hay không */
  public supports(cap: QueueCapability): boolean {
    return this.provider.capabilities.has(cap);
  }

  /** Lấy trạng thái vận hành hiện tại của dịch vụ */
  public status(): MessagingConnectionStatus {
    return this.connection.getStatus();
  }

  /** Kiểm tra dịch vụ có đủ điều kiện để sẵn sàng sử dụng hay không */
  public usable(): boolean {
    return this.status().state === 'connected';
  }

  /** Một phần số liệu; lỗi/không hỗ trợ/mất kết nối → lý do, không ném. */
  public async section<T>(
    cap: QueueCapability | null,
    fn: () => Promise<T>,
  ): Promise<QueueSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: this.provider.info().product };
    if (!this.usable())
      return { available: false, reason: 'disconnected', message: this.status().state };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      return { available: false, reason: 'error', message: sanitizeMessagingMessage(err) };
    }
  }

  /** Lấy danh sách các hàng đợi tin nhắn hiện có */
  public queues(): Promise<QueueInfo[]> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > SNAPSHOT_TTL_MS) {
      const data = this.provider.queues();
      data.catch(() => (this.cache = null));
      this.cache = { at: now, data };
    }
    return this.cache.data;
  }

  /** Kiểm tra xem lỗi phát sinh có phải là lỗi không tìm thấy hay không */
  public isNotFound(err: unknown): boolean {
    return err instanceof QueueOperationError && err.code === 'NOT_FOUND';
  }

  /** Bỏ cache sau thao tác (pause/resume/retry/drain) để số liệu cập nhật ngay. */
  public invalidate(): void {
    this.cache = null;
  }
}
