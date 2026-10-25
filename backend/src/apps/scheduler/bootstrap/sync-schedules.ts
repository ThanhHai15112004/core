import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CronExpressionParser } from 'cron-parser';
import { CoreConfigService } from '@packages/config/index.js';
import { CATCHUP_RUN_PREFIX, MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueRegistry, SCHEDULER_MISSED_LOG_SIZE, schedulerKeys } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  ScheduledTaskRegistry,
  type ScheduledTaskDefinition,
} from '../registry/scheduled-task.registry.js';

export interface DetectedMissedRun {
  id: string;
  taskId: string;
  taskName: string;
  queue: string;
  pattern: string;
  timezone: string;
  scheduledAt: number;
  detectedAt: number;
  policy: 'skip' | 'run_once';
  compensatedExecutionId: string | null;
}

/** Giới hạn số mốc bị bỏ lỡ quét tối đa cho 1 task trong 1 lần khôi phục để tránh vòng lặp lớn. */
const MAX_MISSED_PER_TASK = 50;

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

  /** Kích hoạt đồng bộ lịch tác vụ khi ứng dụng hoàn tất bootstrap */
  public onApplicationBootstrap(): void {
    void this.syncUntilDone();
  }

  /** Hủy bỏ bộ hẹn giờ thử lại đồng bộ khi module bị hủy */
  public onModuleDestroy(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  /** Thực hiện thử lại đồng bộ định kỳ cho đến khi kết nối thành công */
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
    /** Bọc Promise với timeout từ QueueRegistry */
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
        await this.detectAndCompensateMissedRuns(task, queue);
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

  /**
   * 7.4.8 — Phát hiện các lần chạy bị bỏ lỡ trong khoảng `(lastSeenAt, now]` (ví dụ khi server tắt lâu),
   * ghi vào Redis `scheduler:missed` và tự động chạy bù 1 lần nếu `misfirePolicy === 'run_once'`.
   */
  public async detectAndCompensateMissedRuns(
    task: ScheduledTaskDefinition,
    queue?: Queue,
    nowMs = Date.now(),
  ): Promise<DetectedMissedRun[]> {
    const keys = schedulerKeys(this.redis);
    const rawCheckpoint = await this.redis.client
      .hget(keys.checkpoints(), task.id)
      .catch(() => null);
    const lastSeenAt = rawCheckpoint ? Number(rawCheckpoint) : 0;

    await this.redis.client.hset(keys.checkpoints(), task.id, String(nowMs)).catch(() => undefined);

    if (!Number.isFinite(lastSeenAt) || lastSeenAt <= 0 || lastSeenAt >= nowMs) {
      return [];
    }

    const tz = task.tz ?? this.config.scheduler.timezone;
    const missedSlots = this.computeMissedSlots(task, lastSeenAt, nowMs, tz);
    if (missedSlots.length === 0) {
      return [];
    }

    const policy = task.misfirePolicy ?? 'skip';
    let compensatedExecutionId: string | null = null;

    if (policy === 'run_once' && queue) {
      const lockHolder = await this.redis.client.get(keys.taskLock(task.id)).catch(() => null);
      if (!lockHolder) {
        try {
          const channel = task.name ?? task.id;
          const job = await this.queueRegistry.withTimeout(
            queue.add(
              channel,
              {
                ...(task.data ?? {}),
                triggeredBy: 'misfire_catchup',
                missedCount: missedSlots.length,
              },
              {
                ...this.queueRegistry.retentionOptions(),
                jobId: `${CATCHUP_RUN_PREFIX}${task.id}:${nowMs}`,
              },
            ),
          );
          compensatedExecutionId = String(job.id ?? `${CATCHUP_RUN_PREFIX}${task.id}:${nowMs}`);
        } catch (err) {
          this.logger.warn(
            `Failed to enqueue catch-up execution for missed task "${task.id}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    const records: DetectedMissedRun[] = missedSlots.map((scheduledAt, idx) => ({
      id: `sch_miss_${nowMs}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: task.id,
      taskName: task.name ?? task.id,
      queue: task.queue,
      pattern: task.pattern ?? `every:${task.every ?? 0}ms`,
      timezone: tz,
      scheduledAt,
      detectedAt: nowMs,
      policy,
      compensatedExecutionId: idx === missedSlots.length - 1 ? compensatedExecutionId : null,
    }));

    const multi = this.redis.client.multi();
    for (const rec of records) {
      multi.lpush(keys.missedRuns(), JSON.stringify(rec));
    }
    multi.ltrim(keys.missedRuns(), 0, SCHEDULER_MISSED_LOG_SIZE - 1);
    await multi.exec().catch(() => undefined);

    this.logger.warn(
      `Detected ${records.length} missed execution(s) for task "${task.id}" between ${new Date(
        lastSeenAt,
      ).toISOString()} and ${new Date(nowMs).toISOString()} (policy=${policy}${
        compensatedExecutionId ? `, compensated=${compensatedExecutionId}` : ''
      })`,
    );

    return records;
  }

  /** Tính danh sách các mốc thời gian (epoch ms) bị bỏ lỡ trong khoảng `(fromMs, toMs]` */
  public computeMissedSlots(
    task: Pick<ScheduledTaskDefinition, 'pattern' | 'every'>,
    fromMs: number,
    toMs: number,
    tz: string,
  ): number[] {
    const slots: number[] = [];
    if (fromMs >= toMs) return slots;

    if (task.pattern) {
      try {
        const interval = CronExpressionParser.parse(task.pattern, {
          currentDate: new Date(fromMs),
          tz,
        });
        while (slots.length < MAX_MISSED_PER_TASK) {
          const nextTime = interval.next().getTime();
          if (nextTime > toMs) break;
          slots.push(nextTime);
        }
      } catch {
        return [];
      }
      return slots;
    }

    if (typeof task.every === 'number' && task.every > 0) {
      let cursor = fromMs + task.every;
      while (cursor <= toMs && slots.length < MAX_MISSED_PER_TASK) {
        slots.push(cursor);
        cursor += task.every;
      }
    }

    return slots;
  }
}
