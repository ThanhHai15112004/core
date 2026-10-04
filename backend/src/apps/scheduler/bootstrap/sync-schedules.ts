import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QueueRegistry } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ScheduledTaskRegistry,
  type ScheduledTaskDefinition,
} from '../registry/scheduled-task.registry.js';

@Injectable()
export class ScheduleSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleSyncService.name);

  constructor(
    private readonly queueRegistry: QueueRegistry,
    private readonly redis: RedisService,
    private readonly taskRegistry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  public async sync(): Promise<void> {
    try {
      const disabledIds = new Set(await this.redis.client.smembers('scheduler:disabled'));
      const tasks = this.taskRegistry.list();

      // Lưu định nghĩa task vào Redis để System Console / Ops API đọc xuyên runtime
      if (tasks.length > 0) {
        const pipeline = this.redis.client.pipeline();
        for (const t of tasks) {
          pipeline.hset('scheduler:definitions', t.id, JSON.stringify(t));
        }
        await pipeline.exec();
      }

      // Nhóm task theo queue đích
      const byQueue = new Map<string, ScheduledTaskDefinition[]>();
      for (const t of tasks) {
        const list = byQueue.get(t.queue) ?? [];
        list.push(t);
        byQueue.set(t.queue, list);
      }

      for (const [queueName, queueTasks] of byQueue.entries()) {
        try {
          const queue = this.queueRegistry.getQueue(queueName);
          const existing = await queue.getJobSchedulers();
          const existingMap = new Map(
            existing.map((s: { id?: string | null; key?: string }) => [s.id ?? s.key ?? '', s]),
          );

          for (const task of queueTasks) {
            if (disabledIds.has(task.id)) {
              if (existingMap.has(task.id)) {
                await queue.removeJobScheduler(task.id);
                this.logger.log(
                  `Disabled scheduler "${task.id}" removed from queue "${queueName}"`,
                );
              }
            } else {
              const repeatOpts: { pattern?: string; every?: number; tz?: string } = {};
              if (task.pattern) repeatOpts.pattern = task.pattern;
              if (task.every) repeatOpts.every = task.every;
              repeatOpts.tz = task.tz ?? this.config.scheduler.timezone;

              await queue.upsertJobScheduler(task.id, repeatOpts, {
                name: task.name ?? task.id,
                data: task.data ?? {},
              });
              this.logger.log(`Synced scheduler "${task.id}" on queue "${queueName}"`);
            }
          }

          // Dọn các scheduler không còn khai báo trong mã nguồn
          const taskIds = new Set(queueTasks.map((t) => t.id));
          for (const sched of existing) {
            const sId = sched.id;
            if (sId && !taskIds.has(sId)) {
              await queue.removeJobScheduler(sId);
              this.logger.log(`Removed orphan scheduler "${sId}" from queue "${queueName}"`);
            }
          }
        } catch (queueErr) {
          this.logger.error(
            `Failed to sync schedules for queue "${queueName}": ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Schedule synchronization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
