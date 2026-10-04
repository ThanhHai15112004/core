import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { CoreConfigService } from '@packages/config/index.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';

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

  public onModuleInit(): void {
    for (const name of this.names()) {
      const queue = this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
      // Lỗi kết nối được báo qua `error` — không có listener thì Node coi là lỗi chưa xử lý.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
  }

  public names(): QueueName[] {
    return Object.values(QUEUES);
  }

  public isKnown(name: string): name is QueueName {
    return (this.names() as string[]).includes(name);
  }

  public get(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Queue "${name}" is not registered`);
    return queue;
  }

  public getQueue(name: string): Queue {
    return this.get(name as QueueName);
  }

  public getQueues(): Map<QueueName, Queue> {
    return this.queues;
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
}
