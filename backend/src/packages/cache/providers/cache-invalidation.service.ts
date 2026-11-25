import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { safeJsonParse } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';

export interface CacheInvalidationMessage {
  readonly originInstanceId: string;
  readonly topic: string;
  readonly key?: string;
  readonly action?: string;
  readonly at: string;
}

export type CacheInvalidationHandler = (
  message: CacheInvalidationMessage,
) => void | Promise<void>;

export interface CacheInvalidationOptions {
  readonly allowInTest?: boolean;
}

/**
 * Kênh đồng bộ xóa L1 Cache giữa nhiều API/Worker instances qua Redis Pub/Sub:
 * - Khi một instance cập nhật cấu hình (`settings`) hoặc `feature-flags`, phát tín hiệu lên kênh
 *   `<prefix>cache:invalidate`.
 * - Các instance khác nhận được và xóa L1 cache cục bộ ngay lập tức (bỏ qua self-echo từ chính `originInstanceId`).
 */
@Injectable()
export class CacheInvalidationService implements OnApplicationShutdown {
  private readonly logger = new Logger(CacheInvalidationService.name);
  private readonly handlers = new Map<string, Set<CacheInvalidationHandler>>();
  private subscriber: ReturnType<RedisService['createSubscriber']> | null = null;
  private subscribing = false;
  private readonly instanceId: string;
  private readonly allowInTest: boolean;

  constructor(
    @Optional() private readonly redis?: RedisService | null,
    @Optional() private readonly config?: CoreConfigService | null,
    options?: CacheInvalidationOptions,
  ) {
    this.instanceId =
      config?.app?.instanceId || `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    this.allowInTest = Boolean(options?.allowInTest);
  }

  public get channel(): string {
    if (this.redis && typeof this.redis.key === 'function') {
      return this.redis.key('cache', 'invalidate');
    }
    const prefix = this.config?.cache?.redis?.prefix || 'core:';
    return `${prefix}cache:invalidate`;
  }

  /** Đăng ký handler lắng nghe invalidation theo topic (vd: `settings`, `feature-flags`). */
  public subscribe(topic: string, handler: CacheInvalidationHandler): () => void {
    const normalizedTopic = topic.trim().toLowerCase();
    let topicHandlers = this.handlers.get(normalizedTopic);
    if (!topicHandlers) {
      topicHandlers = new Set();
      this.handlers.set(normalizedTopic, topicHandlers);
    }
    topicHandlers.add(handler);
    void this.ensureSubscriber();

    return () => {
      const current = this.handlers.get(normalizedTopic);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(normalizedTopic);
      }
    };
  }

  /** Phát sự kiện invalidation L1 sang các instance khác qua Redis Pub/Sub. */
  public async publish(
    topic: string,
    payload: { key?: string; action?: string } = {},
  ): Promise<boolean> {
    if (!this.redis?.isReady()) {
      return false;
    }
    if (this.config?.isTest && !this.allowInTest) {
      return false;
    }

    const message: CacheInvalidationMessage = {
      originInstanceId: this.instanceId,
      topic: topic.trim().toLowerCase(),
      ...(payload.key !== undefined ? { key: payload.key } : {}),
      ...(payload.action !== undefined ? { action: payload.action } : {}),
      at: new Date().toISOString(),
    };

    try {
      await this.redis.client.publish(this.channel, JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to publish cache invalidation (${topic}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async ensureSubscriber(): Promise<void> {
    if (this.subscriber || this.subscribing) return;
    if (!this.redis?.isReady()) return;
    if (this.config?.isTest && !this.allowInTest) return;

    this.subscribing = true;
    try {
      const sub = this.redis.createSubscriber();
      this.subscriber = sub;
      sub.on('message', (ch: string, raw: string) => {
        if (ch !== this.channel) return;
        const parsed = safeJsonParse<CacheInvalidationMessage | null>(raw, null);
        if (!parsed || typeof parsed.topic !== 'string') return;
        if (parsed.originInstanceId === this.instanceId) return;

        const topicHandlers = this.handlers.get(parsed.topic.trim().toLowerCase());
        if (!topicHandlers || topicHandlers.size === 0) return;

        for (const handler of topicHandlers) {
          Promise.resolve(handler(parsed)).catch((err: unknown) => {
            this.logger.warn(
              `Cache invalidation handler failed for topic "${parsed.topic}": ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        }
      });
      await sub.subscribe(this.channel);
    } catch (error) {
      this.logger.warn(
        `Failed to subscribe cache invalidation channel: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.subscriber) {
        await this.subscriber.quit().catch(() => undefined);
        this.subscriber = null;
      }
    } finally {
      this.subscribing = false;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.handlers.clear();
    if (this.subscriber) {
      const sub = this.subscriber;
      this.subscriber = null;
      await sub.unsubscribe(this.channel).catch(() => undefined);
      await sub.quit().catch(() => undefined);
    }
  }
}
