import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  JOB_LOCK_DURATION_MS,
  MessagingMonitoringService,
  dependencyOf,
  type ConsumerRegistration,
  type JobEventRecord,
  type JobOperationRecord,
  type LifecycleEntry,
} from '@packages/messaging/index.js';
import {
  JobMonitoringService,
  JobOperationError,
  JobOperationsService,
  QueueMonitoringService,
  type JobDetailRaw,
  type JobOperationContext,
  type JobPriorityLevel,
  type JobRecord,
  type QueueInfo,
} from '@packages/queue/index.js';
import { redactPayload } from '@packages/http/index.js';
import { counterOf, round } from '@modules/performance/index.js';
import { RuntimesService } from '@modules/runtimes/index.js';
import { WORKER_RANGES, WorkerOpsService, type WorkerMetric } from '@modules/worker-ops/index.js';
import { JobsMetricsService } from './jobs-metrics.service.js';
import { activityAt, decodeCursor, scanJobs, type JobFilter } from './job-search.js';
import {
  JobActionRejectedException,
  JobNotFoundException,
  JobsUnavailableException,
} from '../exceptions/jobs-ops.exceptions.js';
import type {
  ActionStateDto,
  AttemptDto,
  FailureGroupDto,
  JobBulkRetryDto,
  JobCancelDto,
  JobDetailDto,
  JobEventDto,
  JobOperationDto,
  JobProblemDto,
  JobRetryDto,
  JobRowDto,
  JobSearchDto,
  JobsConfigDto,
  JobsFailuresDto,
  JobsOverviewDto,
  JobsRange,
  JobsReportResponseDto,
  JobsSettingsDto,
  JobsStatus,
  LifecycleStepDto,
  SearchMatch,
  SectionDto,
} from '../responses/jobs-ops.response.js';

export const JOBS_RANGES = WORKER_RANGES;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ACTIVE_SCAN = 200;
const DELAYED_SCAN = 500;
const FAILED_SAMPLE = 200;
const PRIORITY_SAMPLE = 200;
const LOOKUP_LIMIT = 200;
const OVERVIEW_EVENTS = 8;
const LOG_LIMIT = 50;
const RESULT_MAX_BYTES = 4096;
const PRIORITY_ORDER: JobPriorityLevel[] = ['critical', 'high', 'normal', 'low'];

const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const byteLength = (v: unknown) => {
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
  } catch {
    return 0;
  }
};
/** `StorageTimeout: upload failed` → `upload failed` (loại lỗi đã hiện riêng). */
const stripType = (message: string, type: string | null) =>
  type && message.startsWith(`${type}: `) ? message.slice(type.length + 2) : message;
const shortId = (id: string | null) => (id ? (id.length > 12 ? id.slice(0, 8) : id) : '?');

interface Baselines {
  now: number;
  typical: Map<string, number>;
  wait: Map<string, number>;
}

/**
 * Jobs — Job Explorer + Job Operations Center: job cụ thể nào đang có vấn đề, được tạo từ đâu, chờ bao lâu, worker nào
 * xử lý, chạy bao lâu, retry mấy lần, vì sao lỗi, retry / huỷ được không, liên quan request / scheduler / job nào.
 * Mọi số liệu đọc thật từ broker + telemetry; provider không kết nối → nói rõ, không có job giả.
 */
