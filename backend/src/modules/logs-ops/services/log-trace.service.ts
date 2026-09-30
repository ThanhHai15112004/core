import { Injectable } from '@nestjs/common';
import type { LogEntry } from '@packages/logging/index.js';
import { JobMonitoringService, type JobRecord } from '@packages/queue/index.js';
import { SchedulerStore, type ExecutionRecord } from '@packages/scheduler/index.js';
import type { LifecycleEntry } from '@packages/messaging/index.js';
import type { RequestSummary } from '@packages/traffic/index.js';
import { TrafficStoreService } from '@modules/traffic/index.js';
import { LogsStoreService } from './logs-store.service.js';
import { LOG_ID_FIELDS, entryTime } from './log-query.js';
import type {
  ResolvedIdDto,
  ResolvedIdKind,
  TraceDto,
  TraceEventDto,
  TraceNodeDto,
} from '../responses/logs-ops.response.js';

const MAX_EVENTS = 500;
const MAX_JOBS = 20;
const ERROR_LEVELS = new Set(['error', 'fatal']);

/** Tên thành phần hiển thị trên timeline. */
const COMPONENT_OF_RUNTIME: Record<string, string> = {
  api: 'api',
  worker: 'worker',
  scheduler: 'scheduler',
  cli: 'cli',
};

const LIFECYCLE_LEVEL: Partial<Record<string, TraceEventDto['level']>> = {
  failed: 'error',
  dead_lettered: 'error',
  retry_scheduled: 'warn',
  stalled: 'warn',
  cancelled: 'warn',
  cancel_requested: 'warn',
};

interface Gathered {
  requests: RequestSummary[];
  jobs: { record: JobRecord; lifecycle: LifecycleEntry[] }[];
  execution: ExecutionRecord | null;
  logs: LogEntry[];
  resolved: ResolvedIdDto;
}

/**
 * Trace theo correlation: gom mọi thứ cùng một chuỗi xử lý — request HTTP, lần chạy Scheduler, job (tạo → worker nhận
 * → xong / lỗi / retry) và log của mọi runtime — thành một timeline. Dán ID bất kỳ (request / job / execution /
 * correlation) đều ra cùng trace.
 */
@Injectable()
export class LogTraceService {
  constructor(
    private readonly store: LogsStoreService,
    private readonly traffic: TrafficStoreService,
    private readonly jobs: JobMonitoringService,
    private readonly scheduler: SchedulerStore,
  ) {}

  /** ID này là gì: request, job, lần chạy Scheduler, correlation (có log mang ID đó), log. */
  public async resolve(id: string, logs?: LogEntry[]): Promise<ResolvedIdDto> {
    const kinds: ResolvedIdKind[] = [];
    let queue: string | null = null;
    let correlationId: string | null = null;
    const [requests, job, execution] = await Promise.all([
      this.traffic.requestLog().catch(() => [] as RequestSummary[]),
      // Broker không kết nối thì không hỏi (BullMQ sẽ chờ kết nối lại).
      this.jobs.usable() ? this.jobs.get(id).catch(() => null) : Promise.resolve(null),
      this.scheduler.execution(id).catch(() => null),
    ]);
    const req = requests.find((r) => r.id === id);
    if (req) {
      kinds.push('request');
      correlationId ??= req.correlationId;
    }
    if (job) {
      kinds.push('job');
      queue = job.queue;
      correlationId ??= job.correlationId;
    }
    if (execution) {
      kinds.push('execution');
      correlationId ??= execution.correlationId ?? execution.id;
    }
    const entries = logs ?? (await this.store.logs()).entries;
    if (
      entries.some((e) => e.correlationId === id) ||
      requests.some((r) => r.correlationId === id)
    ) {
      kinds.push('correlation');
      correlationId ??= id;
    }
    if (entries.some((e) => e.id === id)) kinds.push('log');
    return { id, kinds, queue, correlationId };
  }

