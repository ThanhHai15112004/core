import { performance } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import type { Job, JobState, Queue } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { parseClientList, parseInfo } from '@packages/cache/index.js';
import type { ConsumerRegistration } from '../contracts/messaging-events.types.js';
import { QueueRegistry, rawClient } from '../providers/queue-registry.service.js';
import { MessagingConnectionService } from '../providers/messaging-connection.service.js';
import { envelopeSize, parseEnvelope } from '../serializers/message.serializer.js';
import { logLifecycle, parseLifecycle } from '../utils/lifecycle.js';
import { MessageStateError, sanitizeMessagingMessage } from '../utils/messaging-errors.js';
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
  MessagingProviderInfo,
  MessagingSection,
  QueueSnapshot,
} from './monitoring.types.js';

/** Snapshot queue/backlog dùng lại trong chừng này (nhiều bảng trên cùng trang gọi cùng lúc). */
const SNAPSHOT_TTL_MS = 5000;
const LIFECYCLE_LIMIT = 200;

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

export interface ChannelRegistryEntry {
  channel: string;
  producer: string;
  queue: string;
  lastPublishedAt: number;
}

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

export function summarize(job: Job, state: JobState | ListState | 'unknown'): MessageSummary {
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
      status === 'retrying' || status === 'scheduled' ? job.timestamp + (job.delay ?? 0) : null,
    durationMs: processedAt !== null && finishedAt !== null ? finishedAt - processedAt : null,
    waitMs: processedAt !== null ? Math.max(0, processedAt - job.timestamp) : null,
    error: job.failedReason || null,
    size: envelopeSize(job.data),
  };
}

/**
 * Số liệu messaging đọc thẳng từ BullMQ API (`getJobCounts`, `getJobs`, `getWorkers`, `getJob`) + Redis `INFO`.
 * Không tự lưu lịch sử message; truy vấn luôn có giới hạn. Thao tác retry/replay/discard do tầng operations gọi.
 */
@Injectable()
export class MessagingMonitoringService {
  public readonly capabilities: ReadonlySet<MessagingCapability> = new Set(CAPABILITIES);
  private queueCache: { at: number; data: Promise<QueueSnapshot[]> } | null = null;
  private backlogCache: { at: number; data: Promise<BacklogSample> } | null = null;

