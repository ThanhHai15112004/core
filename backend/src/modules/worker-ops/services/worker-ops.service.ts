import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingMonitoringService,
  jobMetric,
  type ConsumerRegistration,
} from '@packages/messaging/index.js';
import {
  QueueMonitoringService,
  QueueOperationError,
  QueueOperationsService,
  type DelayReason,
  type JobState,
  type JobSummary,
  type QueueEventRecord,
  type QueueInfo,
  type QueueOperationContext,
  type QueueOperationRecord,
} from '@packages/queue/index.js';
import type { RuntimeHeartbeat } from '@packages/runtime/index.js';
import { TELEMETRY_TIERS, type MetricBucket } from '@modules/system-ops/telemetry-compat.js';
import {
  counterOf,
  gaugeWindow,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import { RuntimesService, type RuntimeDetailDto } from '@modules/runtimes/index.js';
import {
  WorkerMetricsService,
  instanceCounter,
  instanceGauge,
  type MetricWindow,
} from './worker-metrics.service.js';
import { WorkerStoreService } from './worker-store.service.js';
import { concurrencyOf, stalledJobs } from './worker-monitor.service.js';
import {
  QUEUE_RULES,
  RULE_TAB,
  ruleOf,
  type StoredWorkerAlert,
  type WorkerRule,
} from './worker-rules.js';
import {
  DAY,
  MINUTE,
  iso,
  readWorkerHeartbeat,
  reasonOf,
  secondsSince,
  startOfDay,
  waitingOf,
} from './worker-utils.js';
import {
  QueueActionRejectedException,
  QueueNotConnectedException,
  WorkerNotFoundException,
} from '../exceptions/worker-ops.exceptions.js';
import type {
  BackgroundHealthDto,
  BackgroundStatus,
  ConcurrencyDto,
  DelayedDto,
  FailureReasonDto,
  FailuresDto,
  JobRowDto,
  QueueDetailDto,
  QueueJobsDto,
  QueueRetryDto,
  QueueRowDto,
  QueueStatus,
  QueuesListDto,
  RateBalanceDto,
  SectionDto,
  WorkerAlertDto,
  WorkerConfigDto,
  WorkerDetailDto,
  WorkerEventDto,
  WorkerInstanceStatus,
  WorkerMetric,
  WorkerMetricsDto,
  WorkerOperationDto,
  WorkerOverviewDto,
  WorkerRange,
  WorkerReportDto,
  WorkerRowDto,
  WorkerSeriesDto,
  WorkerSettingsDto,
  WorkerStabilityDto,
  WorkersListDto,
} from '../responses/worker-ops.response.js';

export const WORKER_RANGES: Record<WorkerRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};
export const WORKER_METRICS: WorkerMetric[] = [
  'throughput',
  'waiting',
  'duration',
  'failures',
  'retries',
];

const MAX_POINTS = 120;
const OVERVIEW_EVENTS = 8;
const RECENT_JOBS = 20;
const JOB_SAMPLE = 100;
const STALLED_SCAN = 200;
const RETRYING_SCAN = 500;
const DELAYED_LIMIT = 200;
/** Trong khoảng này sau khi một cảnh báo hết → "đang hồi phục". */
const RECOVERING_MS = 5 * MINUTE;
/** Chênh lệch incoming − processing nhỏ hơn mức này (job/phút) coi là cân bằng. */
const BALANCE_EPSILON = 0.5;
/** Cửa sổ ngắn để phát hiện failure spike, so với baseline 1 giờ trước đó. */
const SPIKE_WINDOW_MS = 5 * MINUTE;
const RUNTIME_EVENT_TYPES: Record<string, WorkerEventDto['type']> = {
  started: 'worker_started',
  stopped: 'worker_stopped',
  crashed: 'worker_crashed',
};

type Group = { t: number; b: MetricBucket[]; seconds: number };
type SeriesDef = { id: string; unit: string; value: (g: Group) => number | null };

interface Live {
  queues: SectionDto<QueueInfo[]>;
  consumers: ConsumerRegistration[];
  hb: RuntimeHeartbeat | null;
}

/** `wq.<kind>` hoặc `wq.q.<queue>.<kind>`. */
const mk = (kind: string, queue: string | null) => (queue ? jobMetric(queue, kind) : `wq.${kind}`);
const hostPid = (instance: string) => {
  const at = instance.indexOf('@');
  const rest = at >= 0 ? instance.slice(at + 1) : instance;
  const i = rest.lastIndexOf(':');
  const pid = i >= 0 ? Number(rest.slice(i + 1)) : NaN;
  return {
    host: i >= 0 ? rest.slice(0, i) : rest,
    pid: Number.isFinite(pid) ? pid : null,
    key: rest,
  };
};

/**
 * Worker & Queue: công việc nền có được worker thực thi kịp và thành công không — worker online, backlog,
 * throughput nhận vào vs xử lý, thời gian chờ/xử lý, lỗi & retry, job treo, concurrency, sự kiện, và thao tác
 * queue có kiểm soát. Không có số liệu giả: phần provider không hỗ trợ / không kết nối trả lý do.
 */
@Injectable()
export class WorkerOpsService {
  constructor(
    private readonly monitoring: QueueMonitoringService,
    private readonly operations: QueueOperationsService,
    private readonly messaging: MessagingMonitoringService,
    private readonly metrics: WorkerMetricsService,
    private readonly store: WorkerStoreService,
    private readonly runtimes: RuntimesService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.queue;
  }

  private settings(): WorkerSettingsDto {
    const c = this.cfg;
    const s = (cap: Parameters<QueueMonitoringService['supports']>[0]) =>
      this.monitoring.supports(cap);
    return {
      pause: c.pause && s('pause'),
      retryFailed: c.retryFailed && s('retryFailed'),
      retryFailedMax: c.retryFailedMax,
      drain: c.drain && s('drain'),
    };
  }

