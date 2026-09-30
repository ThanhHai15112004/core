import { performance } from 'node:perf_hooks';
import type { Job, Queue } from 'bullmq';
import type { RedisService } from '@packages/redis/index.js';
import { QueueRegistry, parseEnvelope, rawClient } from '@packages/messaging/index.js';
import { QueueOperationError } from '../utils/queue-errors.js';
import type {
  JobState,
  JobSummary,
  QueueCapability,
  QueueInfo,
  QueueJobDefaults,
  QueueMonitoringProvider,
  QueueProviderInfo,
  QueueWorkerConnection,
} from '../contracts/queue-monitoring.types.js';

const CAPABILITIES: QueueCapability[] = [
  'workers',
  'jobs',
  'delayed',
  'priority',
  'stalled',
  'pause',
  'retryFailed',
  'drain',
];
type BullState = 'waiting' | 'prioritized' | 'active' | 'delayed' | 'completed' | 'failed';
const BULL_STATE: Record<JobState, BullState> = {
  waiting: 'waiting',
  prioritized: 'prioritized',
  active: 'active',
  delayed: 'delayed',
  retrying: 'delayed',
  completed: 'completed',
  failed: 'failed',
};
/** Điểm của zset `delayed` = thời điểm chạy × 0x1000 + bộ đếm (BullMQ). */
const DELAY_SCORE_FACTOR = 0x1000;

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

/** Job BullMQ → job chuẩn hoá (delayed có lượt đã thử = đang chờ retry). */
export function toJobSummary(job: Job, state: BullState, runAt: number | null = null): JobSummary {
  const env = parseEnvelope(job.data);
  const normalized: JobState =
    state === 'delayed' ? (job.attemptsMade > 0 ? 'retrying' : 'delayed') : state;
  const processedAt = job.processedOn ?? null;
  const finishedAt = job.finishedOn ?? null;
  return {
    id: String(job.id ?? ''),
    queue: job.queueName,
    name: env?.topic ?? job.name,
    state: normalized,
    attempts:
      state === 'active' ? Math.max(job.attemptsStarted, job.attemptsMade) : job.attemptsMade,
    maxAttempts: Math.max(1, job.opts.attempts ?? 1),
    priority: job.opts.priority ?? 0,
    createdAt: job.timestamp,
    processedAt,
    finishedAt,
    runAt: state === 'delayed' ? (runAt ?? job.timestamp + (job.delay ?? 0)) : null,
    durationMs: processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null,
    waitMs: processedAt !== null ? Math.max(0, processedAt - job.timestamp) : null,
    error: job.failedReason || null,
    correlationId: env?.correlationId ?? null,
    processedBy: job.processedBy ?? null,
    stalledCount: job.stalledCounter ?? 0,
    delayReason:
      state !== 'delayed'
        ? null
        : job.attemptsMade > 0
          ? 'retry'
          : job.repeatJobKey
            ? 'repeat'
            : 'delay',
  };
}

/**
 * Queue provider BullMQ (Redis). Dùng chung `QueueRegistry` với Messaging (cùng hàng đợi vật lý) nhưng nhìn
 * theo góc công việc nền: độ sâu, worker, job, pause/resume, retry job lỗi. Mọi truy vấn có giới hạn.
 */
export class BullMqQueueProvider implements QueueMonitoringProvider {
  public readonly capabilities: ReadonlySet<QueueCapability> = new Set(CAPABILITIES);

  constructor(
    private readonly registry: QueueRegistry,
    private readonly redis: RedisService,
    private readonly endpoint: string,
  ) {}

  public info(): QueueProviderInfo {
    return {
      driver: 'bullmq',
      product: 'BullMQ',
      backend: 'Redis',
      endpoint: this.endpoint,
      prefix: this.redis.bullPrefix(),
    };
  }

  private t<T>(task: Promise<T>): Promise<T> {
    return this.registry.withTimeout(task);
  }

  public isKnown(name: string): boolean {
    return this.registry.isKnown(name);
  }

  private queue(name: string): Queue {
    if (!this.registry.isKnown(name)) throw new QueueOperationError('NOT_FOUND');
    return this.registry.get(name);
  }

  private all(filter?: string | null): Queue[] {
    return this.registry
      .names()
      .filter((n) => !filter || n === filter)
      .map((n) => this.registry.get(n));
  }

