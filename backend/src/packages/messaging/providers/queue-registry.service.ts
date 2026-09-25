import { Injectable, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';

/** Client Redis của BullMQ (backend Redis) — dùng cho PING và đọc zset `delayed`. */
export const rawClient = (q: Queue): Promise<Redis> =>
  q.getBackend().client as unknown as Promise<Redis>;

/** Giữ một BullMQ `Queue` cho mỗi queue khai báo trong `QUEUES` (tạo khi dùng lần đầu). */
@Injectable()
export class QueueRegistry implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly config?: CoreConfigService,
  ) {}

  public names(): QueueName[] {
    return Object.values(QUEUES);
  }

  public isKnown(name: string): name is QueueName {
    return (this.names() as string[]).includes(name);
  }

  public get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.redis.bullConnection(),
        prefix: this.redis.bullPrefix(),
      });
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * Option mặc định của message: retry theo cấu hình, giữ message đã xong/Dead Letter có giới hạn,
   * giữ log vòng đời. `jobId` = id envelope để tra cứu được theo message ID.
   */
  public jobOptions(jobId: string): JobsOptions {
    const m = this.config?.messaging;
    return {
      jobId,
      attempts: m?.maxAttempts ?? 1,
      ...(m && m.maxAttempts > 1 && m.backoffDelayMs > 0
        ? { backoff: { type: m.backoff, delay: m.backoffDelayMs } }
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

  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