  private rangeWindow(range: WorkerRange, now: number) {
    return this.metrics.window(now - WORKER_RANGES[range] * MINUTE, now, now);
  }

  // ─── Nguồn dùng chung ─────────────────────────────────────────────────────

  private async live(): Promise<Live> {
    const [queues, consumers, hb] = await Promise.all([
      this.monitoring.section(null, () => this.monitoring.queues()),
      this.messaging.consumers().catch(() => [] as ConsumerRegistration[]),
      readWorkerHeartbeat(this.redis),
    ]);
    return { queues, consumers, hb };
  }

  private rates(
    w: MetricWindow | null,
    queue: string | null,
    waiting: number | null,
  ): RateBalanceDto {
    const c = this.metrics.counts(w, queue);
    const incoming = this.metrics.perMin(w, c.incoming);
    const processing = this.metrics.perMin(w, c.completed + c.failed);
    const diff = incoming !== null && processing !== null ? round(incoming - processing, 2) : null;
    const state =
      diff === null || c.incoming + c.completed + c.failed === 0
        ? null
        : diff > BALANCE_EPSILON && (waiting ?? 0) > 0
          ? 'growing'
          : diff < -BALANCE_EPSILON && (waiting ?? 0) > 0
            ? 'draining'
            : 'stable';
    return { incomingPerMin: incoming, processingPerMin: processing, diffPerMin: diff, state };
  }

  private queueRow(q: QueueInfo, w: MetricWindow | null, live: Live, now: number): QueueRowDto {
    const c = this.metrics.counts(w, q.name);
    const p = this.metrics.processing(w, q.name);
    const waiting = waitingOf(q);
    const rate = this.rates(w, q.name, waiting);
    const row: Omit<QueueRowDto, 'status'> = {
      name: q.name,
      waiting,
      prioritized: q.counts.prioritized,
      active: q.counts.active,
      delayed: q.counts.delayed,
      failed: q.counts.failed,
      completed: q.counts.completed,
      paused: q.paused,
      workers: q.workers?.length ?? null,
      concurrency: concurrencyOf(live.consumers, q.name),
      incomingPerMin: rate.incomingPerMin,
      processingPerMin: this.metrics.perMin(w, c.completed),
      growthPerMin: rate.diffPerMin,
      failureRatePercent: c.failureRatePercent,
      avgMs: p.avgMs,
      p95Ms: p.p95Ms,
      oldestWaitingSec: secondsSince(q.oldestWaitingAt, now),
      oldestWaitingId: q.oldestWaitingId,
    };
    return { ...row, status: this.queueStatus(row, c.completed + c.failed + c.incoming) };
  }

  private queueStatus(row: Omit<QueueRowDto, 'status'>, activity: number): QueueStatus {
    const r = this.cfg.rules;
    const ops = activity;
    if (row.waiting > 0 && row.workers === 0) return 'no_consumer';
    if (row.paused) return 'paused';
    if (ops >= r.minOps && (row.failureRatePercent ?? 0) >= r.failureRatePercent)
      return 'high_failure';
    if (row.waiting >= r.backlogWarn) return 'backlog';
    if (ops >= r.minOps && (row.p95Ms ?? 0) >= r.processingP95Ms) return 'slow';
    if (ops === 0 && row.waiting === 0 && row.active === 0 && row.delayed === 0) return 'idle';
    return 'healthy';
  }

  private queueRows(live: Live, w: MetricWindow | null, now: number): SectionDto<QueueRowDto[]> {
    if (!live.queues.available) return live.queues;
    const rank: Record<QueueStatus, number> = {
      no_consumer: 0,
      high_failure: 1,
      backlog: 2,
      slow: 3,
      paused: 4,
      healthy: 5,
      idle: 6,
    };
    return {
      available: true,
      data: live.queues.data
        .map((q) => this.queueRow(q, w, live, now))
        .sort(
          (a, b) =>
            rank[a.status] - rank[b.status] ||
            b.waiting - a.waiting ||
            a.name.localeCompare(b.name),
        ),
    };
  }

