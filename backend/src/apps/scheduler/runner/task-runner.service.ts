import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { SystemTask } from '../tasks/system/system.task.js';

const LOCK_TTL_MS = 10 * 60_000;
const DRAIN_POLL_MS = 200;

interface TaskDefinition {
  name: string;
  cron: string;
  run: () => Promise<void>;
}

export interface TaskState {
  name: string;
  cron: string;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastFailedAt: string | null;
  failuresToday: number;
  runsToday: number;
  nextRunAt: string | null;
}

/**
 * Đăng ký & chạy cron task qua `SchedulerRegistry`, theo dõi trạng thái từng task.
 * Lock Redis `SET NX PX` ngăn task chạy chồng (kể cả khi có nhiều instance scheduler).
 */
@Injectable()
export class TaskRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskRunnerService.name);
  private readonly states = new Map<string, TaskState>();
  private paused = false;
  private day = new Date().toDateString();

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    private readonly systemTask: SystemTask,
  ) {}

  private definitions(): TaskDefinition[] {
    return [
      {
        name: 'system.maintenance',
        cron: this.config.runtime.scheduler.maintenanceCron,
        run: () => this.systemTask.runMaintenance(),
      },
    ];
  }

  public onApplicationBootstrap(): void {
    for (const def of this.definitions()) {
      const job = CronJob.from({
        cronTime: def.cron,
        onTick: () => void this.execute(def),
        start: false,
      });
      this.registry.addCronJob(def.name, job);
      this.states.set(def.name, {
        name: def.name,
        cron: def.cron,
        running: false,
        lastRunAt: null,
        lastDurationMs: null,
        lastError: null,
        lastFailedAt: null,
        failuresToday: 0,
        runsToday: 0,
        nextRunAt: null,
      });
      if (!this.paused) job.start();
    }
  }

  public list(): TaskState[] {
    this.rollDay();
    return [...this.states.values()].map((s) => ({
      ...s,
      nextRunAt: this.paused ? null : this.nextRun(s.name),
    }));
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public pause(): void {
    this.paused = true;
    for (const job of this.registry.getCronJobs().values()) void job.stop();
  }

  public resume(): void {
    this.paused = false;
    for (const job of this.registry.getCronJobs().values()) job.start();
  }

  /** Chờ các task đang chạy hoàn tất. */
  public async drain(): Promise<void> {
    this.pause();
    while ([...this.states.values()].some((s) => s.running)) {
      await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
    }
  }

  private nextRun(name: string): string | null {
    try {
      return this.registry.getCronJob(name).nextDate().toJSDate().toISOString();
    } catch {
      return null;
    }
  }

  private async execute(def: TaskDefinition): Promise<void> {
    const state = this.states.get(def.name);
    if (!state || state.running) return;

    const lockKey = this.redis.key('scheduler', 'lock', def.name);
    const locked = await this.redis.client
      .set(lockKey, String(process.pid), 'PX', LOCK_TTL_MS, 'NX')
      .catch(() => null);
    if (locked !== 'OK') {
      this.logger.warn(`Task ${def.name} skipped: already running elsewhere or Redis unavailable`);
      return;
    }

    this.rollDay();
    const started = Date.now();
    state.running = true;
    state.lastRunAt = new Date(started).toISOString();
    try {
      await def.run();
      state.lastError = null;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastFailedAt = new Date().toISOString();
      state.failuresToday++;
      this.logger.error(`Task ${def.name} failed: ${state.lastError}`);
    } finally {
      state.running = false;
      state.runsToday++;
      state.lastDurationMs = Date.now() - started;
      await this.redis.client.del(lockKey).catch(() => undefined);
    }
  }

  private rollDay(): void {
    const today = new Date().toDateString();
    if (today === this.day) return;
    this.day = today;
    for (const s of this.states.values()) {
      s.failuresToday = 0;
      s.runsToday = 0;
    }
  }
}
