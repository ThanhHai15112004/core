import { performance } from 'node:perf_hooks';
import type { Job, JobState, Queue } from 'bullmq';
import type { RedisService } from '@packages/redis/index.js';
import { parseClientList, parseInfo } from '@packages/cache/index.js';
import type { LifecycleEntry } from '../contracts/messaging-events.types.js';
import { QueueRegistry, rawClient } from '../providers/queue-registry.service.js';
import { logLifecycle } from '../utils/lifecycle.js';
import { envelopeSize, parseEnvelope } from '../serializers/message.serializer.js';
import { MessageStateError } from '../utils/messaging-errors.js';
import type {
  BacklogSample,
  BrokerInfo,
  BrokerWorker,
  ChannelBacklog,
  MessageDetail,
  MessageFilter,
  MessagePage,
  MessageStatus,
  MessageSummary,
  MessagingCapability,
  MessagingMonitoringProvider,
  MessagingProviderInfo,
  QueueSnapshot,
} from './monitoring.types.js';

const CAPABILITIES: MessagingCapability[] = [
  'queueDepth',
  'consumers',
  'browse',
  'lifecycle',
  'retry',
  'deadLetter',
  'replay',
  'discard',
  'brokerInfo',
];
type ListState = 'waiting' | 'prioritized' | 'active' | 'delayed' | 'completed' | 'failed';
const STATES_OF: Record<MessageStatus, ListState[]> = {
  queued: ['waiting', 'prioritized'],
  scheduled: ['delayed'],
  processing: ['active'],
  retrying: ['delayed'],
  delivered: ['completed'],
  dead_letter: ['failed'],
  unknown: [],
};
const ALL_STATES: ListState[] = [
  'waiting',
  'prioritized',
  'active',
  'delayed',
  'completed',
  'failed',
];
/** Điểm của zset `delayed` = thời điểm chạy × 0x1000 + bộ đếm (BullMQ). */
const DELAY_SCORE_FACTOR = 0x1000;
const LIFECYCLE_LIMIT = 200;

/** Trạng thái BullMQ → trạng thái messaging (delayed có lượt đã thử = đang chờ retry). */
export function statusOf(
  state: JobState | ListState | 'unknown',
  attemptsMade: number,
): MessageStatus {
  switch (state) {
    case 'waiting':
    case 'prioritized':
    case 'waiting-children':
      return 'queued';
    case 'active':
      return 'processing';
    case 'delayed':
      return attemptsMade > 0 ? 'retrying' : 'scheduled';
    case 'completed':
      return 'delivered';
    case 'failed':
      return 'dead_letter';
    default:
      return 'unknown';
  }
}

