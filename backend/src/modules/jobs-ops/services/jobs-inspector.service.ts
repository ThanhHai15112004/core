import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RESILIENCE_SETTING_KEYS, readDynamicResilienceNumber } from '@packages/kernel/index.js';
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
  QueueMonitoringService,
  type JobDetailRaw,
  type JobPriorityLevel,
  type JobRecord,
  type QueueInfo,
} from '@packages/queue/index.js';
import { redactPayload } from '@packages/http/index.js';
import { round } from '@packages/metrics/index.js';
import { RuntimesService } from '@modules/runtimes/index.js';
import { WORKER_RANGES } from '@modules/worker-ops/index.js';
import type {
  ActionStateDto,
  AttemptDto,
  AttemptResponseDto,
  FailureGroupDto,
  JobDetailDto,
  JobEventDto,
  JobOperationDto,
  JobProblemDto,
  JobRowDto,
  JobsConfigDto,
  JobsOverviewDto,
  JobsRange,
  JobsSettingsDto,
  LifecycleStepDto,
} from '../responses/jobs-ops.response.js';

const MINUTE = 60_000;
const LOG_LIMIT = 50;
const RESULT_MAX_BYTES = 4096;

const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();

const byteLength = (v: unknown) => {
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
  } catch {
    return 0;
  }
};

const stripType = (message: string, type: string | null) =>
  type && message.startsWith(`${type}: `) ? message.slice(type.length + 2) : message;

const shortId = (id: string | null) => (id ? (id.length > 12 ? id.slice(0, 8) : id) : '?');

export interface JobInspectorBaselines {
  now: number;
  typical: Map<string, number>;
  wait: Map<string, number>;
}

@Injectable()
export class JobsInspectorService {
  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly queues: QueueMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly runtimes: RuntimesService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.jobs;
  }

  public problems(ctx: {
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
    const rawQ = this.config.queue.rules;
    const q = {
      ...rawQ,
      retryStormPerMin: readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.QUEUE_RETRY_STORM_PER_MIN,
        rawQ.retryStormPerMin,
        { min: 1, max: 100_000, round: true },
      ),
    };
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

  public async buildJobDetail(params: {
    raw: JobDetailRaw;
    now: number;
    b: JobInspectorBaselines;
    rowFn: (j: JobRecord, b: JobInspectorBaselines) => JobRowDto;
    longWaitThresholdFn: (avgWaitMs: number | null) => number;
    longRunningThresholdFn: (typicalMs: number | null) => number;
    settings: JobsSettingsDto;
  }): Promise<JobDetailDto> {
    const { raw, now, b, rowFn, longWaitThresholdFn, longRunningThresholdFn, settings } = params;
    const j = raw.record;
    const consumers = await this.messaging.consumers().catch(() => [] as ConsumerRegistration[]);
    const children: JobRecord[] = [];
    const logs = await this.relatedLogs(j);
    const row = rowFn(j, b);
    const attempts = this.attempts(raw);
    const lastFailed = [...attempts].reverse().find((a) => a.result === 'failed');
    const typicalMs = row.typicalMs;
    const avgWait = b.wait.get(j.queue) ?? b.wait.get('*') ?? null;
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
        : waitMs > longWaitThresholdFn(avgWait) && waitMs > processingMs * 5
          ? ('wait' as const)
          : typicalMs !== null &&
              processingMs > longRunningThresholdFn(typicalMs) &&
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
      attempts: attempts.map(({ dependency: _dependency, ...a }): AttemptResponseDto => a),
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
      children: children.map((c) => rowFn(c, b)),
      logs: logs.logs,
      logsMatchedBy: logs.by,
      jobLogs: raw.logs,
      stalled: { heartbeatAgeSec: row.heartbeatAgeSec },
      longRunning: { detected: row.longRunning, runningMs: row.runningMs },
      actions: this.actions(j, cancellable, consumers),
      settings,
    };
  }

  public actions(
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

  public async relatedLogs(
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
      if (j.status === 'completed') steps.push(step('completed', j.finishedAt));
      if (j.status === 'failed')
        steps.push(step('failed', j.finishedAt, { error: j.error, errorType: j.errorType }));
    }
    if (j.status === 'cancelled' && !steps.some((s) => s.kind === 'cancelled'))
      steps.push(step('cancelled', j.cancelledAt, { actor: j.cancelledBy, error: j.cancelReason }));
    if (j.status === 'waiting') steps.push(step('waiting', now, { current: true, queue: j.queue }));
    if (j.status === 'active')
      steps.push(step('running', now, { current: true, attempt: j.attempts }));
    if (j.status === 'stalled')
      steps.push(step('stalled', now, { current: true, attempt: j.attempts }));
    if ((j.status === 'retrying' || j.status === 'delayed') && j.availableAt)
      steps.push(step('scheduled', j.availableAt, { current: true }));
    return steps.sort((a, b) => (a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : 0));
  }

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

  public async getEvents(range: JobsRange): Promise<JobEventDto[]> {
    const from = Date.now() - WORKER_RANGES[range] * MINUTE;
    const events = await this.jobs.events().catch(() => [] as JobEventRecord[]);
    return events.filter((e) => e.at >= from).map((e) => this.eventDto(e));
  }

  public async getOperations(): Promise<JobOperationDto[]> {
    const ops = await this.jobs.operations().catch(() => [] as JobOperationRecord[]);
    return ops.map((o) => this.operationDto(o));
  }

  public operationDto({ durationMs: _durationMs, ...o }: JobOperationRecord): JobOperationDto {
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
}