  /** Một dòng cho mỗi worker instance đang chạy (mỗi instance tự báo, TTL ngắn = còn sống). */
  private workerRows(
    live: Live,
    today: MetricWindow | null,
    recent: MetricWindow | null,
    now: number,
  ): WorkerRowDto[] {
    const groups = new Map<string, ConsumerRegistration[]>();
    for (const c of live.consumers) groups.set(c.instance, [...(groups.get(c.instance) ?? []), c]);
    const th = this.config.runtime.thresholds;
    const tb = today?.buckets ?? [];
    const rb = recent?.buckets ?? [];
    const brokers = live.queues.available ? live.queues.data.flatMap((q) => q.workers ?? []) : null;
    return [...groups.entries()]
      .map(([instance, regs]) => {
        const { host, pid, key } = hostPid(instance);
        const hb = live.hb && live.hb.instance === key ? live.hb : null;
        const cpu = hb?.resources.cpuPercent ?? instanceGauge(rb, 'rt.cpu', instance);
        const mem = hb?.resources.rssMb ?? instanceGauge(rb, 'rt.rss', instance);
        const limit = hb?.resources.memoryLimitMb ?? instanceGauge(rb, 'rt.memLimit', instance);
        const memPct = hb?.resources.memoryPercent ?? instanceGauge(rb, 'rt.memPct', instance);
        const active = regs.reduce((s, r) => s + r.inFlight, 0);
        const concurrency = regs.reduce((s, r) => s + r.concurrency, 0);
        const utilization = concurrency > 0 ? round((active / concurrency) * 100, 1) : null;
        const paused = regs.every((r) => r.paused);
        const startedAt = Math.min(...regs.map((r) => r.startedAt));
        const status: WorkerInstanceStatus = paused
          ? 'paused'
          : (memPct ?? 0) >= th.memoryPercent
            ? 'high_memory'
            : (cpu ?? 0) >= th.cpuPercent
              ? 'high_cpu'
              : (utilization ?? 0) >= this.cfg.rules.concurrencyPercent
                ? 'busy'
                : 'healthy';
        const runtime = regs[0]!.runtime;
        return {
          id: instance,
          runtime,
          host,
          pid: hb?.process.pid ?? pid,
          status,
          active,
          concurrency,
          utilizationPercent: utilization,
          cpuPercent: cpu === null ? null : round(cpu, 1),
          memoryMb: mem === null ? null : round(mem, 1),
          memoryLimitMb: limit === null ? null : round(limit, 0),
          memoryPercent: memPct === null ? null : round(memPct, 1),
          startedAt: new Date(startedAt).toISOString(),
          uptimeSec: hb?.uptimeSec ?? Math.max(0, Math.round((now - startedAt) / 1000)),
          queues: [...new Set(regs.map((r) => r.queue))].sort(),
          processors: [...new Set(regs.map((r) => r.consumer))].sort(),
          paused,
          completedToday: instanceCounter(tb, 'wq.done', instance),
          failedToday: instanceCounter(tb, 'wq.fail', instance),
          connections: brokers ? brokers.filter((b) => b.name === runtime).length : null,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private concurrency(live: Live, queue: string | null): ConcurrencyDto | null {
    const regs = live.consumers.filter((c) => (!queue || c.queue === queue) && !c.paused);
    const configured = regs.reduce((s, c) => s + c.concurrency, 0);
    if (configured === 0) return null;
    const queues = live.queues.available
      ? live.queues.data.filter((q) => !queue || q.name === queue)
      : null;
    const active = queues
      ? queues.reduce((s, q) => s + q.counts.active, 0)
      : regs.reduce((s, c) => s + c.inFlight, 0);
    return {
      configured,
      active,
      available: Math.max(0, configured - active),
      utilizationPercent: round((active / configured) * 100, 1),
    };
  }

  private jobRow(j: JobSummary, now: number): JobRowDto {
    return {
      id: j.id,
      queue: j.queue,
      name: j.name,
      state: j.state,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      priority: j.priority,
      createdAt: new Date(j.createdAt).toISOString(),
      processedAt: iso(j.processedAt),
      finishedAt: iso(j.finishedAt),
      runAt: iso(j.runAt),
      durationMs: j.durationMs,
      waitMs: j.waitMs,
      runningMs:
        j.state === 'active' && j.processedAt !== null ? Math.max(0, now - j.processedAt) : null,
      error: j.error,
      correlationId: j.correlationId,
      worker: j.processedBy,
      stalledCount: j.stalledCount,
      delayReason: j.delayReason,
    };
  }

  private jobs(queue: string | null, states: JobState[], limit: number, now: number) {
    return this.monitoring.section('jobs', async () =>
      (await this.monitoring.provider.jobs(queue, states, limit)).map((j) => this.jobRow(j, now)),
    );
  }

  private report(w: MetricWindow | null): WorkerReportDto {
    const c = this.metrics.counts(w);
    const p = this.metrics.processing(w);
    return {
      received: c.incoming,
      completed: c.completed,
      failed: c.failed,
      retried: c.retried,
      successRatePercent:
        c.completed + c.failed > 0
          ? round((c.completed / (c.completed + c.failed)) * 100, 2)
          : null,
      avgProcessingMs: p.avgMs,
      p95ProcessingMs: p.p95Ms,
      peakBacklog: this.metrics.waiting(w).peak,
    };
  }

  private async stability(now: number): Promise<WorkerStabilityDto> {
    const detail = await this.runtimes
      .getDetail('worker')
      .catch(() => null as RuntimeDetailDto | null);
    const today = startOfDay(now);
    const history = detail?.restartHistory ?? [];
    return {
      restartsToday: history.filter((h) => Date.parse(h.at) >= today).length,
      crashesToday: history.filter((h) => h.reasonCode === 'crash' && Date.parse(h.at) >= today)
        .length,
      lastRestartAt: history[0]?.at ?? null,
      history: history.slice(0, 10).map((h) => ({
        at: h.at,
        reasonCode: h.reasonCode,
        reason: h.reason,
        downtimeMs: h.downtimeMs,
      })),
    };
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: WorkerRange): Promise<WorkerOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [
      win,
      todayWin,
      yesterdayWin,
      recentWin,
      live,
      alerts,
      events,
      retrying,
      active,
      stability,
    ] = await Promise.all([
      this.rangeWindow(range, now),
      this.metrics.window(today, now, now),
      this.metrics.window(today - DAY, today, now),
      this.metrics.window(now - 2 * MINUTE, now, now, 's10'),
      this.live(),
      this.alerts(),
      this.eventsSince(now - DAY, null),
      this.monitoring.usable()
        ? this.monitoring.provider.jobs(null, ['retrying'], RETRYING_SCAN).catch(() => null)
        : Promise.resolve(null),
      this.monitoring.usable()
        ? this.monitoring.provider.jobs(null, ['active'], STALLED_SCAN).catch(() => null)
        : Promise.resolve(null),
      this.stability(now),
    ]);
    const queues = this.queueRows(live, win, now);
    const workers = this.workerRows(live, todayWin, recentWin, now);
    const counts = this.metrics.counts(win);
    const processing = this.metrics.processing(win);
    const sum = (k: 'waiting' | 'active' | 'delayed' | 'failed') =>
      queues.available ? queues.data.reduce((s, q) => s + q[k], 0) : null;
    const waiting = sum('waiting');
    const brokerWorkers = live.queues.available
      ? new Set(
          live.queues.data.flatMap((q) => (q.workers ?? []).map((w) => `${w.name}|${w.addr}`)),
        ).size
      : null;
    const oldest = live.queues.available
      ? live.queues.data.reduce<QueueInfo | null>(
          (min, q) =>
            q.oldestWaitingAt !== null && (!min || q.oldestWaitingAt < min.oldestWaitingAt!)
              ? q
              : min,
          null,
        )
      : null;
    const perQueueDone = queues.available
      ? queues.data.map((q) => ({
          queue: q.name,
          completed: this.metrics.counts(win, q.name).completed,
        }))
      : [];
    const totalDone = perQueueDone.reduce((s, q) => s + q.completed, 0);
    return {
      generatedAt: new Date(now).toISOString(),
      range,
      provider: this.monitoring.provider.info(),
      environment: this.config.app.env,
      capabilities: [...this.monitoring.provider.capabilities],
      health: this.health(live, alerts, events, workers.length),
      kpis: {
        workers: workers.length,
        brokerWorkers,
        waiting,
        active: sum('active'),
        failed: sum('failed'),
        delayed: sum('delayed'),
        retrying: retrying?.length ?? null,
        throughputPerMin: this.metrics.perMin(win, counts.completed),
        avgDurationMs: processing.avgMs,
        failedInRange: counts.failed,
      },
      rates: this.rates(win, null, waiting),
      processing,
      wait: {
        ...this.metrics.wait(win),
        oldestSec: secondsSince(oldest?.oldestWaitingAt ?? null, now),
        oldestJobId: oldest?.oldestWaitingId ?? null,
      },
      concurrency: this.concurrency(live, null),
      queues,
      workers,
      distribution:
        totalDone > 0
          ? perQueueDone
              .filter((q) => q.completed > 0)
              .map((q) => ({ ...q, percent: round((q.completed / totalDone) * 100, 1) }))
              .sort((a, b) => b.completed - a.completed)
          : [],
      failures: {
        failed: counts.failed,
        failureRatePercent: counts.failureRatePercent,
        retried: counts.retried,
        recovered: counts.recovered,
        exhausted: counts.exhausted,
        stalled: active ? stalledJobs(active, this.cfg.rules.stalledMin, now).length : null,
      },
      stability,
      alerts,
      events: events.slice(0, OVERVIEW_EVENTS),
      report: { today: this.report(todayWin), yesterday: this.report(yesterdayWin) },
      settings: this.settings(),
    };
  }

  private health(
    live: Live,
    alerts: WorkerAlertDto[],
    events: WorkerEventDto[],
    instances: number,
  ): BackgroundHealthDto {
    const s = this.monitoring.status();
    const base = {
      state: s.state,
      pingMs: s.lastPingMs,
      lastError: s.lastError,
      lastWorkerSeenAt: live.hb?.at ?? null,
    };
    const info = this.monitoring.provider.info();
    if (s.state !== 'connected') {
      return {
        ...base,
        status: s.state === 'connecting' ? 'unknown' : 'down',
        reasons: [
          {
            code: s.state,
            message: this.i18n.t(`worker.health.${s.state}`, {
              product: `${info.product} (${info.backend})`,
            }),
            queue: null,
          },
        ],
      };
    }
    const queues = live.queues.available ? live.queues.data : [];
    const waiting = queues.reduce((sum, q) => sum + waitingOf(q), 0);
    const connections = queues.reduce((sum, q) => sum + (q.workers?.length ?? 0), 0);
    if (live.queues.available && waiting > 0 && connections === 0 && instances === 0) {
      return {
        ...base,
        status: 'down',
        reasons: [
          {
            code: 'NO_WORKERS',
            message: this.i18n.t('worker.health.noWorkers', { waiting }),
            queue: null,
          },
        ],
      };
    }
    const problems = alerts.filter((a) => a.severity !== 'info');
    const reasons = problems.map((a) => ({
      code: a.rule,
      message: `${a.title}: ${a.message}`,
      queue: a.queue,
    }));
    let status: BackgroundStatus = 'healthy';
    if (queues.length > 0 && queues.every((q) => q.paused)) {
      status = 'paused';
      reasons.unshift({
        code: 'PAUSED',
        message: this.i18n.t('worker.health.allPaused'),
        queue: null,
      });
    } else if (problems.length) status = 'degraded';
    else if (
      events.some(
        (e) => e.type === 'alert_recovered' && Date.now() - Date.parse(e.at) < RECOVERING_MS,
      )
    )
      status = 'recovering';
    return { ...base, status, reasons };
  }

  private async alerts(): Promise<WorkerAlertDto[]> {
    const active = await this.store
      .activeAlerts()
      .catch(() => new Map<string, StoredWorkerAlert>());
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...active.entries()]
      .map(([id, s]) => {
        const rule = ruleOf(id);
        const target = typeof s.extra['target'] === 'string' ? s.extra['target'] : null;
        return {
          id,
          rule,
          severity: s.severity,
          title: this.i18n.t(`worker.alert.${rule}.title`),
          message: this.alertMessage(rule, { ...s.extra, value: s.value, threshold: s.threshold }),
          value: s.value,
          threshold: s.threshold,
          unit: s.unit,
          since: new Date(s.since).toISOString(),
          tab: RULE_TAB[rule] ?? 'overview',
          queue: QUEUE_RULES.has(rule)
            ? target
            : typeof s.extra['queue'] === 'string' && s.extra['queue']
              ? s.extra['queue']
              : null,
        };
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private alertMessage(rule: string, p: Record<string, unknown>): string {
    const metric = String(p['metric'] ?? '');
    return this.i18n.t(`worker.alert.${rule}.message`, {
      value: Number(p['value'] ?? 0),
      threshold: Number(p['threshold'] ?? 0),
      target: String(p['target'] ?? ''),
      oldestMin: String(p['oldestMin'] ?? 0),
      queue: String(p['queue'] ?? '') || '—',
      error: String(p['error'] ?? '') || '—',
      active: String(p['active'] ?? 0),
      concurrency: String(p['concurrency'] ?? 0),
      metric: metric ? this.i18n.t(`worker.metricName.${metric}`) : '',
    });
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  private async series(range: WorkerRange, defs: SeriesDef[]) {
    const now = Date.now();
    const win = await this.rangeWindow(range, now);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const size = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));
    const groups: Group[] = [];
    for (let i = 0; i < buckets.length; i += size) {
      const b = buckets.slice(i, i + size);
      groups.push({
        t: b[0]!.start,
        b,
        seconds: Math.max(1, Math.min(b.length * tierSec, (now - b[0]!.start) / 1000)),
      });
    }
    return {
      resolutionSec: win ? tierSec : null,
      series: defs.map((d): WorkerSeriesDto => ({
        id: d.id,
        label: this.i18n.t(`worker.series.${d.id}`),
        unit: d.unit,
        points: groups
          .map((g) => ({ t: g.t, value: d.value(g) }))
          .filter(
            (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
          )
          .map((p) => ({ t: p.t, value: round(p.value, 3) })),
      })),
    };
  }

  public async getMetrics(
    range: WorkerRange,
    metric: WorkerMetric,
    queue: string | null,
  ): Promise<WorkerMetricsDto> {
    if (queue) this.assertQueue(queue);
    const q = queue;
    const perMin = (kind: string) => (g: Group) => counterOf(g.b, mk(kind, q)) / (g.seconds / 60);
    const pct = (kind: string, p: number) => (g: Group) =>
      percentileOf(mergedOf(g.b, mk(kind, q)), p);
    const gauge = (kind: string) => (g: Group) =>
      gaugeWindow(g.b, mk(kind, q), { mode: 'max' }).avg;
    const defs: Record<WorkerMetric, SeriesDef[]> = {
      throughput: [
        { id: 'incoming', unit: '/min', value: perMin('in') },
        { id: 'completed', unit: '/min', value: perMin('done') },
        { id: 'failed', unit: '/min', value: perMin('fail') },
      ],
      waiting: [
        { id: 'waiting', unit: 'jobs', value: gauge('waiting') },
        { id: 'active', unit: 'jobs', value: gauge('active') },
        { id: 'delayed', unit: 'jobs', value: gauge('delayed') },
      ],
      duration: [
        { id: 'processingAvg', unit: 'ms', value: (g) => meanOf(mergedOf(g.b, mk('proc', q))) },
        { id: 'processingP95', unit: 'ms', value: pct('proc', 95) },
        { id: 'processingP99', unit: 'ms', value: pct('proc', 99) },
        { id: 'waitP95', unit: 'ms', value: pct('wait', 95) },
      ],
      failures: [
        { id: 'failed', unit: '/min', value: perMin('fail') },
        { id: 'exhausted', unit: '/min', value: perMin('exhausted') },
      ],
      retries: [
        { id: 'retried', unit: '/min', value: perMin('retry') },
        ...(q ? [] : [{ id: 'recovered', unit: '/min', value: perMin('recovered') }]),
      ],
    };
    const { series, resolutionSec } = await this.series(range, defs[metric]);
    const list = series.filter((s, i) => i === 0 || s.points.length > 0);
    return { metric, range, queue, resolutionSec, unit: list[0]?.unit ?? '', series: list };
  }

  // ─── Workers ──────────────────────────────────────────────────────────────

  private async workerContext(now: number) {
    const [todayWin, recentWin, live] = await Promise.all([
      this.metrics.window(startOfDay(now), now, now),
      this.metrics.window(now - 2 * MINUTE, now, now, 's10'),
      this.live(),
    ]);
    return { todayWin, recentWin, live, rows: this.workerRows(live, todayWin, recentWin, now) };
  }

  public async getWorkers(): Promise<WorkersListDto> {
    const now = Date.now();
    const [{ live, rows }, stability] = await Promise.all([
      this.workerContext(now),
      this.stability(now),
    ]);
    const queues = live.queues.available ? live.queues.data : null;
    return {
      workers: rows,
      brokerWorkers: queues
        ? new Set(queues.flatMap((q) => (q.workers ?? []).map((w) => `${w.name}|${w.addr}`))).size
        : null,
      concurrency: this.concurrency(live, null),
      stability,
      unconsumed: queues
        ? queues
            .filter((q) => waitingOf(q) > 0 && (q.workers?.length ?? 0) === 0)
            .map((q) => q.name)
        : [],
    };
  }

  public async getWorker(id: string): Promise<WorkerDetailDto> {
    const now = Date.now();
    const [{ todayWin, live, rows }, stability, runtime] = await Promise.all([
      this.workerContext(now),
      this.stability(now),
      this.runtimes.getDetail('worker').catch(() => null as RuntimeDetailDto | null),
    ]);
    const worker = rows.find((w) => w.id === id);
    if (!worker) throw new WorkerNotFoundException('worker.error.workerNotFound', { id });
    const tb = todayWin?.buckets ?? [];
    const perQueue = worker.queues.map((q) => ({
      queue: q,
      completed: instanceCounter(tb, jobMetric(q, 'done'), id),
      failed: instanceCounter(tb, jobMetric(q, 'fail'), id),
    }));
    const total = perQueue.reduce((s, q) => s + q.completed, 0);
    const own =
      live.hb && worker.pid !== null && live.hb.process.pid === worker.pid ? live.hb : null;
    return {
      worker,
      distribution: perQueue.map((q) => ({
        ...q,
        percent: total > 0 ? round((q.completed / total) * 100, 1) : 0,
      })),
      processing: this.metrics.processing(todayWin, null, worker.runtime ?? undefined),
      runtimeStatus: own ? (runtime?.status ?? null) : null,
      runtimeAlerts: own
        ? own.alerts.map((a) => ({ key: a.key, value: a.value, threshold: a.threshold }))
        : [],
      stability,
    };
  }

  // ─── Queues ───────────────────────────────────────────────────────────────

  private assertQueue(name: string): void {
    if (!this.monitoring.provider.isKnown(name))
      throw new WorkerNotFoundException('worker.error.queueNotFound', { name });
  }

  public async getQueues(range: WorkerRange): Promise<QueuesListDto> {
    const now = Date.now();
    const [win, live] = await Promise.all([this.rangeWindow(range, now), this.live()]);
    const r = this.cfg.rules;
    return {
      range,
      queues: this.queueRows(live, win, now),
      thresholds: { backlogWarn: r.backlogWarn, backlogCrit: r.backlogCrit },
    };
  }

  public async getQueue(name: string, range: WorkerRange): Promise<QueueDetailDto> {
    this.assertQueue(name);
    const now = Date.now();
    const [win, todayWin, recentWin, live, alerts, recent] = await Promise.all([
      this.rangeWindow(range, now),
      this.metrics.window(startOfDay(now), now, now),
      this.metrics.window(now - 2 * MINUTE, now, now, 's10'),
      this.live(),
      this.alerts(),
      this.jobs(
        name,
        ['active', 'waiting', 'prioritized', 'delayed', 'retrying', 'completed', 'failed'],
        10,
        now,
      ),
    ]);
    if (!live.queues.available) throw this.sectionError(live.queues);
    const info = live.queues.data.find((q) => q.name === name);
    if (!info) throw new WorkerNotFoundException('worker.error.queueNotFound', { name });
    const row = this.queueRow(info, win, live, now);
    const c = this.metrics.counts(win, name);
    const r = this.cfg.rules;
    const activity = (j: JobRowDto) =>
      Date.parse(j.finishedAt ?? j.processedAt ?? j.runAt ?? j.createdAt);
    return {
      range,
      queue: row,
      wait: {
        ...this.metrics.wait(win, name),
        oldestSec: row.oldestWaitingSec,
        oldestJobId: row.oldestWaitingId,
      },
      processing: this.metrics.processing(win, name),
      rates: this.rates(win, name, row.waiting),
      capacity: {
        waiting: row.waiting,
        warn: r.backlogWarn,
        crit: r.backlogCrit,
        percentOfWarn: r.backlogWarn > 0 ? round((row.waiting / r.backlogWarn) * 100, 1) : 0,
      },
      concurrency: this.concurrency(live, name),
      workers: this.workerRows(live, todayWin, recentWin, now).filter((w) =>
        w.queues.includes(name),
      ),
      brokerWorkers: info.workers,
      recentJobs: recent.available
        ? {
            available: true,
            data: [...recent.data].sort((a, b) => activity(b) - activity(a)).slice(0, RECENT_JOBS),
          }
        : recent,
      failures: {
        failed: c.failed,
        retried: c.retried,
        exhausted: c.exhausted,
        failureRatePercent: c.failureRatePercent,
      },
      defaults: this.monitoring.provider.defaults(),
      alerts: alerts.filter((a) => a.queue === name),
      settings: this.settings(),
    };
  }

  public async getQueueJobs(
    name: string,
    states: JobState[],
    limit: number,
  ): Promise<QueueJobsDto> {
    this.assertQueue(name);
    const now = Date.now();
    return { queue: name, states, limit, jobs: await this.jobs(name, states, limit, now) };
  }

  // ─── Failures / Delayed ───────────────────────────────────────────────────

  public async getFailures(range: WorkerRange, queue: string | null): Promise<FailuresDto> {
    if (queue) this.assertQueue(queue);
    const now = Date.now();
    const [win, todayWin, spikeWin, baseWin, live, alerts, retrying, failed, active] =
      await Promise.all([
        this.rangeWindow(range, now),
        this.metrics.window(startOfDay(now), now, now),
        this.metrics.window(now - SPIKE_WINDOW_MS, now, now, 's10'),
        this.metrics.window(now - SPIKE_WINDOW_MS - 60 * MINUTE, now - SPIKE_WINDOW_MS, now),
        this.live(),
        this.alerts(),
        this.jobs(queue, ['retrying'], JOB_SAMPLE, now),
        this.jobs(queue, ['failed'], JOB_SAMPLE, now),
        this.monitoring.section('stalled', () =>
          this.monitoring.provider.jobs(queue, ['active'], STALLED_SCAN),
        ),
      ]);
    const c = this.metrics.counts(win, queue);
    const t = this.metrics.counts(todayWin, queue);
    const infos = live.queues.available
      ? live.queues.data.filter((q) => !queue || q.name === queue)
      : null;
    const sample = [
      ...(retrying.available ? retrying.data : []),
      ...(failed.available ? failed.data : []),
    ];
    const reasons = new Map<string, FailureReasonDto>();
    for (const j of sample) {
      const reason = reasonOf(j.error);
      const at = j.finishedAt ?? j.processedAt ?? j.createdAt;
      const cur = reasons.get(reason);
      if (!cur) {
        reasons.set(reason, { reason, count: 1, queues: [j.queue], lastAt: at, sampleJobId: j.id });
        continue;
      }
      cur.count++;
      if (!cur.queues.includes(j.queue)) cur.queues.push(j.queue);
      if (!cur.lastAt || Date.parse(at) > Date.parse(cur.lastAt)) {
        cur.lastAt = at;
        cur.sampleJobId = j.id;
      }
    }
    const recent = this.metrics.counts(spikeWin, queue);
    const baseline = this.metrics.counts(baseWin, queue);
    const r = this.cfg.rules;
    const recentOps = recent.completed + recent.failed;
    const spike =
      recentOps >= r.minOps &&
      (recent.failureRatePercent ?? 0) >= r.failureRatePercent &&
      (baseline.failureRatePercent === null ||
        recent.failureRatePercent! >= baseline.failureRatePercent * 2)
        ? {
            recentRatePercent: recent.failureRatePercent!,
            baselineRatePercent: baseline.failureRatePercent,
            sinceMin: SPIKE_WINDOW_MS / MINUTE,
          }
        : null;
    return {
      range,
      queue,
      stats: {
        failed: c.failed,
        failureRatePercent: c.failureRatePercent,
        retryingNow: retrying.available ? retrying.data.length : null,
        retried: c.retried,
        recovered: c.recovered,
        exhausted: c.exhausted,
        deadLetter: infos ? infos.reduce((s, q) => s + q.counts.failed, 0) : null,
        failedToday: t.failed,
        retriedToday: t.retried,
        recoveredToday: t.recovered,
        exhaustedToday: t.exhausted,
      },
      byQueue: (infos ?? [])
        .map((q) => ({
          queue: q.name,
          failures: this.metrics.counts(win, q.name).failed,
          failed: q.counts.failed,
        }))
        .filter((q) => q.failures + q.failed > 0)
        .sort((a, b) => b.failures - a.failures || b.failed - a.failed),
      reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      sampled: sample.length,
      retrying,
      failedJobs: failed,
      stalled: active.available
        ? {
            available: true,
            data: stalledJobs(active.data, r.stalledMin, now).map((j) => this.jobRow(j, now)),
          }
        : active,
      spike,
      alerts: alerts.filter(
        (a) =>
          ['FAILURE_RATE', 'RETRY_STORM', 'STALLED_JOBS'].includes(a.rule) &&
          (!queue || a.queue === queue),
      ),
      settings: this.settings(),
    };
  }

  public async getDelayed(queue: string | null): Promise<DelayedDto> {
    if (queue) this.assertQueue(queue);
    const now = Date.now();
    const [live, jobs] = await Promise.all([
      this.live(),
      this.jobs(queue, ['delayed', 'retrying'], DELAYED_LIMIT, now),
    ]);
    const byReason: Record<DelayReason, number> = { retry: 0, repeat: 0, delay: 0 };
    let next: number | null = null;
    let oldest: number | null = null;
    if (jobs.available)
      for (const j of jobs.data) {
        if (j.delayReason) byReason[j.delayReason]++;
        const runAt = j.runAt ? Date.parse(j.runAt) : null;
        if (runAt !== null && (next === null || runAt < next)) next = runAt;
        const created = Date.parse(j.createdAt);
        if (oldest === null || created < oldest) oldest = created;
      }
    return {
      total: live.queues.available
        ? live.queues.data
            .filter((q) => !queue || q.name === queue)
            .reduce((s, q) => s + q.counts.delayed, 0)
        : null,
      nextDueAt: iso(next),
      oldestSec: secondsSince(oldest, now),
      byReason,
      jobs: jobs.available
        ? {
            available: true,
            data: [...jobs.data].sort(
              (a, b) => Date.parse(a.runAt ?? a.createdAt) - Date.parse(b.runAt ?? b.createdAt),
            ),
          }
        : jobs,
    };
  }

  // ─── Events / Operations / Config ─────────────────────────────────────────

  public async getEvents(range: WorkerRange, queue: string | null): Promise<WorkerEventDto[]> {
    if (queue) this.assertQueue(queue);
    return this.eventsSince(Date.now() - WORKER_RANGES[range] * MINUTE, queue);
  }

  private async eventsSince(from: number, queue: string | null): Promise<WorkerEventDto[]> {
    const [records, runtimeEvents] = await Promise.all([
      this.store.events().catch(() => [] as QueueEventRecord[]),
      queue ? Promise.resolve([]) : this.runtimes.getEvents('worker', 200).catch(() => []),
    ]);
    const own = records
      .filter((e) => e.at >= from)
      .map((e) => this.eventDto(e))
      .filter((e) => !queue || e.queue === queue);
    const rt: WorkerEventDto[] = runtimeEvents
      .filter((e) => RUNTIME_EVENT_TYPES[e.type] && Date.parse(e.at) >= from)
      .map((e) => ({
        id: `rt_${e.id}`,
        at: e.at,
        type: RUNTIME_EVENT_TYPES[e.type]!,
        severity: e.type === 'crashed' ? 'critical' : e.type === 'stopped' ? 'warning' : 'info',
        message: e.message,
        tab: 'workers',
        queue: null,
      }));
    return [...own, ...rt].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  private eventDto(e: QueueEventRecord): WorkerEventDto {
    const alertId = typeof e.params['rule'] === 'string' ? e.params['rule'] : null;
    const rule = alertId ? ruleOf(alertId) : null;
    const title = rule ? this.i18n.t(`worker.alert.${rule}.title`) : '';
    const target = typeof e.params['target'] === 'string' ? e.params['target'] : null;
    const queue =
      typeof e.params['queue'] === 'string' && e.params['queue']
        ? e.params['queue']
        : rule && QUEUE_RULES.has(rule)
          ? target
          : null;
    const message =
      e.type === 'alert_started' && rule
        ? `${title}: ${this.alertMessage(rule, e.params)}`
        : this.i18n.t(`worker.event.${e.type}`, {
            ...e.params,
            alert: queue && rule ? `${title} (${queue})` : title,
            actor: String(e.params['actor'] ?? this.i18n.t('worker.event.anonymous')),
          });
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      tab: rule ? (RULE_TAB[rule as WorkerRule] ?? null) : 'queues',
      queue,
    };
  }

  public async getOperations(): Promise<WorkerOperationDto[]> {
    const ops = await this.store.operations().catch(() => [] as QueueOperationRecord[]);
    return ops.map((o) => this.operationDto(o));
  }

  private operationDto(o: QueueOperationRecord): WorkerOperationDto {
    return { ...o, at: new Date(o.at).toISOString() };
  }

  public async getConfig(): Promise<WorkerConfigDto> {
    const info = this.monitoring.provider.info();
    const d = this.monitoring.provider.defaults();
    const r = this.cfg.rules;
    const consumers = await this.messaging.consumers().catch(() => [] as ConsumerRegistration[]);
    return {
      items: [
        { group: 'provider', key: 'driver', value: info.driver },
        { group: 'provider', key: 'product', value: info.product },
        { group: 'provider', key: 'backend', value: info.backend },
        { group: 'provider', key: 'endpoint', value: info.endpoint },
        { group: 'provider', key: 'prefix', value: info.prefix },
        {
          group: 'worker',
          key: 'instances',
          value: new Set(consumers.map((c) => c.instance)).size,
        },
        { group: 'worker', key: 'concurrency', value: this.config.runtime.worker.concurrency },
        {
          group: 'worker',
          key: 'queues',
          value: consumers.length
            ? [...new Set(consumers.map((c) => c.queue))].sort().join(', ')
            : null,
        },
        { group: 'jobs', key: 'attempts', value: d.attempts },
        { group: 'jobs', key: 'backoff', value: d.backoff?.type ?? 'none' },
        { group: 'jobs', key: 'backoffDelayMs', value: d.backoff?.delayMs ?? null },
        { group: 'jobs', key: 'removeOnComplete', value: d.removeOnComplete },
        { group: 'jobs', key: 'removeOnFail', value: d.removeOnFail },
        { group: 'thresholds', key: 'backlogWarn', value: r.backlogWarn },
        { group: 'thresholds', key: 'backlogCrit', value: r.backlogCrit },
        { group: 'thresholds', key: 'oldestWaitingMin', value: r.oldestWaitingMin },
        { group: 'thresholds', key: 'failureRatePercent', value: r.failureRatePercent },
        { group: 'thresholds', key: 'processingP95Ms', value: r.processingP95Ms },
        { group: 'thresholds', key: 'stalledMin', value: r.stalledMin },
        { group: 'thresholds', key: 'retryStormPerMin', value: r.retryStormPerMin },
        { group: 'thresholds', key: 'concurrencyPercent', value: r.concurrencyPercent },
        { group: 'actions', key: 'pause', value: this.cfg.pause },
        { group: 'actions', key: 'retryFailed', value: this.cfg.retryFailed },
        { group: 'actions', key: 'retryFailedMax', value: this.cfg.retryFailedMax },
        { group: 'actions', key: 'drain', value: this.cfg.drain },
      ],
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public pause(queue: string, ctx: QueueOperationContext) {
    return this.act(async () => this.operationDto(await this.operations.pause(queue, ctx)));
  }

  public resume(queue: string, ctx: QueueOperationContext) {
    return this.act(async () => this.operationDto(await this.operations.resume(queue, ctx)));
  }

  public retryFailed(
    queue: string,
    count: number,
    ctx: QueueOperationContext,
  ): Promise<QueueRetryDto> {
    return this.act(async () => {
      const r = await this.operations.retryFailed(queue, count, ctx);
      return { operation: this.operationDto(r.record), requested: r.requested, retried: r.retried };
    });
  }

  public drain(queue: string, includeDelayed: boolean, ctx: QueueOperationContext) {
    return this.act(async () =>
      this.operationDto(await this.operations.drain(queue, includeDelayed, ctx)),
    );
  }

  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  private sectionError(s: Extract<SectionDto<unknown>, { available: false }>): Error {
    if (s.reason === 'disconnected') return new QueueNotConnectedException(s.message ?? 'unknown');
    if (s.reason === 'unsupported')
      return new QueueActionRejectedException(
        'UNSUPPORTED',
        'worker.error.UNSUPPORTED',
        { product: s.message ?? '' },
        422,
      );
    return new QueueActionRejectedException(
      'READ_FAILED',
      'worker.error.readFailed',
      { message: s.message ?? '' },
      502,
    );
  }

  private operationError(err: unknown): Error {
    if (!(err instanceof QueueOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new QueueNotConnectedException(this.monitoring.status().state);
      case 'NOT_FOUND':
        return new WorkerNotFoundException('worker.error.queueNotFound', {
          name: err.params['queue'] ?? err.message,
        });
      case 'UNSUPPORTED':
        return new QueueActionRejectedException(
          err.code,
          'worker.error.UNSUPPORTED',
          { product: this.monitoring.provider.info().product },
          422,
        );
      case 'TOO_MANY':
        return new QueueActionRejectedException(
          err.code,
          'worker.error.TOO_MANY',
          { ...err.params },
          422,
        );
      case 'INVALID_STATE':
        return new QueueActionRejectedException(
          err.code,
          `worker.error.INVALID_STATE.${err.params['state'] ?? 'unknown'}`,
          {
            ...err.params,
          },
        );
      case 'FAILED':
        return new QueueActionRejectedException(
          'ACTION_FAILED',
          'worker.error.FAILED',
          { message: err.message },
          502,
        );
      default:
        return new QueueActionRejectedException(err.code, `worker.error.${err.code}`, {
          ...err.params,
        });
    }
  }
}