  private async gather(id: string): Promise<Gathered> {
    const snapshot = await this.store.logs();
    const resolved = await this.resolve(id, snapshot.entries);
    const corr = resolved.correlationId ?? id;
    const requests = (await this.traffic.requestLog().catch(() => [] as RequestSummary[])).filter(
      (r) => r.id === id || r.correlationId === corr,
    );

    const refs = new Map<string, { queue: string; id: string }>();
    for (const field of ['corr', 'exec'] as const)
      for (const r of await this.jobs.lookup(field, corr, MAX_JOBS).catch(() => []))
        refs.set(`${r.queue}|${r.id}`, r);
    for (const r of requests)
      for (const ref of await this.jobs.lookup('req', r.id, MAX_JOBS).catch(() => []))
        refs.set(`${ref.queue}|${ref.id}`, ref);
    if (resolved.kinds.includes('job') && resolved.queue)
      refs.set(`${resolved.queue}|${id}`, { queue: resolved.queue, id });
    const jobs: Gathered['jobs'] = [];
    for (const ref of this.jobs.usable() ? [...refs.values()].slice(0, MAX_JOBS) : []) {
      const d = await this.jobs.detail(ref.id, ref.queue).catch(() => null);
      if (d) jobs.push({ record: d.record, lifecycle: d.lifecycle });
    }

    const execution =
      (await this.scheduler.execution(corr).catch(() => null)) ??
      (resolved.kinds.includes('execution')
        ? await this.scheduler.execution(id).catch(() => null)
        : null);

    const jobIds = new Set(jobs.map((j) => j.record.id));
    const requestIds = new Set(requests.map((r) => r.id));
    const logs = snapshot.entries.filter(
      (e) =>
        e.correlationId === corr ||
        LOG_ID_FIELDS.some((f) => e[f] === id) ||
        (e.jobId !== undefined && jobIds.has(e.jobId)) ||
        (e.requestId !== undefined && requestIds.has(e.requestId)) ||
        (execution !== null && e.executionId === execution.id),
    );
    return { requests, jobs, execution, logs, resolved };
  }

