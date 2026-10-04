import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingConnectionService,
  QueueRegistry,
  sanitizeMessagingMessage,
  type JobEventRecord,
  type JobOperationRecord,
} from '@packages/messaging/index.js';
import { BullMqJobProvider } from '../providers/bullmq-job.provider.js';
import type {
  JobCapability,
  JobDetailRaw,
  JobProvider,
  JobRecord,
} from '../contracts/job.types.js';
import type { QueueSection } from '../contracts/queue-monitoring.types.js';

/**
 * Đọc job thẳng từ BullMQ (`getJobs`, `getJob`, job log) qua job provider. Không giữ dữ liệu phụ trong Redis
 * (chỉ mục tìm kiếm, bản ghi huỷ, sự kiện đã bỏ) — audit thao tác nằm trong Logs (field `audit`).
 */
@Injectable()
export class JobMonitoringService {
  public readonly provider: JobProvider;

  constructor(
    registry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    redis: RedisService,
  ) {
    this.provider = new BullMqJobProvider(registry, redis);
  }

  public supports(cap: JobCapability): boolean {
    return this.provider.capabilities.has(cap);
  }

  public status() {
    return this.connection.getStatus();
  }

  public usable(): boolean {
    return this.status().state === 'connected';
  }

  public async section<T>(
    cap: JobCapability | null,
    fn: () => Promise<T>,
  ): Promise<QueueSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: 'BullMQ' };
    if (!this.usable())
      return { available: false, reason: 'disconnected', message: this.status().state };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      return { available: false, reason: 'error', message: sanitizeMessagingMessage(err) };
    }
  }

  public get(id: string, queue?: string | null): Promise<JobRecord | null> {
    return this.provider.get(id, queue);
  }

  public detail(id: string, queue?: string | null): Promise<JobDetailRaw | null> {
    return this.provider.detail(id, queue);
  }

  /** Đọc nhiều job theo tham chiếu (job đã bị dọn khỏi broker thì bỏ qua). */
  public async records(refs: { queue: string; id: string }[]): Promise<JobRecord[]> {
    const out = await Promise.all(
      refs
        .filter((r) => this.provider.isKnown(r.queue))
        .map((r) => this.get(r.id, r.queue).catch(() => null)),
    );
    return out.filter((r): r is JobRecord => r !== null);
  }

  /** Sự kiện job không còn tự lưu — xem Logs. */
  public async events(): Promise<JobEventRecord[]> {
    return [];
  }

  /** Audit thao tác nằm trong Logs (field `audit`). */
  public async operations(): Promise<JobOperationRecord[]> {
    return [];
  }
}
