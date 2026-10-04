import type { Job, Queue } from 'bullmq';
import type { RedisService } from '@packages/redis/index.js';
import {
  JOB_CANCELLED,
  JOB_LOCK_DURATION_MS,
  QueueRegistry,
  envelopeSize,
  errorTypeOf,
  isRetryableType,
  logLifecycle,
  parseEnvelope,
  parseLifecycle,
  rawClient,
  type JobSource,
  type LifecycleEntry,
  type MessageEnvelope,
} from '@packages/messaging/index.js';
import { JobOperationError } from '../utils/job-errors.js';
import type {
  JobBackoff,
  JobCapability,
  JobDetailRaw,
  JobListState,
  JobPriorityLevel,
  JobProgressInfo,
  JobProvider,
  JobRecord,
  JobStatus,
} from '../contracts/job.types.js';

const CAPABILITIES: JobCapability[] = [
  'progress',
  'stalled',
  'priority',
  'delayed',
  'lifecycle',
  'stacktrace',
  'result',
  'retry',
  'cancel',
  'remove',
];
/** Điểm của zset `delayed` = thời điểm chạy × 0x1000 + bộ đếm (BullMQ). */
const DELAY_SCORE_FACTOR = 0x1000;
const LOG_LIMIT = 200;
/** Job vừa được nhận có thể chưa kịp có khoá — không coi là stalled trong khoảng này. */
const STALL_GRACE_MS = 5000;
const PHASE_STATES = new Set(['done', 'active', 'pending', 'failed']);

