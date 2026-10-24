import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { CoreConfigService } from '@packages/config/index.js';
import {
  MAX_JOB_ATTEMPTS_CAP,
  QUEUE_PROFILES,
  QUEUES,
  type QueueName,
  type QueueProfile,
} from '../constants/queues.constant.js';
import type { PublishOptions } from '../contracts/job-meta.types.js';

/** Client Redis của BullMQ (backend Redis) — dùng cho PING và đọc zset `delayed`. */
export const rawClient = (q: Queue): Promise<Redis> =>
  q.getBackend().client as unknown as Promise<Redis>;

/**
 * Tra cứu `Queue` đã đăng ký qua `BullModule.registerQueue` (vòng đời do `@nestjs/bullmq` quản lý) + option mặc
 * định của message. Không tự tạo/đóng kết nối.
 */
@Injectable()
export class QueueRegistry implements OnModuleInit {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly config?: CoreConfigService,
  ) {}

  /** Đăng ký và khởi tạo các thiết lập tài nguyên khi nạp module */
  public onModuleInit(): void {
    for (const name of this.names()) {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      // Lỗi kết nối được báo qua `error` — không có listener thì Node coi là lỗi chưa xử lý.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
  }

  /** Lấy danh sách toàn bộ tên các hàng đợi đã đăng ký */
  public names(): QueueName[] {
    return Object.values(QUEUES);
  }

  /** Lấy cấu hình hồ sơ vận hành mặc định của một hàng đợi */
  public profile(name: QueueName): QueueProfile {
    return QUEUE_PROFILES[name] ?? QUEUE_PROFILES[QUEUES.SYSTEM_EVENTS];
  }

  /** Kiểm tra xem tên hàng đợi hoặc kênh có hợp lệ trong danh mục hay không */
  public isKnown(name: string): name is QueueName {
    return (this.names() as string[]).includes(name);
  }

  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public get(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Queue "${name}" is not registered`);
    return queue;
  }

  /** Lấy đối tượng hàng đợi BullMQ theo tên định danh */
  public getQueue(name: string): Queue {
    return this.get(name as QueueName);
  }

  /** Lấy bản đồ (Map) toàn bộ các hàng đợi BullMQ đã đăng ký */
  public getQueues(): Map<QueueName, Queue> {
    return this.queues;
  }

  /**
   * Option mặc định của message: retry theo cấu hình (chặn trần chống retry vô hạn), giữ message đã xong/Dead Letter
   * có giới hạn, giữ log vòng đời. `jobId` = id envelope để tra cứu được theo message ID.
   */
  public jobOptions(jobId: string, queue?: QueueName, options?: PublishOptions): JobsOptions {
    return { jobId, ...this.retentionOptions(queue, options) };
  }

  /** Retry + giới hạn job đã xong/thất bại — dùng cả cho job do Job Scheduler / Run Now tạo (không có `jobId`). */
  public retentionOptions(queue?: QueueName, options?: PublishOptions): Omit<JobsOptions, 'jobId'> {
    const m = this.config?.messaging;
    const prof = queue ? QUEUE_PROFILES[queue] : undefined;
    const cap = m?.maxAttemptsCap ?? MAX_JOB_ATTEMPTS_CAP;
    const requestedAttempts =
      options?.attempts ?? (m ? m.maxAttempts : (prof?.defaultAttempts ?? 1));
    const attempts = Math.min(cap, Math.max(1, Math.round(requestedAttempts)));
    const backoffType = options?.backoff ?? m?.backoff ?? prof?.defaultBackoff ?? 'exponential';
    const backoffDelay =
      options?.backoffDelayMs ?? (m ? m.backoffDelayMs : (prof?.defaultBackoffDelayMs ?? 0));

    return {
      attempts,
      ...(attempts > 1 && backoffDelay > 0
        ? { backoff: { type: backoffType, delay: Math.max(0, Math.round(backoffDelay)) } }
        : {}),
      removeOnComplete: { count: m?.keepCompleted ?? 1000 },
      removeOnFail: { count: m?.keepDeadLetter ?? 1000 },
      keepLogs: m?.keepLifecycle ?? 50,
    };
  }

  /** BullMQ đợi Redis vô thời hạn; bọc timeout để caller không bị treo khi Redis sập. */
  public async withTimeout<T>(task: Promise<T>, ms = this.config?.messaging.timeoutMs ?? 2000) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Queue operation timed out')), ms);
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
