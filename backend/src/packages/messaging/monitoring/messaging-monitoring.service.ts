import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { messagingKeys } from '../constants/messaging.keys.js';
import type { ConsumerRegistration } from '../contracts/messaging-events.types.js';
import { QueueRegistry } from '../providers/queue-registry.service.js';
import { MessagingConnectionService } from '../providers/messaging-connection.service.js';
import { MessageStateError, sanitizeMessagingMessage } from '../utils/messaging-errors.js';
import { BullMqMonitoringProvider } from './bullmq-monitoring.provider.js';
import type {
  BacklogSample,
  MessagingCapability,
  MessagingMonitoringProvider,
  MessagingSection,
  QueueSnapshot,
} from './monitoring.types.js';

/** Snapshot queue/backlog dùng lại trong chừng này (nhiều bảng trên cùng trang gọi cùng lúc). */
const SNAPSHOT_TTL_MS = 5000;

export interface ChannelRegistryEntry {
  channel: string;
  producer: string;
  queue: string;
  lastPublishedAt: number;
}

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Đọc số liệu vận hành của messaging qua provider theo broker (hiện tại: BullMQ). Chỉ đọc. */
@Injectable()
export class MessagingMonitoringService {
  public readonly provider: MessagingMonitoringProvider;
  private queueCache: { at: number; data: Promise<QueueSnapshot[]> } | null = null;
  private backlogCache: { at: number; data: Promise<BacklogSample> } | null = null;

  constructor(
    registry: QueueRegistry,
    private readonly connection: MessagingConnectionService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {
    const { host, port, db } = this.config.cache.redis;
    this.provider = new BullMqMonitoringProvider(registry, redis, `${host}:${port}/${db}`);
  }

  public supports(cap: MessagingCapability): boolean {
    return this.provider.capabilities.has(cap);
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
      return { available: false, reason: 'unsupported', message: this.provider.info().product };
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

  public queues(): Promise<QueueSnapshot[]> {
    const now = Date.now();
    if (!this.queueCache || now - this.queueCache.at > SNAPSHOT_TTL_MS) {
      const data = this.provider.queues();
      data.catch(() => (this.queueCache = null));
      this.queueCache = { at: now, data };
    }
    return this.queueCache.data;
  }

  public backlog(): Promise<BacklogSample> {
    const now = Date.now();
    if (!this.backlogCache || now - this.backlogCache.at > SNAPSHOT_TTL_MS) {
      const data = this.provider.backlog(this.config.messaging.backlogSample);
      data.catch(() => (this.backlogCache = null));
      this.backlogCache = { at: now, data };
    }
    return this.backlogCache.data;
  }

  /** Consumer đang chạy ở mọi runtime (mỗi runtime tự báo, có TTL). */
  public async consumers(): Promise<ConsumerRegistration[]> {
    if (!this.redis.isReady()) return [];
    const keys = messagingKeys(this.redis);
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        keys.consumersPattern(),
        'COUNT',
        100,
      );
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    if (!found.length) return [];
    const raws = await this.redis.client.mget(...found);
    return raws.flatMap((r) => parse<ConsumerRegistration[]>(r) ?? []);
  }

  /** Cặp producer → channel đã từng publish (và queue mang channel đó). */
  public async channelRegistry(): Promise<ChannelRegistryEntry[]> {
    if (!this.redis.isReady()) return [];
    const hash = await this.redis.client.hgetall(messagingKeys(this.redis).channels());
    return Object.entries(hash).flatMap(([field, raw]) => {
      const i = field.indexOf(':');
      const v = parse<{ queue: string; lastPublishedAt: number }>(raw);
      if (i < 0 || !v) return [];
      return [
        {
          producer: field.slice(0, i),
          channel: field.slice(i + 1),
          queue: v.queue,
          lastPublishedAt: v.lastPublishedAt,
        },
      ];
    });
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
