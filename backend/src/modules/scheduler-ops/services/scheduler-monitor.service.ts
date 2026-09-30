import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  SchedulerStore,
  recordSchedulerEvent,
  type ExecutionRecord,
  type ScheduledTaskMeta,
  type TaskStateRecord,
} from '@packages/scheduler/index.js';
import { SchedulerMetricsService, schMetric } from './scheduler-metrics.service.js';
import {
  diffSchedulerAlerts,
  evaluateSchedulerRules,
  findDuplicate,
  longRunningThreshold,
  type StoredSchedulerAlert,
  type SchedulerViolation,
  type TaskRuleInput,
} from './scheduler-rules.js';
import { DAY, HOUR, MINUTE, isOrphan, liveness, overdueSec } from './scheduler-utils.js';
import { mergedOf, percentileOf } from '@modules/performance/index.js';

const TICK_MS = 15_000;
/** Số lần chạy gần nhất (1 giờ) đọc để tìm trùng lịch / lock lỗi. */
const RECENT_SCAN = 2000;
const BASELINE_TTL_MS = 5 * MINUTE;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): đánh giá cảnh báo Scheduler (mất heartbeat,
 * lỗi liên tiếp, chạy lâu, lỡ lịch, chạy chồng, chạy trùng, lock lỗi, trễ lịch) và đóng các lần chạy mồ côi
 * (instance chết giữa chừng) thành `failed / Interrupted`.
 */
