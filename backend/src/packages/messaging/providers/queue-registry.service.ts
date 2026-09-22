import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '@packages/redis/index.js';
import { QUEUES, type QueueName } from '../constants/queues.constant.js';

/** Giữ một BullMQ `Queue` cho mỗi queue khai báo trong `QUEUES` (tạo khi dùng lần đầu). */
@Injectable()
export class QueueRegistry implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly redis: RedisService) {}

  public names(): QueueName[] {
    return Object.values(QUEUES);
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

  /** BullMQ đợi Redis vô thời hạn; bọc timeout để caller không bị treo khi Redis sập. */
  public async withTimeout<T>(task: Promise<T>, ms = 2000): Promise<T> {
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