export function parseLifecycle(rows: string[]): LifecycleEntry[] {
  const out: LifecycleEntry[] = [];
  for (const row of rows) {
    try {
      const e = JSON.parse(row) as LifecycleEntry;
      if (e && typeof e.at === 'number' && typeof e.type === 'string') out.push(e);
    } catch {
      /* dòng log không phải của Messaging → bỏ qua */
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function summarize(
  job: Job,
  state: JobState | ListState | 'unknown',
  nextAttemptAt: number | null = null,
): MessageSummary {
  const env = parseEnvelope(job.data);
  const status = statusOf(state, job.attemptsMade);
  const processedAt = job.processedOn ?? null;
  const finishedAt = job.finishedOn ?? null;
  return {
    id: String(job.id ?? ''),
    queue: job.queueName,
    channel: env?.topic ?? job.name,
    status,
    producer: env?.producer ?? null,
    correlationId: env?.correlationId ?? null,
    attempts:
      status === 'processing' ? Math.max(job.attemptsStarted, job.attemptsMade) : job.attemptsMade,
    maxAttempts: Math.max(1, job.opts.attempts ?? 1),
    publishedAt: job.timestamp,
    processedAt,
    finishedAt,
    nextAttemptAt:
      status === 'retrying' || status === 'scheduled'
        ? (nextAttemptAt ?? job.timestamp + (job.delay ?? 0))
        : null,
    durationMs: processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null,
    waitMs: processedAt !== null ? Math.max(0, processedAt - job.timestamp) : null,
    error: job.failedReason || null,
    size: envelopeSize(job.data),
  };
}

/**
 * Provider BullMQ (Redis): queue = hàng đợi vật lý, channel = topic (tên job). Mọi truy vấn có giới hạn
 * (không quét toàn bộ). Chỉ đọc, trừ retry/replay/discard do tầng operations gọi.
 */
export class BullMqMonitoringProvider implements MessagingMonitoringProvider {
  public readonly capabilities: ReadonlySet<MessagingCapability> = new Set(CAPABILITIES);

  constructor(
    private readonly registry: QueueRegistry,
    private readonly redis: RedisService,
    private readonly endpoint: string,
  ) {}

  public info(): MessagingProviderInfo {
    return {
      driver: 'bullmq',
      product: 'BullMQ',
      broker: 'Redis',
      endpoint: this.endpoint,
      prefix: this.redis.bullPrefix(),
      channelTerm: 'topic',
    };
  }

  private t<T>(task: Promise<T>): Promise<T> {
    return this.registry.withTimeout(task);
  }

  private queue(name: string): Queue {
    if (!this.registry.isKnown(name)) throw new MessageStateError('NOT_FOUND');
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

  public async queues(): Promise<QueueSnapshot[]> {
    return Promise.all(
      this.all().map(async (q) => {
        const [counts, paused, workers, oldest] = await Promise.all([
          this.t(
            q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'),
          ),
          this.t(q.isPaused()),
          this.t(q.getWorkers()).catch(() => null),
          this.t(q.getJobs(['waiting', 'prioritized'], 0, 0, true)).catch(() => []),
        ]);
        const n = (k: string) => counts[k] ?? 0;
        return {
          name: q.name,
          counts: {
            waiting: n('waiting'),
            active: n('active'),
            delayed: n('delayed'),
            failed: n('failed'),
            completed: n('completed'),
            prioritized: n('prioritized'),
          },
          paused,
          workers: workers?.map((w) => this.worker(w)) ?? null,
          oldestWaitingAt: oldest.find(Boolean)?.timestamp ?? null,
        };
      }),
    );
  }

  private worker(w: Record<string, string>): BrokerWorker {
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

  public async backlog(limit: number): Promise<BacklogSample> {
    const perQueue = await Promise.all(
      this.all().map(async (q) => {
        const [jobs, counts] = await Promise.all([
          this.t(q.getJobs(['waiting', 'prioritized'], 0, limit - 1, true)),
          this.t(q.getJobCounts('waiting', 'prioritized')),
        ]);
        const total = (counts['waiting'] ?? 0) + (counts['prioritized'] ?? 0);
        return { q, jobs: jobs.filter(Boolean), total };
      }),
    );
    const map = new Map<string, ChannelBacklog>();
    let sampled = 0;
    let truncated = false;
    for (const { q, jobs, total } of perQueue) {
      sampled += jobs.length;
      if (total > jobs.length) truncated = true;
      for (const job of jobs) {
        const channel = parseEnvelope(job.data)?.topic ?? job.name;
        const key = `${q.name}\u0000${channel}`;
        const row = map.get(key) ?? { channel, queue: q.name, waiting: 0, oldestAt: null };
        row.waiting++;
        if (row.oldestAt === null || job.timestamp < row.oldestAt) row.oldestAt = job.timestamp;
        map.set(key, row);
      }
    }
    return { channels: [...map.values()], sampled, truncated };
  }

  /** Thời điểm chạy của message đang ở `delayed` (retry có backoff / hẹn giờ). */
  private async delayedAt(q: Queue, ids: string[]): Promise<Map<string, number>> {
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

  private async listState(q: Queue, state: ListState, count: number): Promise<MessageSummary[]> {
    const jobs = (await this.t(q.getJobs([state], 0, count - 1, false))).filter(Boolean);
    const next =
      state === 'delayed'
        ? await this.delayedAt(
            q,
            jobs.map((j) => String(j.id)),
          )
        : new Map();
    return jobs.map((j) => summarize(j, state, next.get(String(j.id)) ?? null));
  }

  public async listMessages(filter: MessageFilter, perState: number): Promise<MessagePage> {
    const search = filter.search.trim();
    const states = filter.status ? STATES_OF[filter.status] : ALL_STATES;
    let examined = 0;
    let truncated = false;
    const found: MessageSummary[] = [];
    const seen = new Set<string>();
    // Đúng message ID → lấy thẳng (không phụ thuộc giới hạn quét).
    if (search)
      for (const q of this.all(filter.queue)) {
        const job = await this.t(q.getJob(search)).catch(() => undefined);
        if (!job) continue;
        const state = await this.t(job.getState()).catch(() => 'unknown' as const);
        const next = state === 'delayed' ? await this.delayedAt(q, [String(job.id)]) : new Map();
        found.push(summarize(job, state, next.get(String(job.id)) ?? null));
        seen.add(`${q.name}:${job.id}`);
      }
    for (const q of this.all(filter.queue)) {
      const lists = await Promise.all(states.map((s) => this.listState(q, s, perState)));
      for (const list of lists) {
        examined += list.length;
        if (list.length >= perState) truncated = true;
        for (const m of list) {
          if (seen.has(`${m.queue}:${m.id}`)) continue;
          if (filter.status && m.status !== filter.status) continue;
          if (filter.channel && m.channel !== filter.channel) continue;
          if (filter.producer && (m.producer ?? 'unknown') !== filter.producer) continue;
          if (search && m.id !== search && m.correlationId !== search) continue;
          seen.add(`${m.queue}:${m.id}`);
          found.push(m);
        }
      }
    }
    found.sort((a, b) => (b.processedAt ?? b.publishedAt) - (a.processedAt ?? a.publishedAt));
    return { messages: found, examined, truncated };
  }

  public async message(id: string, queue?: string | null): Promise<MessageDetail | null> {
    for (const q of this.all(queue)) {
      const job = await this.t(q.getJob(id)).catch(() => undefined);
      if (!job) continue;
      const [state, logs] = await Promise.all([
        this.t(job.getState()).catch(() => 'unknown' as const),
        this.t(q.getJobLogs(id, 0, LIFECYCLE_LIMIT - 1, true)).catch(() => ({
          logs: [],
          count: 0,
        })),
      ]);
      const next = state === 'delayed' ? await this.delayedAt(q, [id]) : new Map<string, number>();
      const env = parseEnvelope(job.data);
      const b = job.opts.backoff;
      return {
        ...summarize(job, state, next.get(id) ?? null),
        payload: env ? env.payload : job.data,
        lifecycle: parseLifecycle(logs.logs),
        stacktrace: (job.stacktrace ?? []).filter(Boolean),
        backoff:
          b === undefined
            ? null
            : typeof b === 'number'
              ? { type: 'fixed', delayMs: b }
              : { type: b.type, delayMs: b.delay ?? 0 },
        malformed: env === null,
      };
    }
    return null;
  }

  public async retrying(limit: number): Promise<MessageSummary[]> {
    const lists = await Promise.all(this.all().map((q) => this.listState(q, 'delayed', limit)));
    return lists
      .flat()
      .filter((m) => m.status === 'retrying')
      .sort((a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0));
  }

  public async deadLetters(limit: number): Promise<MessageSummary[]> {
    const lists = await Promise.all(this.all().map((q) => this.listState(q, 'failed', limit)));
    return lists.flat().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  }

  private async jobIn(queue: string, id: string, expected: JobState[]): Promise<Job> {
    const job = await this.t(this.queue(queue).getJob(id));
    if (!job) throw new MessageStateError('NOT_FOUND');
    const state = await this.t(job.getState());
    if (!expected.includes(state as JobState)) throw new MessageStateError('INVALID_STATE', state);
    return job;
  }

  public async retryNow(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id, ['delayed']);
    await this.t(job.promote());
    logLifecycle(job, 'retried_manually', { attempt: job.attemptsMade + 1 });
  }

  public async replay(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id, ['failed']);
    await this.t(job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true }));
    logLifecycle(job, 'replayed', {});
  }

  public async discard(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id, ['failed']);
    await this.t(job.remove());
  }

  public async broker(): Promise<BrokerInfo> {
    const [infoRaw, clientsRaw] = await Promise.all([
      this.redis.client.info(),
      (this.redis.client.client('LIST') as Promise<unknown>).then(String).catch(() => ''),
    ]);
    const info = parseInfo(infoRaw);
    const num = (k: string) => {
      const v = Number(info.get(k));
      return info.has(k) && Number.isFinite(v) ? v : null;
    };
    const byRuntime = new Map<string, number>();
    const workerPrefix = `${this.redis.bullPrefix()}:`;
    for (const c of parseClientList(clientsRaw)) {
      const name = c['name'] ?? '';
      const own = /^core-(.+)-bull$/.exec(name)?.[1];
      const worker =
        name.startsWith(workerPrefix) && name.includes(':w:') ? name.split(':w:')[1] : null;
      const runtime = own ?? worker;
      if (runtime) byRuntime.set(runtime, (byRuntime.get(runtime) ?? 0) + 1);
    }
    const maxMemory = num('maxmemory');
    return {
      version: info.get('redis_version') ?? null,
      uptimeSec: num('uptime_in_seconds'),
      usedMemoryBytes: num('used_memory'),
      maxMemoryBytes: maxMemory && maxMemory > 0 ? maxMemory : null,
      connectedClients: num('connected_clients'),
      connections: [...byRuntime.entries()]
        .map(([runtime, count]) => ({ runtime, count }))
        .sort((a, b) => a.runtime.localeCompare(b.runtime)),
    };
  }
}