  public async ping(): Promise<number> {
    const started = performance.now();
    const [first] = this.all();
    if (!first) return 0;
    await this.t(rawClient(first).then((c) => c.ping()));
    return Number((performance.now() - started).toFixed(2));
  }

  public async queues(): Promise<QueueInfo[]> {
    return Promise.all(
      this.all().map(async (q) => {
        const [counts, paused, workers, oldest] = await Promise.all([
          this.t(
            q.getJobCounts('waiting', 'prioritized', 'active', 'delayed', 'failed', 'completed'),
          ),
          this.t(q.isPaused()),
          this.t(q.getWorkers()).catch(() => null),
          this.t(q.getJobs(['waiting', 'prioritized'], 0, 0, true)).catch(() => []),
        ]);
        const n = (k: string) => counts[k] ?? 0;
        const first = oldest.find(Boolean);
        return {
          name: q.name,
          counts: {
            waiting: n('waiting'),
            prioritized: n('prioritized'),
            active: n('active'),
            delayed: n('delayed'),
            failed: n('failed'),
            completed: n('completed'),
          },
          paused,
          workers: workers?.map((w) => this.worker(w)) ?? null,
          oldestWaitingAt: first?.timestamp ?? null,
          oldestWaitingId: first?.id ? String(first.id) : null,
        };
      }),
    );
  }

  private worker(w: Record<string, string>): QueueWorkerConnection {
    const raw = w['rawname'] ?? '';
    const i = raw.indexOf(':w:');
    const num = (v: string | undefined) => (v !== undefined && v !== '' ? Number(v) : null);
    return {
      name: i >= 0 ? raw.slice(i + 3) : null,
      addr: w['addr'] ?? null,
      ageSec: num(w['age']),
      idleSec: num(w['idle']),
    };
  }

  /** Thời điểm chạy của job `delayed` (đọc điểm zset). */
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

  public async jobs(queue: string | null, states: JobState[], limit: number) {
    if (queue && !this.registry.isKnown(queue)) throw new QueueOperationError('NOT_FOUND');
    const bull = [...new Set(states.map((s) => BULL_STATE[s]))];
    const lists = await Promise.all(
      this.all(queue).flatMap((q) =>
        bull.map(async (state) => {
          // Job chờ: cũ nhất trước (đúng thứ tự sẽ xử lý); còn lại: mới nhất trước.
          const asc = state === 'waiting' || state === 'prioritized' || state === 'delayed';
          const jobs = (await this.t(q.getJobs([state], 0, limit - 1, asc))).filter(Boolean);
          const at =
            state === 'delayed'
              ? await this.runAt(
                  q,
                  jobs.map((j) => String(j.id)),
                )
              : new Map<string, number>();
          return jobs.map((j) => toJobSummary(j, state, at.get(String(j.id)) ?? null));
        }),
      ),
    );
    return lists.flat().filter((j) => states.includes(j.state));
  }

  public defaults(): QueueJobDefaults {
    const o = this.registry.jobOptions('preview');
    const b = o.backoff;
    return {
      attempts: o.attempts ?? 1,
      backoff:
        b === undefined
          ? null
          : typeof b === 'number'
            ? { type: 'fixed', delayMs: b }
            : { type: b.type, delayMs: b.delay ?? 0 },
      removeOnComplete: retention(o.removeOnComplete),
      removeOnFail: retention(o.removeOnFail),
    };
  }

  public async pause(queue: string): Promise<void> {
    await this.t(this.queue(queue).pause());
  }

  public async resume(queue: string): Promise<void> {
    await this.t(this.queue(queue).resume());
  }

  public async retryFailed(queue: string, count: number): Promise<number> {
    const q = this.queue(queue);
    const jobs = (await this.t(q.getJobs(['failed'], 0, count - 1, true))).filter(Boolean);
    let done = 0;
    for (const job of jobs) {
      // Job có thể vừa bị xoá/đổi trạng thái giữa lúc đọc và retry — bỏ qua, không làm hỏng cả lô.
      const ok = await this.t(job.retry('failed')).then(
        () => true,
        () => false,
      );
      if (ok) done++;
    }
    return done;
  }

  public async drain(queue: string, includeDelayed: boolean): Promise<void> {
    await this.t(this.queue(queue).drain(includeDelayed));
  }
}
