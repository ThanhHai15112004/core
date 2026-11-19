import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  MessagingMonitoringService,
  dependencyOf,
  type JobEventRecord,
  type JobOperationRecord,
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
import { RuntimesService } from '@modules/runtimes/index.js';
import { WORKER_RANGES } from '@modules/worker-ops/index.js';
import { JobsInspectorService } from './jobs-inspector.service.js';
import { JobsMetricsService } from './jobs-metrics.service.js';
import { activityAt, decodeCursor, scanJobs, type JobFilter } from './job-search.js';
import {
  JobActionRejectedException,
  JobNotFoundException,
  JobsUnavailableException,
} from '../exceptions/jobs-ops.exceptions.js';
import type {
  AttemptDto,
  FailureGroupDto,
  JobBulkRetryDto,
  JobCancelDto,
  JobDetailDto,
  JobEventDto,
  JobOperationDto,
  JobProblemDto,
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
import { round } from '@packages/metrics/index.js';

export const JOBS_RANGES = WORKER_RANGES;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ACTIVE_SCAN = 200;
const DELAYED_SCAN = 500;
const FAILED_SAMPLE = 200;
const PRIORITY_SAMPLE = 200;
const LOOKUP_LIMIT = 200;
const PRIORITY_ORDER: JobPriorityLevel[] = ['critical', 'high', 'normal', 'low'];

/** Định dạng mốc thời gian sang chuỗi chuẩn ISO 8601 */
const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();
/** Lấy mốc thời gian bắt đầu của ngày theo chuỗi ngày giờ */
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

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
  private readonly inspector: JobsInspectorService;

  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly operations: JobOperationsService,
    private readonly queues: QueueMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly metrics: JobsMetricsService,
    private readonly runtimes: RuntimesService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
    @Optional() inspector?: JobsInspectorService,
  ) {
    this.inspector =
      inspector ??
      new JobsInspectorService(
        this.jobs,
        this.queues,
        this.messaging,
        this.runtimes,
        this.config,
        this.i18n,
      );
  }

  private get cfg() {
    return this.config.jobs;
  }

  /** Lấy các thiết lập cấu hình phân tích lưu lượng truy cập */
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

  /** Kiểm tra và xác nhận tính hợp lệ của hàng đợi chỉ định */
  private assertQueue(queue: string | null | undefined): void {
    if (queue && !this.jobs.provider.isKnown(queue)) throw new JobNotFoundException({ id: queue });
  }

  /** Kiểm tra dịch vụ có đủ điều kiện sẵn sàng sử dụng hay không */
  private assertUsable(): void {
    if (!this.jobs.usable())
      throw new JobsUnavailableException({ state: this.jobs.status().state });
  }

  /** Lấy các giá trị đường cơ sở (baselines) để so sánh hiệu năng */
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

  /** Chuyển đổi bản ghi dữ liệu thành hàng hiển thị trên bảng */
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

  /** Tìm kiếm các bản ghi theo từ khóa hoặc tiêu chí lọc */
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

  /** Kiểm tra xem trạng thái có khớp với điều kiện lọc hay không */
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

  /** Lấy danh sách các job đang bị trì hoãn trong hàng đợi */
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

  /** Lấy mẫu danh sách các job bị thất bại gần đây */
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
          types: [],
          dependency: dependencyOf(`${type} ${j.error ?? ''}`),
          lastAt: null,
          r: new Set<string>(),
        } as FailureGroupDto & { r: Set<string> });
      g.count++;
      g.r.add(String(j.status === 'retrying' ? true : j.retryable));
      if (!g.types.includes(j.type) && g.types.length < 5) g.types.push(j.type);
      if (!g.lastAt || at > Date.parse(g.lastAt)) g.lastAt = new Date(at).toISOString();
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

  /** Lấy danh sách các mức độ ưu tiên của hàng đợi */
  private async priorities(
    queues: QueueInfo[],
    now: number,
  ): Promise<SectionDto<{ level: JobPriorityLevel; waiting: number; oldestSec: number | null }[]>> {
    return this.jobs.section('priority', async () => {
      const counts = new Map<JobPriorityLevel, { waiting: number; oldest: number | null }>();
      /** Thêm mới một phần tử vào danh sách hoặc bộ sưu tập */
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

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  public async getOverview(range: JobsRange): Promise<JobsOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [info, win, todayWin, hourWin, minuteWin, active, delayed, failed, b] = await Promise.all(
      [
        this.queues.section(null, () => this.queues.queues()),
        this.metrics.window(now - JOBS_RANGES[range] * MINUTE, now, now),
        this.metrics.window(today, now, now),
        this.metrics.window(now - 60 * MINUTE, now, now),
        this.metrics.window(now - MINUTE, now, now),
        this.activeJobs(),
        this.delayedJobs(),
        this.failedSample(null),
        this.baselines(now),
      ],
    );
    const qs = info.available ? info.data : null;
    /** Tính tổng các giá trị trong mảng số liệu */
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
    const rc = this.metrics.counts(win);
    const incoming = rc.incoming;
    const completed = rc.completed + rc.exhausted;
    /** Tính toán tần suất trung bình của tác vụ theo mỗi phút */
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
      failuresHour: this.metrics.counts(hourWin).exhausted,
      retriesMinute: this.metrics.counts(minuteWin).retried,
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
      environment: this.config.app.env,
      provider: {
        product: provider.product,
        backend: provider.backend,
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
      queues: this.jobs.provider.queues(),
      settings: this.settings(),
    };
  }

  /** Thu thập danh sách các vấn đề và sự cố hiện có */
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
    return this.inspector.problems(ctx);
  }

  // ─── Failures / Report ────────────────────────────────────────────────────

  public async getFailures(range: JobsRange, queue: string | null): Promise<JobsFailuresDto> {
    this.assertQueue(queue);
    const now = Date.now();
    const [win, todayWin, minuteWin, info, failed, delayed] = await Promise.all([
      this.metrics.window(now - JOBS_RANGES[range] * MINUTE, now, now),
      this.metrics.window(startOfDay(now), now, now),
      this.metrics.window(now - MINUTE, now, now),
      this.queues.section(null, () => this.queues.queues()),
      this.failedSample(queue),
      this.delayedJobs(),
    ]);
    const retrying = delayed.available
      ? delayed.data.filter((j) => j.status === 'retrying' && (!queue || j.queue === queue))
      : null;
    const failedJobs = failed.available ? failed.data.filter((j) => j.status === 'failed') : null;
    const groups = this.failureGroups([...(failedJobs ?? []), ...(retrying ?? [])]);
    const rc = this.metrics.counts(win, queue);
    const tc = this.metrics.counts(todayWin, queue);
    const done = rc.completed;
    const exhausted = rc.exhausted;
    const retriesMinute = this.metrics.counts(minuteWin).retried;
    const threshold = this.config.queue.rules.retryStormPerMin;
    return {
      stats: {
        failedToday: tc.exhausted,
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
        retriedToday: tc.retried,
      },
      groups: failed.available ? { available: true, data: groups } : failed,
      sampled: (failedJobs?.length ?? 0) + (retrying?.length ?? 0),
      retryStorm:
        retriesMinute >= threshold
          ? {
              retriesPerMin: retriesMinute,
              primaryType: groups[0]?.types[0] ?? null,
              primaryError: groups[0]?.errorType ?? null,
            }
          : null,
    };
  }

  /** Tạo báo cáo chi tiết về tình trạng hoạt động */
  public async getReport(range: JobsRange): Promise<JobsReportResponseDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [todayWin, yesterdayWin, types] = await Promise.all([
      this.metrics.window(today, now, now),
      this.metrics.window(today - DAY, today, now),
      this.metrics.types(JOBS_RANGES[range]),
    ]);
    return {
      today: this.metrics.report(todayWin),
      yesterday: this.metrics.report(yesterdayWin),
      types,
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

  /** Lấy thông tin chi tiết một job cụ thể trong hàng đợi */
  public async getJob(id: string, queue: string | null): Promise<JobDetailDto> {
    const raw = await this.load(id, queue);
    const now = Date.now();
    const b = await this.baselines(now);
    return this.inspector.buildJobDetail({
      raw,
      now,
      b,
      rowFn: (j, base) => this.row(j, base),
      longWaitThresholdFn: (avg) => this.longWaitThreshold(avg),
      longRunningThresholdFn: (typ) => this.longRunningThreshold(typ),
      settings: this.settings(),
    });
  }

  /** Các lần thử từ vòng đời (job log) */
  public attempts(raw: JobDetailRaw): AttemptDto[] {
    return this.inspector.attempts(raw);
  }

  /** Lấy thông tin chính sách vòng đời (lifecycle policy) của lưu trữ */
  public lifecycle(raw: JobDetailRaw, now: number): LifecycleStepDto[] {
    return this.inspector.lifecycle(raw, now);
  }

  // ─── Events / Operations / Config ─────────────────────────────────────────

  public eventDto(e: JobEventRecord): JobEventDto {
    return this.inspector.eventDto(e);
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async getEvents(range: JobsRange): Promise<JobEventDto[]> {
    return this.inspector.getEvents(range);
  }

  /** Lấy thông tin operations của hệ thống */
  public async getOperations(): Promise<JobOperationDto[]> {
    return this.inspector.getOperations();
  }

  /** Chuyển đổi thông tin thao tác sang đối tượng Operation DTO */
  private operationDto(o: JobOperationRecord): JobOperationDto {
    return this.inspector.operationDto(o);
  }

  /** Lấy thông tin cấu hình hoạt động của dịch vụ */
  public async getConfig(): Promise<JobsConfigDto> {
    return this.inspector.getConfig();
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

  /** Thực hiện thử lại một tác vụ hoặc job thất bại */
  public async retry(
    id: string,
    queue: string | null,
    ctx: JobOperationContext,
  ): Promise<JobOperationDto> {
    return this.act(async () => {
      const r = await this.operations.retry(await this.resolveQueue(id, queue), id, ctx);
      return this.operationDto(r.record);
    });
  }

  /** Thực hiện thử lại hàng loạt tác vụ hoặc job thất bại */
  public async bulkRetry(
    items: { queue: string; id: string }[],
    ctx: JobOperationContext,
  ): Promise<JobBulkRetryDto> {
    return this.act(async () => {
      const r = await this.operations.bulkRetry(items, ctx);
      return { items: r.items };
    });
  }

  /** Hủy bỏ tác vụ hoặc truy vấn đang thực thi */
  public async cancel(
    id: string,
    queue: string | null,
    reason: string | null,
    ctx: JobOperationContext,
  ): Promise<JobCancelDto> {
    return this.act(async () => {
      const q = await this.resolveQueue(id, queue);
      const r = await this.operations.cancel(q, id, reason, ctx);
      return { mode: r.mode, delivered: r.delivered };
    });
  }

  /** Xóa phần tử khỏi hệ thống lưu trữ hoặc hàng đợi */
  public async remove(
    id: string,
    queue: string | null,
    ctx: JobOperationContext,
  ): Promise<JobOperationDto> {
    return this.act(async () =>
      this.operationDto(await this.operations.remove(await this.resolveQueue(id, queue), id, ctx)),
    );
  }

  /** Xử lý và che giấu dữ liệu nhạy cảm trong payload trước khi trả về */
  public async payload(id: string, queue: string | null, ctx: JobOperationContext) {
    return this.act(async () =>
      this.operations.payload(await this.resolveQueue(id, queue), id, ctx),
    );
  }

  /** Thực hiện thao tác vận hành kèm ghi nhận sự kiện */
  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  /** Tạo đối tượng lỗi phản hồi cho thao tác vận hành thất bại */
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