  constructor(
    private readonly registry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  public info(): MessagingProviderInfo {
    const { host, port, db } = this.config.cache.redis;
    return {
      driver: 'bullmq',
      product: 'BullMQ',
      broker: 'Redis',
      endpoint: `${host}:${port}/${db}`,
      prefix: this.redis.bullPrefix(),
      channelTerm: 'topic',
    };
  }

  public supports(cap: MessagingCapability): boolean {
    return this.capabilities.has(cap);
  }

  public usable(): boolean {
    return this.connection.getStatus().state === 'connected';
  }

  /** Một phần số liệu; lỗi/không hỗ trợ/mất kết nối → lý do, không ném. */
  public async section<T>(
    cap: MessagingCapability | null,
    fn: () => Promise<T>,
  ): Promise<MessagingSection<T>> {
    if (cap && !this.supports(cap))
      return { available: false, reason: 'unsupported', message: 'BullMQ' };
    if (!this.usable())
      return {
        available: false,
        reason: 'disconnected',
        message: this.connection.getStatus().state,
      };
    try {
      return { available: true, data: await fn() };
    } catch (err) {
      return { available: false, reason: 'error', message: sanitizeMessagingMessage(err) };
    }
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

  /** Broker mất kết nối → lỗi ngay, không xếp lệnh BullMQ chờ hết timeout từng cái. */
  private disconnected(): Promise<never> | null {
    return this.usable()
      ? null
      : Promise.reject(new Error(`Broker ${this.connection.getStatus().state}`));
  }

  public queues(): Promise<QueueSnapshot[]> {
    const down = this.disconnected();
    if (down) return down;
    const now = Date.now();
    if (!this.queueCache || now - this.queueCache.at > SNAPSHOT_TTL_MS) {
      const data = Promise.all(this.all().map((q) => this.snapshot(q)));
      data.catch(() => (this.queueCache = null));
      this.queueCache = { at: now, data };
    }
    return this.queueCache.data;
  }

  private async snapshot(q: Queue): Promise<QueueSnapshot> {
    const [counts, paused, workers, oldest] = await Promise.all([
      this.t(q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized')),
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

  public backlog(): Promise<BacklogSample> {
    const down = this.disconnected();
    if (down) return down;
    const now = Date.now();
    if (!this.backlogCache || now - this.backlogCache.at > SNAPSHOT_TTL_MS) {
      const data = this.sampleBacklog(this.config.messaging.backlogSample);
      data.catch(() => (this.backlogCache = null));
      this.backlogCache = { at: now, data };
    }
    return this.backlogCache.data;
  }

  private async sampleBacklog(limit: number): Promise<BacklogSample> {
    const map = new Map<string, ChannelBacklog>();
    let sampled = 0;
    let truncated = false;
    for (const q of this.all()) {
      const [jobs, counts] = await Promise.all([
        this.t(q.getJobs(['waiting', 'prioritized'], 0, limit - 1, true)),
        this.t(q.getJobCounts('waiting', 'prioritized')),
      ]);
      const list = jobs.filter(Boolean);
      sampled += list.length;
      if ((counts['waiting'] ?? 0) + (counts['prioritized'] ?? 0) > list.length) truncated = true;
      for (const job of list) {
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

  /** Worker đang lắng nghe từng queue — đọc từ `getWorkers()` của BullMQ (không tự đăng ký). */
  public async consumers(): Promise<ConsumerRegistration[]> {
    const now = Date.now();
    const concurrency = this.config.runtime.worker.concurrency;
    const snapshots = await this.queues();
    return snapshots.flatMap((q) =>
      (q.workers ?? []).map((w) => ({
        consumer: w.name ?? 'worker',
        queue: q.name,
        runtime: w.name,
        instance: w.addr ?? w.name ?? 'unknown',
        concurrency,
        paused: q.paused,
        idempotent: null,
        cancellable: false,
        startedAt: w.ageSec !== null ? now - w.ageSec * 1000 : now,
        inFlight: 0,
      })),
    );
  }

  /** Channel đã thấy trong backlog hiện tại (không còn registry tự lưu). */
  public async channelRegistry(): Promise<ChannelRegistryEntry[]> {
    const backlog = await this.backlog().catch(() => null);
    return (backlog?.channels ?? []).map((c) => ({
      channel: c.channel,
      producer: 'unknown',
      queue: c.queue,
      lastPublishedAt: c.oldestAt ?? 0,
    }));
  }

  private async listState(q: Queue, state: ListState, count: number): Promise<MessageSummary[]> {
    const jobs = (await this.t(q.getJobs([state], 0, count - 1, false))).filter(Boolean);
    return jobs.map((j) => summarize(j, state));
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
        found.push(summarize(job, state));
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
          logs: [] as string[],
          count: 0,
        })),
      ]);
      const env = parseEnvelope(job.data);
      const b = job.opts.backoff;
      return {
        ...summarize(job, state),
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

  /** Chạy lại ngay một message đang chờ retry (hoặc hẹn giờ). */
  public async retryNow(queue: string, id: string): Promise<void> {
    const job = await this.jobIn(queue, id, ['delayed']);
    await this.t(job.promote());
    logLifecycle(job, 'retried_manually', { attempt: job.attemptsMade + 1 });
  }

  /** Đưa message từ Dead Letter về hàng đợi, đặt lại số lần thử. */
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

  public isNotFound(err: unknown): boolean {
    return err instanceof MessageStateError && err.code === 'NOT_FOUND';
  }

  /** Bỏ cache sau thao tác (retry/replay/discard) để số liệu cập nhật ngay. */
  public invalidate(): void {
    this.queueCache = null;
    this.backlogCache = null;
  }
}