@Injectable()
export class JobsOpsService {
  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly operations: JobOperationsService,
    private readonly queues: QueueMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly metrics: JobsMetricsService,
    private readonly workers: WorkerOpsService,
    private readonly runtimes: RuntimesService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.jobs;
  }

  public settings(): JobsSettingsDto {
    const c = this.cfg;
    return {
      retry: c.retry,
      bulkRetryMax: c.bulkRetryMax,
      cancel: c.cancel,
      remove: c.remove,
      payload: c.payload,
    };
  }

  private assertQueue(queue: string | null | undefined): void {
    if (queue && !this.jobs.provider.isKnown(queue)) throw new JobNotFoundException({ id: queue });
  }

  private assertUsable(): void {
    if (!this.jobs.usable())
      throw new JobsUnavailableException({ state: this.jobs.status().state });
  }

  private async baselines(now: number): Promise<Baselines> {
    const [typical, wait] = await Promise.all([
      this.metrics.typicalByType(now),
      this.metrics.waitByQueue(now, this.jobs.provider.queues()),
    ]);
    return { now, typical, wait };
  }

  // ─── Job row ──────────────────────────────────────────────────────────────

  /** Ngưỡng "chạy lâu" của một loại job: `factor × p95` (tối thiểu `minSec`); chưa có baseline → `factor × minSec`. */
  public longRunningThreshold(typicalMs: number | null): number {
    const r = this.cfg.rules;
    const min = r.longRunningMinSec * 1000;
    return typicalMs ? Math.max(min, typicalMs * r.longRunningFactor) : min * r.longRunningFactor;
  }

  /** Ngưỡng "chờ lâu" của một queue: `factor × chờ trung bình` (tối thiểu `minSec`); chưa có → ngưỡng Worker & Queue. */
  public longWaitThreshold(avgWaitMs: number | null): number {
    const r = this.cfg.rules;
    const min = r.longWaitMinSec * 1000;
    return avgWaitMs !== null
      ? Math.max(min, avgWaitMs * r.longWaitFactor)
      : Math.max(min, this.config.queue.rules.oldestWaitingMin * MINUTE);
  }

  public row(j: JobRecord, b: Baselines): JobRowDto {
    const { now } = b;
    const running = j.status === 'active' || j.status === 'stalled';
    const runningMs = running && j.startedAt !== null ? Math.max(0, now - j.startedAt) : null;
    const waitMs = j.status === 'waiting' ? Math.max(0, now - j.createdAt) : j.waitMs;
    const typicalMs = b.typical.get(j.type) ?? null;
    const avgWait = b.wait.get(j.queue) ?? b.wait.get('*') ?? null;
    return {
      id: j.id,
      queue: j.queue,
      type: j.type,
      status: j.status,
      priority: j.priority,
      priorityLevel: j.priorityLevel,
      createdAt: new Date(j.createdAt).toISOString(),
      availableAt: iso(j.availableAt),
      startedAt: iso(j.startedAt),
      finishedAt: iso(j.finishedAt),
      worker: j.worker,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      waitMs,
      durationMs: j.durationMs,
      runningMs,
      progress: j.progress,
      source: j.source,
      correlationId: j.correlationId,
      error: j.error,
      errorType: j.errorType,
      retryable: j.retryable,
      delayReason: j.delayReason,
      stalledCount: j.stalledCount,
      heartbeatAgeSec:
        running && j.heartbeat?.lastAt
          ? Math.max(0, Math.round((now - j.heartbeat.lastAt) / 1000))
          : null,
      longWait:
        j.status === 'waiting' && waitMs !== null && waitMs > this.longWaitThreshold(avgWait),
      longRunning:
        j.status === 'active' &&
        runningMs !== null &&
        runningMs > this.longRunningThreshold(typicalMs),
      typicalMs,
      cancelledAt: iso(j.cancelledAt),
      cancelledBy: j.cancelledBy,
    };
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /** Tra thẳng theo job ID (`getJob`); không còn chỉ mục phụ trong Redis — còn lại quét có giới hạn. */
  private async lookup(
    search: string,
    queue: string | null,
  ): Promise<{ jobs: JobRecord[]; matchedBy: SearchMatch } | null> {
    const direct = await this.jobs.get(search, queue).catch(() => null);
    return direct ? { jobs: [direct], matchedBy: 'id' } : null;
  }

  public async search(
    filter: JobFilter,
    search: string | null,
    cursor: string | null,
    limit: number,
  ): Promise<JobSearchDto> {
    this.assertQueue(filter.queue);
    this.assertUsable();
    const now = Date.now();
    const b = await this.baselines(now);
    const q = search?.trim() ?? '';
    if (q) {
      const found = await this.lookup(q, filter.queue);
      if (found) {
        const jobs = found.jobs
          .filter((j) => !filter.status || this.statusMatches(j, filter))
          .filter((j) => !filter.queue || j.queue === filter.queue)
          .sort((x, y) => activityAt(y) - activityAt(x));
        return {
          jobs: jobs.map((j) => this.row(j, b)),
          nextCursor: null,
          scanned: found.jobs.length,
          truncated: found.jobs.length >= LOOKUP_LIMIT,
          mode: 'lookup',
          matchedBy: found.matchedBy,
        };
      }
    }
    const result = await scanJobs(
      {
        list: (queue, state, start, count, asc) =>
          this.jobs.provider.list(queue, state, start, count, asc),
        cancelled: async () => [],
      },
      this.jobs.provider.queues(),
      { ...filter, typeContains: q || filter.typeContains },
      limit,
      this.cfg.searchScanMax,
      decodeCursor(cursor),
    );
    return {
      jobs: result.jobs.map((j) => this.row(j, b)),
      nextCursor: result.nextCursor,
      scanned: result.scanned,
      truncated: result.truncated,
      mode: 'scan',
      matchedBy: null,
    };
  }

  private statusMatches(j: JobRecord, f: JobFilter): boolean {
    if (!f.status) return true;
    return f.status === 'active'
      ? j.status === 'active' || j.status === 'stalled'
      : j.status === f.status;
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  private async activeJobs(): Promise<SectionDto<JobRecord[]>> {
    return this.jobs.section('stalled', async () =>
      (
        await Promise.all(
          this.jobs.provider
            .queues()
            .map((q) => this.jobs.provider.list(q, 'active', 0, ACTIVE_SCAN, true)),
        )
      ).flat(),
    );
  }

  private async delayedJobs(): Promise<SectionDto<JobRecord[]>> {
    return this.jobs.section('delayed', async () =>
      (
        await Promise.all(
          this.jobs.provider
            .queues()
            .map((q) => this.jobs.provider.list(q, 'delayed', 0, DELAYED_SCAN, true)),
        )
      ).flat(),
    );
  }

  private async failedSample(queue: string | null): Promise<SectionDto<JobRecord[]>> {
    return this.jobs.section(null, async () =>
      (
        await Promise.all(
          this.jobs.provider
            .queues()
            .filter((q) => !queue || q === queue)
            .map((q) => this.jobs.provider.list(q, 'failed', 0, FAILED_SAMPLE, false)),
        )
      ).flat(),
    );
  }

  /** Nhóm lỗi theo loại (job lỗi + đang chờ retry) — không bắt người vận hành đọc từng dòng giống nhau. */
  public failureGroups(sample: JobRecord[]): FailureGroupDto[] {
    const map = new Map<string, FailureGroupDto & { r: Set<string> }>();
    for (const j of sample) {
      if (j.status !== 'failed' && j.status !== 'retrying') continue;
      const type = j.errorType ?? 'UnhandledException';
      const at = activityAt(j);
      const g =
        map.get(type) ??
        ({
          errorType: type,
          count: 0,
          retryable: null,
          queues: [],
          types: [],
          dependency: dependencyOf(`${type} ${j.error ?? ''}`),
          lastAt: null,
          sampleJobId: null,
          sampleQueue: null,
          r: new Set<string>(),
        } as FailureGroupDto & { r: Set<string> });
      g.count++;
      g.r.add(String(j.status === 'retrying' ? true : j.retryable));
      if (!g.queues.includes(j.queue)) g.queues.push(j.queue);
      if (!g.types.includes(j.type) && g.types.length < 5) g.types.push(j.type);
      if (!g.lastAt || at > Date.parse(g.lastAt)) {
        g.lastAt = new Date(at).toISOString();
        g.sampleJobId = j.id;
        g.sampleQueue = j.queue;
      }
      map.set(type, g);
    }
    return [...map.values()]
      .map(({ r, ...g }) => ({
        ...g,
        retryable:
          r.size === 1 && r.has('false') ? false : r.size === 1 && r.has('true') ? true : null,
      }))
      .sort((a, b) => b.count - a.count || a.errorType.localeCompare(b.errorType));
  }

  private async priorities(
    queues: QueueInfo[],
    now: number,
  ): Promise<SectionDto<{ level: JobPriorityLevel; waiting: number; oldestSec: number | null }[]>> {
    return this.jobs.section('priority', async () => {
      const counts = new Map<JobPriorityLevel, { waiting: number; oldest: number | null }>();
      const add = (level: JobPriorityLevel, n: number, oldest: number | null) => {
        const c = counts.get(level) ?? { waiting: 0, oldest: null };
        c.waiting += n;
        if (oldest !== null && (c.oldest === null || oldest < c.oldest)) c.oldest = oldest;
        counts.set(level, c);
      };
      for (const q of queues) {
        // Không đặt priority = "normal" (BullMQ lấy trước job có priority).
        if (q.counts.waiting > 0) add('normal', q.counts.waiting, q.oldestWaitingAt);
        if (q.counts.prioritized === 0) continue;
        const sample = await this.jobs.provider.list(
          q.name,
          'prioritized',
          0,
          PRIORITY_SAMPLE,
          true,
        );
        const scale = sample.length ? q.counts.prioritized / sample.length : 0;
        const byLevel = new Map<JobPriorityLevel, JobRecord[]>();
        for (const j of sample)
          byLevel.set(j.priorityLevel, [...(byLevel.get(j.priorityLevel) ?? []), j]);
        for (const [level, list] of byLevel)
          add(level, Math.round(list.length * scale), Math.min(...list.map((j) => j.createdAt)));
      }
      return PRIORITY_ORDER.filter((l) => counts.has(l)).map((level) => {
        const c = counts.get(level)!;
        return {
          level,
          waiting: c.waiting,
          oldestSec: c.oldest === null ? null : Math.max(0, Math.round((now - c.oldest) / 1000)),
        };
      });
    });
  }

  public async getOverview(range: JobsRange): Promise<JobsOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [info, win, todayWin, hourWin, minuteWin, active, delayed, failed, events, b] =
      await Promise.all([
        this.queues.section(null, () => this.queues.queues()),
        this.metrics.window(now - JOBS_RANGES[range] * MINUTE, now, now),
        this.metrics.window(today, now, now),
        this.metrics.window(now - 60 * MINUTE, now, now),
        this.metrics.window(now - MINUTE, now, now, 's10'),
        this.activeJobs(),
        this.delayedJobs(),
        this.failedSample(null),
        this.jobs.events().catch(() => [] as JobEventRecord[]),
        this.baselines(now),
      ]);
    const qs = info.available ? info.data : null;
    const sum = (f: (q: QueueInfo) => number) => (qs ? qs.reduce((s, q) => s + f(q), 0) : null);
    const waiting = sum((q) => q.counts.waiting + q.counts.prioritized);
    const delayedTotal = sum((q) => q.counts.delayed);
    const retrying = delayed.available
      ? delayed.data.filter((j) => j.status === 'retrying').length
      : null;
    const activeRows = active.available ? active.data.map((j) => this.row(j, b)) : null;
    const stalled = activeRows?.filter((j) => j.status === 'stalled') ?? null;
    const longRunning =
      activeRows
        ?.filter((j) => j.longRunning)
        .sort((x, y) => (y.runningMs ?? 0) - (x.runningMs ?? 0)) ?? null;
    const t = this.metrics.report(todayWin);
    const rw = win?.buckets ?? [];
    const incoming = counterOf(rw, 'wq.in');
    const completed = counterOf(rw, 'wq.done') + counterOf(rw, 'wq.exhausted');
    const perMin = (n: number) => (win ? round((n / win.seconds) * 60, 2) : null);
    const inPer = perMin(incoming);
    const outPer = perMin(completed);
    const diff = inPer !== null && outPer !== null ? round(inPer - outPer, 2) : null;
    const rate = {
      incomingPerMin: inPer,
      processingPerMin: outPer,
      diffPerMin: diff,
      state:
        diff === null || incoming + completed === 0
          ? null
          : diff > 0.5 && (waiting ?? 0) > 0
            ? ('growing' as const)
            : diff < -0.5 && (waiting ?? 0) > 0
              ? ('draining' as const)
              : ('stable' as const),
    };
    const sample = [
      ...(failed.available ? failed.data : []),
      ...(delayed.available ? delayed.data.filter((j) => j.status === 'retrying') : []),
    ];
    const groups = this.failureGroups(sample);
    const priorities = qs ? await this.priorities(qs, now) : (info as SectionDto<never>);
    const problems = this.problems({
      qs,
      stalled,
      longRunning,
      groups,
      failuresHour: counterOf(hourWin?.buckets ?? [], 'wq.exhausted'),
      retriesMinute: counterOf(minuteWin?.buckets ?? [], 'wq.retry'),
      rate,
      priorities: priorities.available ? priorities.data : [],
      now,
    });
    const status: JobsStatus = !this.jobs.usable()
      ? 'unavailable'
      : problems.some((p) => p.severity === 'critical')
        ? 'critical'
        : problems.length
          ? 'degraded'
          : (waiting ?? 0) + (activeRows?.length ?? 0) > 0
            ? 'processing'
            : 'idle';
    const provider = this.queues.provider.info();
    return {
      generatedAt: new Date(now).toISOString(),
      environment: this.config.app.env,
      range,
      provider: {
        product: provider.product,
        backend: provider.backend,
        endpoint: provider.endpoint,
        connection: this.jobs.status().state,
      },
      capabilities: [...this.jobs.provider.capabilities],
      status,
      kpis: {
        waiting,
        active: activeRows ? activeRows.length : sum((q) => q.counts.active),
        completedToday: t.completed,
        failedToday: t.failed,
        retrying,
        delayed:
          delayedTotal !== null && retrying !== null
            ? Math.max(0, delayedTotal - retrying)
            : delayedTotal,
        stalled: stalled ? stalled.length : null,
        cancelledToday: t.cancelled,
        successRatePercent: t.successRatePercent,
        failedNow: sum((q) => q.counts.failed),
      },
      rate,
      problems,
      failureGroups: failed.available ? { available: true, data: groups.slice(0, 8) } : failed,
      priorities,
      longRunning: activeRows
        ? { available: true, data: longRunning!.slice(0, 5) }
        : (active as SectionDto<never>),
      stalled: activeRows
        ? { available: true, data: stalled!.slice(0, 10) }
        : (active as SectionDto<never>),
      events: events
        .filter((e) => e.at >= now - DAY)
        .slice(0, OVERVIEW_EVENTS)
        .map((e) => this.eventDto(e)),
      queues: this.jobs.provider.queues(),
      settings: this.settings(),
    };
  }

  private problems(ctx: {
    qs: QueueInfo[] | null;
    stalled: JobRowDto[] | null;
    longRunning: JobRowDto[] | null;
    groups: FailureGroupDto[];
    failuresHour: number;
    retriesMinute: number;
    rate: JobsOverviewDto['rate'];
    priorities: { level: JobPriorityLevel; waiting: number; oldestSec: number | null }[];
    now: number;
  }): JobProblemDto[] {
    const r = this.cfg.rules;
    const q = this.config.queue.rules;
    const out: JobProblemDto[] = [];
    const add = (p: Omit<JobProblemDto, 'message'>, params: Record<string, string | number>) =>
      out.push({ ...p, message: this.i18n.t(`jobs.problem.${p.code}`, params) });
    for (const info of ctx.qs ?? []) {
      const waiting = info.counts.waiting + info.counts.prioritized;
      if (waiting > 0 && info.workers !== null && info.workers.length === 0)
        add(
          {
            id: `NO_WORKER:${info.name}`,
            severity: 'critical',
            code: 'NO_WORKER',
            filter: { status: 'waiting', queue: info.name },
            jobId: null,
            queue: info.name,
          },
          { queue: info.name, count: waiting },
        );
    }
    if (ctx.stalled?.length)
      add(
        {
          id: 'STALLED',
          severity: 'critical',
          code: 'STALLED',
          filter: { status: 'stalled' },
          jobId: ctx.stalled.length === 1 ? ctx.stalled[0]!.id : null,
          queue: null,
        },
        { count: ctx.stalled.length },
      );
    if (ctx.retriesMinute >= q.retryStormPerMin)
      add(
        {
          id: 'RETRY_STORM',
          severity: 'critical',
          code: 'RETRY_STORM',
          filter: { status: 'retrying' },
          jobId: null,
          queue: null,
        },
        {
          count: ctx.retriesMinute,
          type: ctx.groups[0]?.types[0] ?? '—',
          error: ctx.groups[0]?.errorType ?? '—',
        },
      );
    if (ctx.failuresHour >= r.failuresPerHourWarn)
      add(
        {
          id: 'FAILURES',
          severity: 'warning',
          code: 'FAILURES',
          filter: { status: 'failed' },
          jobId: null,
          queue: null,
        },
        { count: ctx.failuresHour },
      );
    for (const info of ctx.qs ?? []) {
      if (info.oldestWaitingAt === null) continue;
      const min = (ctx.now - info.oldestWaitingAt) / MINUTE;
      if (min >= q.oldestWaitingMin)
        add(
          {
            id: `OLDEST_WAITING:${info.name}`,
            severity: 'warning',
            code: 'OLDEST_WAITING',
            filter: { status: 'waiting', queue: info.name },
            jobId: info.oldestWaitingId,
            queue: info.name,
          },
          { queue: info.name, minutes: Math.round(min) },
        );
    }
    const top = ctx.groups[0];
    if (top && top.count >= r.errorGroupWarn)
      add(
        {
          id: `ERROR_GROUP:${top.errorType}`,
          severity: 'warning',
          code: 'ERROR_GROUP',
          filter: { status: 'failed', errorType: top.errorType },
          jobId: null,
          queue: null,
        },
        { error: top.errorType, count: top.count },
      );
    if (ctx.longRunning?.length) {
      const first = ctx.longRunning[0]!;
      add(
        {
          id: 'LONG_RUNNING',
          severity: 'warning',
          code: 'LONG_RUNNING',
          filter: { status: 'active' },
          jobId: first.id,
          queue: first.queue,
        },
        {
          count: ctx.longRunning.length,
          type: first.type,
          minutes: Math.max(1, Math.round((first.runningMs ?? 0) / MINUTE)),
        },
      );
    }
    for (const p of ctx.priorities)
      if ((p.level === 'critical' || p.level === 'high') && (p.oldestSec ?? 0) >= r.criticalWaitSec)
        add(
          {
            id: `CRITICAL_WAITING:${p.level}`,
            severity: 'warning',
            code: 'CRITICAL_WAITING',
            filter: { status: 'waiting' },
            jobId: null,
            queue: null,
          },
          {
            level: this.i18n.t(`jobs.priority.${p.level}`),
            count: p.waiting,
            minutes: Math.max(1, Math.round((p.oldestSec ?? 0) / 60)),
          },
        );
    if (ctx.rate.state === 'growing')
      add(
        {
          id: 'BACKLOG_GROWING',
          severity: 'warning',
          code: 'BACKLOG_GROWING',
          filter: { status: 'waiting' },
          jobId: null,
          queue: null,
        },
        { diff: ctx.rate.diffPerMin ?? 0 },
      );
    return out;
  }

  public getMetrics(range: JobsRange, metric: WorkerMetric, queue: string | null) {
    return this.workers.getMetrics(range, metric, queue);
  }

  // ─── Failures / Report ────────────────────────────────────────────────────

  public async getFailures(range: JobsRange, queue: string | null): Promise<JobsFailuresDto> {
    this.assertQueue(queue);
    const now = Date.now();
    const [win, todayWin, minuteWin, info, failed, delayed] = await Promise.all([
      this.metrics.window(now - JOBS_RANGES[range] * MINUTE, now, now),
      this.metrics.window(startOfDay(now), now, now),
      this.metrics.window(now - MINUTE, now, now, 's10'),
      this.queues.section(null, () => this.queues.queues()),
      this.failedSample(queue),
      this.delayedJobs(),
    ]);
    const retrying = delayed.available
      ? delayed.data.filter((j) => j.status === 'retrying' && (!queue || j.queue === queue))
      : null;
    const failedJobs = failed.available ? failed.data.filter((j) => j.status === 'failed') : null;
    const groups = this.failureGroups([...(failedJobs ?? []), ...(retrying ?? [])]);
    const rb = win?.buckets ?? [];
    const key = (kind: string) =>
      queue ? `wq.q.${queue.replace(/\|/g, '_')}.${kind}` : `wq.${kind}`;
    const done = counterOf(rb, key('done'));
    const exhausted = counterOf(rb, key('exhausted'));
    const retriesMinute = counterOf(minuteWin?.buckets ?? [], 'wq.retry');
    const threshold = this.config.queue.rules.retryStormPerMin;
    const today = todayWin?.buckets ?? [];
    return {
      range,
      queue,
      stats: {
        failedToday: counterOf(today, key('exhausted')),
        failureRatePercent:
          done + exhausted > 0 ? round((exhausted / (done + exhausted)) * 100, 2) : null,
        failedNow: info.available
          ? info.data
              .filter((q) => !queue || q.name === queue)
              .reduce((s, q) => s + q.counts.failed, 0)
          : null,
        retryable: failedJobs ? failedJobs.filter((j) => j.retryable !== false).length : null,
        nonRetryable: failedJobs ? failedJobs.filter((j) => j.retryable === false).length : null,
        retryingNow: retrying ? retrying.length : null,
        retriedToday: counterOf(today, key('retry')),
      },
      groups: failed.available ? { available: true, data: groups } : failed,
      sampled: (failedJobs?.length ?? 0) + (retrying?.length ?? 0),
      retryStorm:
        retriesMinute >= threshold
          ? {
              retriesPerMin: retriesMinute,
              threshold,
              primaryType: groups[0]?.types[0] ?? null,
              primaryError: groups[0]?.errorType ?? null,
            }
          : null,
      settings: this.settings(),
    };
  }

  public async getReport(range: JobsRange): Promise<JobsReportResponseDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [todayWin, yesterdayWin, win] = await Promise.all([
      this.metrics.window(today, now, now),
      this.metrics.window(today - DAY, today, now),
      this.metrics.window(now - JOBS_RANGES[range] * MINUTE, now, now),
    ]);
    return {
      range,
      today: this.metrics.report(todayWin),
      yesterday: this.metrics.report(yesterdayWin),
      types: this.metrics.types(win),
      trackedTypes: this.metrics.trackedTypes,
    };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  private async load(id: string, queue: string | null): Promise<JobDetailRaw> {
    this.assertQueue(queue);
    this.assertUsable();
    const d = await this.jobs.detail(id, queue);
    if (!d) throw new JobNotFoundException({ id });
    return d;
  }

  public async getJob(id: string, queue: string | null): Promise<JobDetailDto> {
    const raw = await this.load(id, queue);
    const now = Date.now();
    const j = raw.record;
    const [b, consumers] = await Promise.all([
      this.baselines(now),
      this.messaging.consumers().catch(() => [] as ConsumerRegistration[]),
    ]);
    const children: JobRecord[] = [];
    const logs = await this.relatedLogs(j);
    const row = this.row(j, b);
    const attempts = this.attempts(raw);
    const lastFailed = [...attempts].reverse().find((a) => a.result === 'failed');
    const typicalMs = row.typicalMs;
    const avgWait = b.wait.get(j.queue) ?? b.wait.get('*') ?? null;
    // Chờ trong queue = tạo → worker nhận lần đầu (vòng đời); không có log → theo bản ghi (chỉ đúng khi mới thử một lần).
    const firstPicked = raw.lifecycle.find((e) => e.type === 'received')?.at ?? null;
    const waitMs = firstPicked !== null ? Math.max(0, firstPicked - j.createdAt) : row.waitMs;
    const processingMs = row.runningMs ?? j.durationMs;
    const totalMs = j.finishedAt !== null ? j.finishedAt - j.createdAt : now - j.createdAt;
    const own = consumers.filter((c) => c.queue === j.queue);
    const idem =
      own.length === 0
        ? null
        : own.every((c) => c.idempotent === true)
          ? true
          : own.some((c) => c.idempotent === false)
            ? false
            : null;
    const diagnosis =
      waitMs === null || processingMs === null
        ? null
        : waitMs > this.longWaitThreshold(avgWait) && waitMs > processingMs * 5
          ? ('wait' as const)
          : typicalMs !== null &&
              processingMs > this.longRunningThreshold(typicalMs) &&
              processingMs > waitMs * 5
            ? ('processing' as const)
            : null;
    const payload = raw.payload;
    const result =
      j.status === 'completed' && raw.returnValue !== null && raw.returnValue !== undefined
        ? (() => {
            const size = byteLength(raw.returnValue);
            return size > RESULT_MAX_BYTES
              ? { sizeBytes: size, summary: null, truncated: true }
              : { sizeBytes: size, summary: redactPayload(raw.returnValue), truncated: false };
          })()
        : null;
    const failure =
      j.status === 'failed' || (j.status === 'retrying' && j.error)
        ? {
            type: lastFailed?.errorType ?? j.errorType ?? 'UnhandledException',
            message: stripType(
              lastFailed?.error ?? j.error ?? '',
              lastFailed?.errorType ?? j.errorType,
            ),
            occurredAt: lastFailed?.finishedAt ?? iso(j.finishedAt),
            attempt: lastFailed?.attempt ?? j.attempts,
            maxAttempts: j.maxAttempts,
            dependency:
              lastFailed?.dependency ?? dependencyOf(`${j.errorType ?? ''} ${j.error ?? ''}`),
            retryable: lastFailed?.retryable ?? j.retryable,
            stack: lastFailed?.stack ?? raw.stacktrace[raw.stacktrace.length - 1] ?? null,
          }
        : null;
    if (failure && failure.retryable !== null && j.retryable === null)
      row.retryable = failure.retryable;
    const cancellable = ['waiting', 'delayed', 'retrying'].includes(j.status);
    return {
      job: row,
      capabilities: [...this.jobs.provider.capabilities],
      timing: {
        waitMs,
        processingMs,
        totalMs,
        queueAvgWaitMs: avgWait === null ? null : round(avgWait, 1),
        waitDeviationPercent:
          avgWait && waitMs !== null ? round(((waitMs - avgWait) / avgWait) * 100, 0) : null,
        typicalMs,
        diagnosis,
      },
      lifecycle: this.lifecycle(raw, now),
      lifecycleAvailable: raw.lifecycle.length > 0,
      attempts,
      failure,
      correlation: {
        correlationId: j.correlationId,
        requestId: j.requestId ?? (j.source.kind === 'http' ? j.source.id : null),
        messageId: j.id,
        schedulerExecutionId: j.source.kind === 'scheduler' ? j.source.id : null,
        parentJobId: j.source.kind === 'job' ? j.source.id : null,
        parentQueue: j.source.kind === 'job' ? j.source.detail : null,
      },
      source: j.source,
      payload: {
        available: payload !== undefined,
        sizeBytes: j.payloadSize,
        contentType: 'application/json',
        schema: j.schema,
        fields: Array.isArray(payload)
          ? payload.length
          : payload && typeof payload === 'object'
            ? Object.keys(payload).length
            : null,
        index: j.index,
        malformed: raw.malformed,
      },
      result,
      idempotency: {
        key: j.idempotencyKey,
        protection: idem === true ? 'enabled' : idem === false ? 'disabled' : 'unknown',
      },
      config: {
        maxAttempts: j.maxAttempts,
        backoff: raw.backoff,
        priority: j.priority,
        priorityLevel: j.priorityLevel,
        cancellable,
        removeOnComplete: raw.removeOnComplete,
        removeOnFail: raw.removeOnFail,
        lockDurationMs: JOB_LOCK_DURATION_MS,
      },
      handler: {
        processors: [...new Set(own.map((c) => c.consumer))].sort(),
        runtimes: [...new Set(own.map((c) => c.runtime ?? '?'))].sort(),
        instances: new Set(own.map((c) => c.instance)).size,
      },
      children: children.map((c) => this.row(c, b)),
      logs: logs.logs,
      logsMatchedBy: logs.by,
      jobLogs: raw.logs,
      stalled: {
        detected: j.status === 'stalled',
        heartbeatAgeSec: row.heartbeatAgeSec,
        stalledCount: j.stalledCount,
      },
      longRunning: {
        detected: row.longRunning,
        runningMs: row.runningMs,
        thresholdMs: row.runningMs !== null ? this.longRunningThreshold(typicalMs) : null,
      },
      actions: this.actions(j, cancellable, consumers),
      settings: this.settings(),
    };
  }

  private actions(
    j: JobRecord,
    cancellable: boolean,
    consumers: ConsumerRegistration[],
  ): JobDetailDto['actions'] {
    const c = this.cfg;
    const state = (allowed: boolean, reason: string | null): ActionStateDto => ({
      allowed,
      reason: allowed ? null : reason,
    });
    const queued = ['waiting', 'delayed', 'retrying'].includes(j.status);
    const running = ['active', 'stalled'].includes(j.status);
    const retry = !c.retry
      ? state(false, 'disabled')
      : j.status !== 'failed'
        ? state(false, 'notFailed')
        : j.retryable === false
          ? state(false, 'nonRetryable')
          : state(true, null);
    const cancel = !c.cancel
      ? state(false, 'disabled')
      : queued
        ? state(true, null)
        : running
          ? cancellable
            ? state(true, null)
            : state(
                false,
                consumers.some((x) => x.queue === j.queue) ? 'notCancellable' : 'noWorker',
              )
          : state(false, 'finished');
    const remove = !c.remove
      ? state(false, 'disabled')
      : ['completed', 'failed', 'cancelled'].includes(j.status)
        ? state(true, null)
        : state(false, 'notFinished');
    const payload = !c.payload
      ? state(false, 'disabled')
      : j.state === 'removed'
        ? state(false, 'removed')
        : state(true, null);
    return {
      retry,
      cancel: { ...cancel, mode: queued ? 'removed' : running ? 'cooperative' : null },
      remove,
      payload,
    };
  }

  /** Log worker trong lúc xử lý job (lọc theo job ID; log cũ chưa có job ID → theo correlation ID). */
  private async relatedLogs(
    j: JobRecord,
  ): Promise<{ logs: JobDetailDto['logs']; by: JobDetailDto['logsMatchedBy'] }> {
    const pick = (l: { t: string; level: string; context?: string; message: string }) => ({
      t: l.t,
      level: l.level,
      ...(l.context ? { context: l.context } : {}),
      message: l.message,
    });
    const byJob = await this.runtimes.getLogs('worker', LOG_LIMIT, { jobId: j.id }).catch(() => []);
    if (byJob.length) return { logs: byJob.map(pick).reverse(), by: 'job' };
    if (!j.correlationId) return { logs: [], by: null };
    const byCorr = await this.runtimes
      .getLogs('worker', LOG_LIMIT, { correlationId: j.correlationId })
      .catch(() => []);
    return byCorr.length
      ? { logs: byCorr.map(pick).reverse(), by: 'correlation' }
      : { logs: [], by: null };
  }

  /** Các lần thử từ vòng đời (job log); không có (job cũ / đã cắt log) → dựng lần thử gần nhất từ timestamp. */
  public attempts(raw: JobDetailRaw): AttemptDto[] {
    const j = raw.record;
    const map = new Map<number, AttemptDto>();
    const get = (n: number) => {
      let a = map.get(n);
      if (!a) {
        a = {
          attempt: n,
          result: 'unknown',
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          error: null,
          errorType: null,
          dependency: null,
          retryable: null,
          instance: null,
          runtime: null,
          backoffMs: null,
          manual: false,
          stack: null,
        };
        map.set(n, a);
      }
      return a;
    };
    let manualNext = false;
    for (const e of raw.lifecycle) {
      if (e.type === 'retried_manually' || e.type === 'replayed') {
        manualNext = true;
        continue;
      }
      if (e.attempt === null) continue;
      const a = get(e.attempt);
      switch (e.type) {
        case 'received':
          a.startedAt = new Date(e.at).toISOString();
          a.result = 'running';
          a.instance = e.instance ?? a.instance;
          a.runtime = e.runtime;
          if (manualNext) a.manual = true;
          manualNext = false;
          break;
        case 'completed':
        case 'failed':
        case 'cancelled':
          a.result = e.type;
          a.finishedAt = new Date(e.at).toISOString();
          a.durationMs = e.ms;
          a.instance = e.instance ?? a.instance;
          a.runtime = a.runtime ?? e.runtime;
          if (e.type !== 'completed') {
            a.error = e.error;
            a.errorType = e.errorType ?? null;
            a.retryable = e.retryable ?? null;
            a.dependency = e.dependency ?? null;
          }
          break;
        case 'retry_scheduled':
          a.backoffMs = e.delayMs;
          break;
        default:
          break;
      }
    }
    let list = [...map.values()].sort((x, y) => x.attempt - y.attempt);
    if (!list.length && (j.startedAt !== null || j.attempts > 0)) {
      const n = Math.max(1, j.attempts);
      const a = get(n);
      a.startedAt = iso(j.startedAt);
      a.finishedAt = iso(j.finishedAt);
      a.durationMs = j.durationMs;
      a.result =
        j.status === 'completed'
          ? 'completed'
          : j.status === 'failed' || j.status === 'retrying'
            ? 'failed'
            : j.status === 'cancelled'
              ? 'cancelled'
              : j.status === 'active' || j.status === 'stalled'
                ? 'running'
                : 'unknown';
      if (a.result === 'failed') {
        a.error = j.error;
        a.errorType = j.errorType;
        a.retryable = j.retryable;
      }
      list = [a];
    }
    // Stack trace BullMQ lưu theo thứ tự lần lỗi (cũ → mới), gán từ lần lỗi gần nhất ngược về.
    const failed = list.filter((a) => a.result === 'failed');
    const stacks = [...raw.stacktrace];
    for (let i = failed.length - 1; i >= 0 && stacks.length; i--)
      failed[i]!.stack = stacks.pop() ?? null;
    return list;
  }

  public lifecycle(raw: JobDetailRaw, now: number): LifecycleStepDto[] {
    const j = raw.record;
    const step = (
      kind: LifecycleStepDto['kind'],
      at: number | null,
      extra: Partial<LifecycleStepDto> = {},
    ): LifecycleStepDto => ({
      at: iso(at),
      kind,
      attempt: null,
      instance: null,
      runtime: null,
      ms: null,
      delayMs: null,
      error: null,
      errorType: null,
      actor: null,
      queue: null,
      current: false,
      ...extra,
    });
    const steps: LifecycleStepDto[] = [
      step('created', j.createdAt),
      step('enqueued', j.createdAt, { queue: j.queue }),
    ];
    const initialDelay =
      raw.lifecycle.length === 0 && j.status === 'delayed' ? j.availableAt : null;
    if (initialDelay)
      steps.push(step('scheduled', j.createdAt, { delayMs: initialDelay - j.createdAt }));
    const kinds: Partial<Record<LifecycleEntry['type'], LifecycleStepDto['kind']>> = {
      received: 'picked',
      completed: 'completed',
      failed: 'failed',
      retry_scheduled: 'retry_scheduled',
      dead_lettered: 'exhausted',
      retried_manually: 'retried_manually',
      replayed: 'replayed',
      cancel_requested: 'cancel_requested',
      cancelled: 'cancelled',
      stalled: 'stalled',
    };
    for (const e of raw.lifecycle) {
      const kind = kinds[e.type];
      if (!kind) continue;
      steps.push(
        step(kind, e.at, {
          attempt: e.attempt,
          instance: e.instance ?? null,
          runtime: e.runtime,
          ms: e.ms,
          delayMs: e.delayMs,
          error: e.error,
          errorType: e.errorType ?? null,
          actor: e.actor ?? null,
        }),
      );
    }
    if (!raw.lifecycle.length) {
      if (j.startedAt !== null)
        steps.push(
          step('picked', j.startedAt, { attempt: Math.max(1, j.attempts), runtime: j.worker }),
        );
      if (j.status === 'completed')
        steps.push(step('completed', j.finishedAt, { ms: j.durationMs }));
      if (j.status === 'failed')
        steps.push(
          step('failed', j.finishedAt, {
            ms: j.durationMs,
            error: j.error,
            errorType: j.errorType,
          }),
        );
    }
    if (j.status === 'cancelled' && !steps.some((s) => s.kind === 'cancelled'))
      steps.push(step('cancelled', j.cancelledAt, { actor: j.cancelledBy, error: j.cancelReason }));
    // Trạng thái hiện tại (chưa kết thúc).
    if (j.status === 'waiting') steps.push(step('waiting', now, { current: true, queue: j.queue }));
    if (j.status === 'active')
      steps.push(step('running', now, { current: true, attempt: j.attempts }));
    if (j.status === 'stalled')
      steps.push(step('stalled', now, { current: true, attempt: j.attempts }));
    if ((j.status === 'retrying' || j.status === 'delayed') && j.availableAt)
      steps.push(step('scheduled', j.availableAt, { current: true }));
    return steps.sort((a, b) => (a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : 0));
  }

  public async getAttempts(id: string, queue: string | null): Promise<AttemptDto[]> {
    return this.attempts(await this.load(id, queue));
  }

  public async getJobLifecycle(id: string, queue: string | null): Promise<LifecycleStepDto[]> {
    return this.lifecycle(await this.load(id, queue), Date.now());
  }

  // ─── Events / Operations / Config ─────────────────────────────────────────

  public eventDto(e: JobEventRecord): JobEventDto {
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message: this.i18n.t(
        `jobs.event.${e.type === 'job_stalled' && !e.jobType ? 'job_stalled_worker' : e.type}`,
        {
          ...e.params,
          job: shortId(e.jobId),
          type: e.jobType ?? '—',
          queue: e.queue ?? '—',
          actor: String(e.params['actor'] ?? this.i18n.t('jobs.event.anonymous')),
        },
      ),
      jobId: e.jobId,
      queue: e.queue,
      jobType: e.jobType,
    };
  }

  public async getEvents(range: JobsRange, jobId: string | null = null): Promise<JobEventDto[]> {
    const from = Date.now() - JOBS_RANGES[range] * MINUTE;
    const events = await this.jobs.events().catch(() => [] as JobEventRecord[]);
    return events
      .filter((e) => (jobId ? e.jobId === jobId : e.at >= from))
      .map((e) => this.eventDto(e));
  }

  public async getOperations(): Promise<JobOperationDto[]> {
    const ops = await this.jobs.operations().catch(() => [] as JobOperationRecord[]);
    return ops.map((o) => this.operationDto(o));
  }

  private operationDto(o: JobOperationRecord): JobOperationDto {
    return { ...o, at: new Date(o.at).toISOString() };
  }

  public async getConfig(): Promise<JobsConfigDto> {
    const info = this.queues.provider.info();
    const d = this.queues.provider.defaults();
    const c = this.cfg;
    const r = c.rules;
    const consumers = await this.messaging.consumers().catch(() => [] as ConsumerRegistration[]);
    return {
      items: [
        { group: 'provider', key: 'product', value: info.product },
        { group: 'provider', key: 'backend', value: info.backend },
        {
          group: 'provider',
          key: 'capabilities',
          value: [...this.jobs.provider.capabilities].join(', '),
        },
        { group: 'jobs', key: 'attempts', value: d.attempts },
        { group: 'jobs', key: 'backoff', value: d.backoff?.type ?? 'none' },
        { group: 'jobs', key: 'backoffDelayMs', value: d.backoff?.delayMs ?? null },
        { group: 'jobs', key: 'lockDurationMs', value: JOB_LOCK_DURATION_MS },
        {
          group: 'jobs',
          key: 'cancellableProcessors',
          value:
            consumers
              .filter((x) => x.cancellable)
              .map((x) => x.consumer)
              .join(', ') || null,
        },
        { group: 'retention', key: 'removeOnComplete', value: d.removeOnComplete },
        { group: 'retention', key: 'removeOnFail', value: d.removeOnFail },
        { group: 'retention', key: 'indexRetentionDays', value: c.indexRetentionDays },
        { group: 'retention', key: 'cancelledRetentionDays', value: c.cancelledRetentionDays },
        { group: 'retention', key: 'metricsRetentionDays', value: 8 },
        { group: 'thresholds', key: 'longRunningFactor', value: r.longRunningFactor },
        { group: 'thresholds', key: 'longRunningMinSec', value: r.longRunningMinSec },
        { group: 'thresholds', key: 'longWaitFactor', value: r.longWaitFactor },
        { group: 'thresholds', key: 'longWaitMinSec', value: r.longWaitMinSec },
        { group: 'thresholds', key: 'failuresPerHourWarn', value: r.failuresPerHourWarn },
        { group: 'thresholds', key: 'errorGroupWarn', value: r.errorGroupWarn },
        { group: 'thresholds', key: 'criticalWaitSec', value: r.criticalWaitSec },
        {
          group: 'thresholds',
          key: 'retryStormPerMin',
          value: this.config.queue.rules.retryStormPerMin,
        },
        { group: 'search', key: 'searchScanMax', value: c.searchScanMax },
        { group: 'actions', key: 'retry', value: c.retry },
        { group: 'actions', key: 'bulkRetryMax', value: c.bulkRetryMax },
        { group: 'actions', key: 'cancel', value: c.cancel },
        { group: 'actions', key: 'remove', value: c.remove },
        { group: 'actions', key: 'payload', value: c.payload },
      ],
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  private async resolveQueue(id: string, queue: string | null): Promise<string> {
    if (queue) {
      this.assertQueue(queue);
      return queue;
    }
    const j = await this.jobs.get(id).catch(() => null);
    if (!j) throw new JobNotFoundException({ id });
    return j.queue;
  }

  public async retry(
    id: string,
    queue: string | null,
    ctx: JobOperationContext,
  ): Promise<JobRetryDto> {
    return this.act(async () => {
      const q = await this.resolveQueue(id, queue);
      const r = await this.operations.retry(q, id, ctx);
      return {
        operation: this.operationDto(r.record),
        job: this.row(r.job, await this.baselines(Date.now())),
      };
    });
  }

  public async bulkRetry(
    items: { queue: string; id: string }[],
    ctx: JobOperationContext,
  ): Promise<JobBulkRetryDto> {
    return this.act(async () => {
      const r = await this.operations.bulkRetry(items, ctx);
      return { operation: this.operationDto(r.record), items: r.items };
    });
  }

  public async cancel(
    id: string,
    queue: string | null,
    reason: string | null,
    ctx: JobOperationContext,
  ): Promise<JobCancelDto> {
    return this.act(async () => {
      const q = await this.resolveQueue(id, queue);
      const r = await this.operations.cancel(q, id, reason, ctx);
      return {
        operation: this.operationDto(r.record),
        mode: r.mode,
        delivered: r.delivered,
        instance: r.instance,
      };
    });
  }

  public async remove(
    id: string,
    queue: string | null,
    ctx: JobOperationContext,
  ): Promise<JobOperationDto> {
    return this.act(async () =>
      this.operationDto(await this.operations.remove(await this.resolveQueue(id, queue), id, ctx)),
    );
  }

  public async payload(id: string, queue: string | null, ctx: JobOperationContext) {
    return this.act(async () =>
      this.operations.payload(await this.resolveQueue(id, queue), id, ctx),
    );
  }

  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  private operationError(err: unknown): Error {
    if (!(err instanceof JobOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new JobsUnavailableException({ state: this.jobs.status().state });
      case 'NOT_FOUND':
        return new JobNotFoundException({ id: err.params['id'] ?? err.message });
      case 'INVALID_STATE':
        return new JobActionRejectedException(
          err.code,
          `jobs.error.INVALID_STATE.${err.params['state'] ?? 'unknown'}`,
          { ...err.params },
        );
      case 'TOO_MANY':
      case 'NON_RETRYABLE':
      case 'NOT_CANCELLABLE':
        return new JobActionRejectedException(
          err.code,
          `jobs.error.${err.code}`,
          { ...err.params },
          422,
        );
      case 'NO_WORKER':
        return new JobActionRejectedException(
          err.code,
          'jobs.error.NO_WORKER',
          { ...err.params },
          503,
        );
      case 'FAILED':
        return new JobActionRejectedException(
          'ACTION_FAILED',
          'jobs.error.FAILED',
          { message: err.message },
          502,
        );
      default:
        return new JobActionRejectedException(
          err.code,
          `jobs.error.${err.code}`,
          { ...err.params },
          403,
        );
    }
  }
}