@Injectable()
export class SchedulerMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('SchedulerMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private baselineCache: { at: number; values: Map<string, number | null> } | null = null;

  constructor(
    private readonly store: SchedulerStore,
    private readonly metrics: SchedulerMetricsService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  private get rules() {
    return this.config.scheduler.rules;
  }

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 8000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.store.isAvailable()) return;
    this.running = true;
    try {
      const locked = await this.store.client.set(
        this.store.keys.monitorLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      await this.evaluate(now);
    } catch (err) {
      this.logger.warn(
        `Scheduler monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * p95 thời lượng 24 giờ qua theo task (baseline cho "chạy lâu bất thường"). Đọc cửa sổ 24h tốn kém nên giữ
   * trong bộ nhớ `BASELINE_TTL_MS` (baseline thay đổi chậm).
   */
  public async baselines(taskIds: string[], now: number): Promise<Map<string, number | null>> {
    const cached = this.baselineCache;
    if (cached && now - cached.at < BASELINE_TTL_MS && taskIds.every((id) => cached.values.has(id)))
      return cached.values;
    const w = await this.metrics.window(now - DAY, now, now);
    const values = new Map(
      taskIds.map((id) => [id, percentileOf(mergedOf(w?.buckets ?? [], schMetric('dur', id)), 95)]),
    );
    this.baselineCache = { at: now, values };
    return values;
  }

  private async evaluate(now: number): Promise<void> {
    const timeout = this.rules.heartbeatTimeoutSec;
    const [tasks, states, disabled, instances, running, recent, problems, alerts, driftWin] =
      await Promise.all([
        this.store.tasks(),
        this.store.states(),
        this.store.disabled(),
        this.store.instances(),
        this.store.running(),
        this.store.executions({ from: now - HOUR, to: now, limit: RECENT_SCAN }),
        this.store.executions({
          from: now - HOUR,
          to: now,
          limit: RECENT_SCAN,
          problemsOnly: true,
        }),
        this.activeAlerts(),
        this.metrics.window(now - 15 * MINUTE, now, now, 's10'),
      ]);
    const live = liveness(instances, now, timeout);
    const orphans = running.filter((r) => isOrphan(r, live.aliveIds, now, timeout));
    for (const r of orphans)
      await this.interrupt(r, tasks.get(r.taskId), states.get(r.taskId), now);
    const active = running.filter((r) => !orphans.includes(r));
    const baselines = await this.baselines([...tasks.keys()], now);
    const byTask = (list: ExecutionRecord[], id: string) => list.filter((e) => e.taskId === id);

    const taskInputs: TaskRuleInput[] = [...tasks.values()].map((m) => {
      const missed = byTask(problems.items, m.id).filter((e) => e.status === 'missed');
      return {
        id: m.id,
        enabled: !disabled.has(m.id),
        error: m.error,
        consecutiveFailures: states.get(m.id)?.consecutiveFailures ?? 0,
        running: byTask(active, m.id).map((r) => ({
          executionId: r.id,
          runningMs: now - (r.startedAt ?? now),
        })),
        longRunningMs: longRunningThreshold(
          m.expectedDurationMs,
          baselines.get(m.id) ?? null,
          m.lockTtlMs,
          this.rules,
        ).ms,
        missed: missed.length
          ? {
              count: missed.reduce((s, e) => s + (e.missedCount ?? 1), 0),
              executionId: missed[0]!.id,
            }
          : null,
        duplicate: findDuplicate(byTask(recent.items, m.id)),
        lockUnavailable: byTask(recent.items, m.id).filter(
          (e) =>
            e.status === 'skipped' &&
            e.reason === 'lock_unavailable' &&
            (e.scheduledAt ?? e.finishedAt ?? 0) >= now - 15 * MINUTE,
        ).length,
        overdueSec:
          live.alive.length > 0 && !disabled.has(m.id) && !m.error
            ? overdueSec(states.get(m.id), now)
            : null,
      };
    });
    const failed = problems.items.filter((e) => e.status === 'failed');
    const drift = this.metrics.drift(driftWin);
    const violations = evaluateSchedulerRules(
      {
        known: tasks.size > 0 || instances.size > 0,
        aliveInstances: live.alive.length,
        heartbeatAgeSec: live.ageSec,
        paused: live.paused,
        tasks: taskInputs,
        recentFailures: { count: failed.length, tasks: [...new Set(failed.map((e) => e.taskId))] },
        drift: { p95Ms: drift.p95Ms, samples: drift.samples },
      },
      this.rules,
    );
    await this.applyAlerts(violations, alerts, now);
  }

  /** Lần chạy mồ côi → `failed / Interrupted`, cập nhật trạng thái task, nhả lock nếu đang giữ. */
  private async interrupt(
    r: ExecutionRecord,
    meta: ScheduledTaskMeta | undefined,
    state: TaskStateRecord | undefined,
    now: number,
  ): Promise<void> {
    const finished: ExecutionRecord = {
      ...r,
      status: 'failed',
      finishedAt: now,
      durationMs: now - (r.startedAt ?? now),
      reason: 'interrupted',
      error: {
        type: 'Interrupted',
        message: `Scheduler instance ${r.instance ?? '?'} stopped while the task was running`,
      },
    };
    await this.store.saveExecution(finished);
    const lockKey = this.store.keys.lock(r.taskId);
    const holder = await this.store.client.get(lockKey);
    if (holder?.startsWith(`${r.id}|`)) await this.store.client.del(lockKey);
    if (state && state.lastExecutionId === r.id) {
      await this.store.setState(r.taskId, {
        ...state,
        lastStatus: 'failed',
        lastFinishedAt: now,
        lastDurationMs: finished.durationMs,
        lastError: finished.error,
        lastFailureAt: now,
        consecutiveFailures: state.consecutiveFailures + 1,
        updatedAt: now,
      });
    }
    await recordSchedulerEvent(this.redis, {
      type: 'execution_interrupted',
      severity: 'warning',
      taskId: r.taskId,
      executionId: r.id,
      params: { instance: r.instance ?? '?', task: meta?.name ?? r.taskId },
    });
  }

  public async activeAlerts(): Promise<Map<string, StoredSchedulerAlert>> {
    const hash = await this.store.client.hgetall(this.store.keys.activeAlerts());
    const map = new Map<string, StoredSchedulerAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const v = parseJson<StoredSchedulerAlert>(raw);
      if (v) map.set(id, v);
    }
    return map;
  }

  private async applyAlerts(
    violations: SchedulerViolation[],
    active: Map<string, StoredSchedulerAlert>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffSchedulerAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    for (const v of started) {
      if (v.severity === 'info') continue;
      await recordSchedulerEvent(this.redis, {
        type: v.rule === 'DUPLICATE_EXECUTION' ? 'duplicate_execution' : 'alert_started',
        severity: v.severity,
        taskId: typeof v.extra['task'] === 'string' ? v.extra['task'] : null,
        executionId: typeof v.extra['execution'] === 'string' ? v.extra['execution'] : null,
        params: { rule: v.id, value: v.value, threshold: v.threshold, unit: v.unit, ...v.extra },
        at: now,
      });
    }
    for (const r of recovered) {
      if (r.alert.severity === 'info') continue;
      await recordSchedulerEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        taskId: typeof r.alert.extra['task'] === 'string' ? r.alert.extra['task'] : null,
        params: {
          rule: r.id,
          minutes: Math.max(1, Math.round(r.durationMs / MINUTE)),
          ...r.alert.extra,
        },
        at: now,
      });
    }
  }
}