/** BullMQ: số nhỏ = ưu tiên cao; 0 = không đặt (BullMQ lấy trước mọi job có priority). */
export function priorityLevel(p: number): JobPriorityLevel {
  if (!p) return 'normal';
  if (p <= 2) return 'critical';
  if (p <= 10) return 'high';
  if (p <= 1000) return 'normal';
  return 'low';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Tiến độ do handler báo; mặc định BullMQ (0) = chưa báo → null (không giả %). */
export function progressOf(raw: unknown): JobProgressInfo | null {
  if (typeof raw === 'number')
    return raw > 0
      ? { percent: Math.min(100, raw), processed: null, total: null, step: null, phases: [] }
      : null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const phases = Array.isArray(o['phases'])
    ? (o['phases'] as unknown[])
        .filter(
          (p): p is { name: string; state: string } =>
            !!p &&
            typeof (p as { name?: unknown }).name === 'string' &&
            PHASE_STATES.has(String((p as { state?: unknown }).state)),
        )
        .slice(0, 20)
        .map((p) => ({
          name: p.name.slice(0, 80),
          state: p.state as JobProgressInfo['phases'][number]['state'],
        }))
    : [];
  const info: JobProgressInfo = {
    percent: num(o['percent']),
    processed: num(o['processed']),
    total: num(o['total']),
    step: typeof o['step'] === 'string' ? o['step'].slice(0, 120) : null,
    phases,
  };
  return info.percent === null && info.processed === null && !info.step && !phases.length
    ? null
    : info;
}

/** Nguồn tạo job: metadata envelope, không có (envelope cũ) → suy từ runtime producer. */
export function sourceOf(env: MessageEnvelope | null): JobSource {
  if (env?.meta?.source) return env.meta.source;
  const producer = env?.producer ?? null;
  switch (producer) {
    case 'scheduler':
      // Scheduler chạy task với correlation ID = execution ID.
      return { kind: 'scheduler', id: env?.correlationId ?? null, name: null, detail: null };
    case 'api':
      return { kind: 'http', id: null, name: null, detail: null };
    case 'worker':
      return { kind: 'job', id: null, name: null, detail: null };
    case 'cli':
      return { kind: 'manual', id: null, name: 'cli', detail: null };
    default:
      return { kind: 'system', id: null, name: producer, detail: null };
  }
}

export function errorTypeOfReason(reason: string | null): string | null {
  if (!reason) return null;
  return (
    errorTypeOf(reason) ??
    (/stalled more than/i.test(reason)
      ? 'StalledLimitExceeded'
      : /timed? ?out/i.test(reason)
        ? 'Timeout'
        : 'UnhandledException')
  );
}

export function backoffOf(job: Pick<Job, 'opts'>): JobBackoff | null {
  const b = job.opts.backoff;
  if (b === undefined) return null;
  return typeof b === 'number'
    ? { type: 'fixed', delayMs: b }
    : { type: b.type, delayMs: b.delay ?? 0 };
}

const retention = (v: unknown): string | null => {
  if (v === undefined || v === false) return null;
  if (v === true) return 'all';
  if (typeof v === 'number') return `count:${v}`;
  if (v && typeof v === 'object') {
    const o = v as { count?: number; age?: number };
    return [o.count !== undefined ? `count:${o.count}` : null, o.age ? `age:${o.age}s` : null]
      .filter(Boolean)
      .join(', ');
  }
  return null;
};

/**
 * Job BullMQ → mô hình chuẩn hoá. `lockTtlMs`: undefined = chưa kiểm tra khoá; null = không còn khoá (stalled nếu
 * đang active quá `STALL_GRACE_MS`).
 */
export function toJobRecord(
  job: Job,
  state: JobListState | 'unknown',
  opts: { runAt?: number | null; lockTtlMs?: number | null | undefined; now?: number } = {},
): JobRecord {
  const now = opts.now ?? Date.now();
  const env = parseEnvelope(job.data);
  const reason = job.failedReason || null;
  const processedAt = job.processedOn ?? null;
  const finishedAt = job.finishedOn ?? null;
  const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
  const listState: JobListState | 'unknown' =
    state === 'unknown' ? (finishedAt ? (reason ? 'failed' : 'completed') : 'unknown') : state;
  const cancelled = listState === 'failed' && !!reason?.startsWith(JOB_CANCELLED);
  let heartbeat: JobRecord['heartbeat'] = null;
  if (listState === 'active' && opts.lockTtlMs !== undefined) {
    const ttl = opts.lockTtlMs;
    heartbeat =
      ttl === null
        ? { alive: false, lastAt: null }
        : { alive: true, lastAt: ttl < 0 ? null : now - Math.max(0, JOB_LOCK_DURATION_MS - ttl) };
  }
  const stalled =
    heartbeat?.alive === false && processedAt !== null && now - processedAt > STALL_GRACE_MS;
  const status: JobStatus =
    listState === 'waiting' || listState === 'prioritized' || listState === 'unknown'
      ? 'waiting'
      : listState === 'active'
        ? stalled
          ? 'stalled'
          : 'active'
        : listState === 'delayed'
          ? job.attemptsMade > 0
            ? 'retrying'
            : 'delayed'
          : listState === 'completed'
            ? 'completed'
            : cancelled
              ? 'cancelled'
              : 'failed';
  const errorType = status === 'completed' ? null : errorTypeOfReason(reason);
  const retryable =
    status === 'retrying'
      ? true
      : status !== 'failed'
        ? null
        : isRetryableType(errorType) === false || job.attemptsMade < maxAttempts
          ? false
          : null;
  const priority = job.opts.priority ?? 0;
  return {
    id: String(job.id ?? ''),
    queue: job.queueName,
    type: env?.topic ?? job.name,
    status,
    state: listState,
    priority,
    priorityLevel: priorityLevel(priority),
    createdAt: job.timestamp,
    availableAt: listState === 'delayed' ? (opts.runAt ?? job.timestamp + (job.delay ?? 0)) : null,
    startedAt: processedAt,
    finishedAt,
    worker: job.processedBy ?? null,
    attempts:
      listState === 'active' ? Math.max(job.attemptsStarted, job.attemptsMade) : job.attemptsMade,
    maxAttempts,
    progress: progressOf(job.progress),
    source: sourceOf(env),
    producer: env?.producer ?? null,
    correlationId: env?.correlationId ?? null,
    requestId: env?.meta?.requestId ?? null,
    idempotencyKey: env?.meta?.idempotencyKey ?? null,
    index: env?.meta?.index ?? {},
    schema: env?.meta?.schema ?? null,
    payloadSize: envelopeSize(job.data),
    error: status === 'completed' ? null : reason,
    errorType,
    retryable,
    stalledCount: job.stalledCounter ?? 0,
    delayReason:
      listState !== 'delayed'
        ? null
        : job.attemptsMade > 0
          ? 'retry'
          : job.repeatJobKey
            ? 'repeat'
            : 'delay',
    // Sau lần thử đầu, `processedOn` là lần thử mới nhất → (processedOn − timestamp) gộp cả backoff: không phải thời gian chờ.
    waitMs:
      processedAt !== null && Math.max(job.attemptsStarted ?? 0, job.attemptsMade) <= 1
        ? Math.max(0, processedAt - job.timestamp)
        : null,
    durationMs: processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null,
    heartbeat,
    cancelledAt: cancelled ? finishedAt : null,
    cancelledBy: null,
    cancelReason: cancelled ? reason!.slice(JOB_CANCELLED.length + 1).trim() || null : null,
  };
}

/**
 * Job provider BullMQ (Redis): đọc job theo từng danh sách có giới hạn, đọc chi tiết (vòng đời từ job log, stack
 * trace, payload, kết quả), khoá của job đang chạy (heartbeat), và thao tác retry / xoá. Không quét toàn bộ.
 */
export class BullMqJobProvider implements JobProvider {
  public readonly capabilities: ReadonlySet<JobCapability> = new Set(CAPABILITIES);

  constructor(
    private readonly registry: QueueRegistry,
    private readonly redis: RedisService,
  ) {}

  private t<T>(task: Promise<T>): Promise<T> {
    return this.registry.withTimeout(task);
  }

  public queues(): string[] {
    return this.registry.names();
  }

  public isKnown(queue: string): boolean {
    return this.registry.isKnown(queue);
  }

  private queue(name: string): Queue {
    if (!this.registry.isKnown(name))
      throw new JobOperationError('NOT_FOUND', name, { queue: name });
    return this.registry.get(name);
  }

  private all(filter?: string | null): Queue[] {
    return this.registry
      .names()
      .filter((n) => !filter || n === filter)
      .map((n) => this.registry.get(n));
  }

  /** Thời điểm chạy của job `delayed` (điểm zset). */
  private async runAt(q: Queue, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const client = await this.t(rawClient(q));
    const res = await this.t(
      client.pipeline(ids.map((id) => ['zscore', q.keys['delayed'] ?? '', id])).exec(),
    ).catch(() => null);
    res?.forEach(([, score]: [Error | null, unknown], i: number) => {
      const s = Number(score);
      if (Number.isFinite(s) && s > 0) out.set(ids[i]!, Math.floor(s / DELAY_SCORE_FACTOR));
    });
    return out;
  }

  /** TTL còn lại của khoá job active (null = không còn khoá). */
  private async locks(q: Queue, ids: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (!ids.length) return out;
    const client = await this.t(rawClient(q));
    const res = await this.t(
      client.pipeline(ids.map((id) => ['pttl', `${q.toKey(id)}:lock`])).exec(),
    ).catch(() => null);
    res?.forEach(([err, ttl]: [Error | null, unknown], i: number) => {
      if (err) return;
      const v = Number(ttl);
      out.set(ids[i]!, v === -2 ? null : v);
    });
    return out;
  }

  private async annotate(q: Queue, jobs: Job[], state: JobListState): Promise<JobRecord[]> {
    const ids = jobs.map((j) => String(j.id));
    const [at, locks] = await Promise.all([
      state === 'delayed' ? this.runAt(q, ids) : Promise.resolve(new Map<string, number>()),
      state === 'active' ? this.locks(q, ids) : Promise.resolve(null),
    ]);
    const now = Date.now();
    return jobs.map((j) =>
      toJobRecord(j, state, {
        runAt: at.get(String(j.id)) ?? null,
        ...(locks
          ? { lockTtlMs: locks.has(String(j.id)) ? locks.get(String(j.id))! : undefined }
          : {}),
        now,
      }),
    );
  }

  public async list(
    queue: string,
    state: JobListState,
    start: number,
    count: number,
    asc: boolean,
  ) {
    const q = this.queue(queue);
    if (count <= 0) return [];
    const jobs = (await this.t(q.getJobs([state], start, start + count - 1, asc))).filter(Boolean);
    return this.annotate(q, jobs, state);
  }

  public async count(queue: string, state: JobListState): Promise<number> {
    return this.t(this.queue(queue).getJobCountByTypes(state));
  }

  private async locate(id: string, queue?: string | null) {
    for (const q of this.all(queue)) {
      const job = await this.t(q.getJob(id)).catch(() => undefined);
      if (!job) continue;
      const raw = await this.t(job.getState()).catch(() => 'unknown' as const);
      const state = (
        ['waiting', 'prioritized', 'active', 'delayed', 'completed', 'failed'].includes(raw)
          ? raw
          : raw === 'waiting-children'
            ? 'waiting'
            : 'unknown'
      ) as JobListState | 'unknown';
      return { q, job, state };
    }
    return null;
  }

  public async get(id: string, queue?: string | null): Promise<JobRecord | null> {
    const found = await this.locate(id, queue);
    if (!found) return null;
    if (found.state === 'unknown') return toJobRecord(found.job, 'unknown');
    const [record] = await this.annotate(found.q, [found.job], found.state);
    return record ?? null;
  }

  public async detail(id: string, queue?: string | null): Promise<JobDetailRaw | null> {
    const found = await this.locate(id, queue);
    if (!found) return null;
    const { q, job, state } = found;
    const [records, logs] = await Promise.all([
      state === 'unknown'
        ? Promise.resolve([toJobRecord(job, 'unknown')])
        : this.annotate(q, [job], state),
      this.t(q.getJobLogs(id, 0, LOG_LIMIT - 1, true)).catch(() => ({
        logs: [] as string[],
        count: 0,
      })),
    ]);
    const lifecycle = parseLifecycle(logs.logs);
    const other = logs.logs.filter((row) => {
      try {
        const e = JSON.parse(row) as Partial<LifecycleEntry>;
        return !(e && typeof e.at === 'number' && typeof e.type === 'string');
      } catch {
        return true;
      }
    });
    const env = parseEnvelope(job.data);
    return {
      record: records[0]!,
      lifecycle,
      logs: other.slice(0, 100),
      stacktrace: (job.stacktrace ?? []).filter(Boolean),
      payload: env ? env.payload : job.data,
      returnValue: job.returnvalue ?? null,
      backoff: backoffOf(job),
      removeOnComplete: retention(job.opts.removeOnComplete),
      removeOnFail: retention(job.opts.removeOnFail),
      malformed: env === null,
    };
  }

  private async jobIn(queue: string, id: string): Promise<Job> {
    const job = await this.t(this.queue(queue).getJob(id));
    if (!job) throw new JobOperationError('NOT_FOUND', id, { id });
    return job;
  }

  public async retry(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id);
    await this.t(job.retry('failed'));
  }

  public async removeQueued(queue: string, id: string): Promise<boolean> {
    const job = await this.jobIn(queue, id);
    const state = await this.t(job.getState());
    if (!['waiting', 'prioritized', 'delayed', 'waiting-children'].includes(state)) return false;
    // Worker có thể vừa lấy job (đã có khoá) → BullMQ từ chối xoá: coi như không còn chờ.
    return this.t(job.remove()).then(
      () => true,
      () => false,
    );
  }

  public async remove(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id);
    await this.t(job.remove());
  }

  public async log(
    queue: string,
    id: string,
    entry: Partial<LifecycleEntry> & { type: LifecycleEntry['type'] },
  ): Promise<void> {
    const job = await this.t(this.queue(queue).getJob(id)).catch(() => undefined);
    if (job) logLifecycle(job, entry.type, entry);
  }
}
