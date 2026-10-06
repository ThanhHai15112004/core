import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueRegistry, schedulerKeys } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  ScheduledTaskRegistry,
  type ScheduledTaskDefinition,
} from '../registry/scheduled-task.registry.js';

/** Broker / Redis chưa sẵn sàng lúc khởi động → thử lại sau khoảng này cho tới khi đồng bộ được. */
const RETRY_MS = 15_000;

/**
 * Đồng bộ lịch khai báo trong code sang BullMQ Job Scheduler khi scheduler khởi động: upsert lịch đang bật, gỡ lịch bị
 * tắt (`scheduler:disabled`) hoặc không còn trong code, và ghi định nghĩa cho System Console đọc. Không chặn bootstrap:
 * chạy nền, mọi lệnh BullMQ có timeout, thử lại tới khi thành công.
 */
@Injectable()
export class ScheduleSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleSyncService.name);
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly queueRegistry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    private readonly redis: RedisService,
    private readonly taskRegistry: ScheduledTaskRegistry,
    private readonly config: CoreConfigService,
  ) {}

  public onApplicationBootstrap(): void {
    void this.syncUntilDone();
  }

  public onModuleDestroy(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private async syncUntilDone(): Promise<void> {
    const done = await this.sync().catch((err: unknown) => {
      this.logger.warn(
        `Schedule synchronization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
    if (done) return;
    this.retry = setTimeout(() => void this.syncUntilDone(), RETRY_MS);
    this.retry.unref();
  }

  /** Một lượt đồng bộ; `false` khi Redis / broker chưa sẵn sàng (sẽ thử lại). */
  public async sync(): Promise<boolean> {
    if (!this.redis.isReady() || this.connection.getStatus().state !== 'connected') return false;
    const keys = schedulerKeys(this.redis);
    const t = <T>(task: Promise<T>) => this.queueRegistry.withTimeout(task);
    const tasks = this.taskRegistry.list();
    const disabled = new Set(await this.redis.client.smembers(keys.disabled()));

    // Định nghĩa cho Console: ghi task hiện có, gỡ task đã xoá khỏi code.
    const stored = await this.redis.client.hkeys(keys.definitions());
    const pipeline = this.redis.client.pipeline();
    for (const task of tasks) pipeline.hset(keys.definitions(), task.id, JSON.stringify(task));
    const ids = new Set(tasks.map((task) => task.id));
    const removed = stored.filter((id) => !ids.has(id));
    if (removed.length) pipeline.hdel(keys.definitions(), ...removed);
    await pipeline.exec();

    const byQueue = new Map<string, ScheduledTaskDefinition[]>();
    for (const task of tasks) byQueue.set(task.queue, [...(byQueue.get(task.queue) ?? []), task]);
    const opts = this.queueRegistry.retentionOptions();

    for (const [queueName, queueTasks] of byQueue) {
      const queue: Queue = this.queueRegistry.getQueue(queueName);
      const existing = await t(queue.getJobSchedulers());
      const existingIds = new Set(existing.map((s) => s.id ?? s.key));
      for (const task of queueTasks) {
        if (disabled.has(task.id)) {
          if (existingIds.has(task.id)) await t(queue.removeJobScheduler(task.id));
          continue;
        }
        await t(
          queue.upsertJobScheduler(
            task.id,
            {
              ...(task.pattern ? { pattern: task.pattern } : {}),
              ...(task.every ? { every: task.every } : {}),
              tz: task.tz ?? this.config.scheduler.timezone,
            },
            { name: task.name ?? task.id, data: task.data ?? {}, opts },
          ),
        );
      }
      // Lịch không còn khai báo trong code.
      const queueIds = new Set(queueTasks.map((task) => task.id));
      for (const s of existing) {
        const id = s.id ?? s.key;
        if (id && !queueIds.has(id)) await t(queue.removeJobScheduler(id));
      }
    }
    this.logger.log(`Synced ${tasks.length} scheduled task(s) to BullMQ`);
    return true;
  }
}