  public async trace(id: string): Promise<TraceDto | null> {
    const g = await this.gather(id);
    const events: TraceEventDto[] = [];

    for (const r of g.requests) {
      events.push({
        at: new Date(r.at).toISOString(),
        component: 'api',
        kind: 'request',
        level: r.status >= 500 ? 'error' : r.status >= 400 ? 'warn' : 'info',
        label: `${r.method} ${r.route}`,
        detail: `${r.status} · ${Math.round(r.durationMs)}ms`,
        module: null,
        logId: null,
        link: { kind: 'request', id: r.id },
      });
    }

    if (g.execution) {
      const x = g.execution;
      const at = x.startedAt ?? x.scheduledAt;
      if (at)
        events.push({
          at: new Date(at).toISOString(),
          component: 'scheduler',
          kind: 'execution',
          level:
            x.status === 'failed'
              ? 'error'
              : x.status === 'missed' || x.status === 'skipped'
                ? 'warn'
                : 'info',
          label: x.taskId,
          detail: `${x.status}${x.durationMs !== null ? ` · ${Math.round(x.durationMs)}ms` : ''}${x.error ? ` · ${x.error.type}` : ''}`,
          module: null,
          logId: null,
          link: { kind: 'execution', id: x.id },
        });
    }

    for (const { record: j, lifecycle } of g.jobs) {
      const link = { kind: 'job' as const, id: j.id, queue: j.queue };
      events.push({
        at: new Date(j.createdAt).toISOString(),
        component: 'queue',
        kind: 'job',
        level: 'info',
        label: j.type,
        detail: `enqueued · ${j.queue}`,
        module: null,
        logId: null,
        link,
      });
      lifecycle.forEach((l, idx) => {
        // Lần thử lỗi nhưng còn retry là cảnh báo; lỗi cuối cùng (dead letter / hết lượt) mới là điểm lỗi.
        const retried =
          l.type === 'failed' &&
          lifecycle
            .slice(idx + 1)
            .some((n) => n.type === 'retry_scheduled' && n.attempt === l.attempt);
        events.push({
          at: new Date(l.at).toISOString(),
          component: 'worker',
          kind: 'job',
          level: retried ? 'warn' : (LIFECYCLE_LEVEL[l.type] ?? 'info'),
          label: j.type,
          detail: [
            l.type,
            l.attempt ? `#${l.attempt}` : null,
            l.ms !== null ? `${Math.round(l.ms)}ms` : null,
            l.errorType ?? l.error,
          ]
            .filter(Boolean)
            .join(' · '),
          module: l.dependency ?? null,
          errorType: l.errorType ?? null,
          logId: null,
          link,
        });
      });
      if (lifecycle.length === 0 && j.startedAt)
        events.push({
          at: new Date(j.startedAt).toISOString(),
          component: 'worker',
          kind: 'job',
          level: j.status === 'failed' ? 'error' : 'info',
          label: j.type,
          detail: j.status,
          module: null,
          logId: null,
          link,
        });
    }

    for (const e of g.logs.slice(0, MAX_EVENTS)) {
      events.push({
        at: e.t,
        component: COMPONENT_OF_RUNTIME[e.runtime ?? ''] ?? e.runtime ?? 'unknown',
        kind: 'log',
        level: ERROR_LEVELS.has(e.level) ? 'error' : e.level === 'warn' ? 'warn' : 'info',
        label: e.message,
        detail: e.errorType ?? null,
        errorType: e.errorType ?? null,
        module: e.context ?? null,
        logId: e.id ?? null,
        link: null,
      });
    }

    if (events.length === 0) return null;
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const trimmed = events.slice(0, MAX_EVENTS);
    const first = Date.parse(trimmed[0]!.at);
    const last = Math.max(
      ...trimmed.map((e) => Date.parse(e.at)),
      ...g.requests.map((r) => r.at + r.durationMs),
    );
    const failed = trimmed.find((e) => e.level === 'error') ?? null;
    const running =
      g.jobs.some(
        (j) =>
          j.record.status === 'active' ||
          j.record.status === 'waiting' ||
          j.record.status === 'retrying',
      ) || g.execution?.status === 'running';
    const root = trimmed.find((e) => e.kind === 'request' || e.kind === 'execution') ?? trimmed[0]!;
    const failureLog = failed?.logId ? g.logs.find((l) => l.id === failed.logId) : undefined;
    const oldestLog = g.logs.length ? Math.min(...g.logs.map(entryTime)) : null;
    const snapshot = await this.store.logs();
    const bufferStart = Math.max(
      ...[...snapshot.byRuntime.values()].map((l) =>
        l.length >= this.store.capacity && l.length ? entryTime(l[l.length - 1]!) : 0,
      ),
    );

    return {
      id,
      resolvedFrom: g.resolved.kinds,
      correlationId: g.resolved.correlationId,
      startedAt: new Date(first).toISOString(),
      endedAt: new Date(last).toISOString(),
      durationMs: last - first,
      status: failed ? 'failed' : running ? 'running' : 'ok',
      services: [...new Set(trimmed.map((e) => e.component))],
      counts: {
        logs: g.logs.length,
        errors: trimmed.filter((e) => e.level === 'error').length,
        warnings: trimmed.filter((e) => e.level === 'warn').length,
        jobs: g.jobs.length,
        requests: g.requests.length,
      },
      root: { kind: root.kind, label: root.label, at: root.at },
      failurePoint: failed
        ? {
            component: failed.module ? `${failed.component} · ${failed.module}` : failed.component,
            label: failed.label,
            at: failed.at,
            errorType: failureLog?.errorType ?? failed.errorType ?? null,
            logId: failed.logId,
          }
        : null,
      flow: flowOf(trimmed),
      events: trimmed,
      // Log cũ hơn điểm đầu buffer đã bị ghi đè — trace có thể thiếu phần đầu.
      truncated:
        events.length > MAX_EVENTS ||
        (bufferStart > 0 && (oldestLog === null || bufferStart >= first)),
    };
  }
}

/** Luồng xử lý: các bước liên tiếp gộp theo thành phần (+ module / loại job). */
function flowOf(events: TraceEventDto[]): TraceNodeDto[] {
  const nodes: TraceNodeDto[] = [];
  for (const e of events) {
    const label =
      e.kind === 'log'
        ? (e.module ?? e.component)
        : e.kind === 'job' && e.component === 'queue'
          ? (e.detail?.split(' · ')[1] ?? e.label)
          : e.label;
    const prev = nodes[nodes.length - 1];
    if (prev && prev.component === e.component && prev.label === label) {
      prev.events++;
      if (e.level === 'error') prev.status = 'error';
      prev.link ??= e.link;
      continue;
    }
    nodes.push({
      component: e.component,
      label,
      status: e.level === 'error' ? 'error' : 'ok',
      events: 1,
      firstAt: e.at,
      link: e.link,
    });
  }
  return nodes.slice(0, 30);
}
