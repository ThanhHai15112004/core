import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { QUEUES } from '../constants/queues.constant.js';
import type {
  MessagingConnectionState,
  MessagingConnectionStatus,
} from '../contracts/messaging-events.types.js';
import { messagingErrorCode, sanitizeMessagingMessage } from '../utils/messaging-errors.js';
import { recordMessagingEvent } from '../utils/messaging-events.js';
import { QueueRegistry, rawClient } from './queue-registry.service.js';

const CHECK_MS = 30_000;
/** Số lần kiểm tra lỗi liên tiếp trước khi coi là "không khả dụng". */
const UNAVAILABLE_AFTER = 3;
const BOOT_CHECK_MS = 3000;

/**
 * Trạng thái kết nối tới broker (BullMQ trên Redis): PING định kỳ qua kết nối của BullMQ, ghi sự kiện
 * mất/khôi phục kết nối (chỉ runtime API ghi để không lặp).
 */
@Injectable()
export class MessagingConnectionService implements OnApplicationBootstrap, OnModuleDestroy {
  private state: MessagingConnectionState = 'connecting';
  private since = Date.now();
  private lastSuccessAt: number | null = null;
  private lastPingMs: number | null = null;
  private lastError: string | null = null;
  private lastPublishAt: number | null = null;
  private failures = 0;
  private lostAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly queues: QueueRegistry,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {}

  /** Chờ lần kiểm tra đầu (tối đa BOOT_CHECK_MS) để trạng thái xác định ngay khi app sẵn sàng. */
  public async onApplicationBootstrap(): Promise<void> {
    await Promise.race([this.check(), new Promise((r) => setTimeout(r, BOOT_CHECK_MS).unref())]);
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(state: MessagingConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.since = Date.now();
  }

  /** PING broker ngay (public cho Test Broker/overview). */
  public async check(): Promise<MessagingConnectionStatus> {
    const started = performance.now();
    try {
      const queue = this.queues.get(QUEUES.SYSTEM_EVENTS);
      // BullMQ chờ kết nối vô hạn — lỗi kết nối (ECONNREFUSED…) được báo qua sự kiện `error`: fail ngay.
      let onError: ((err: Error) => void) | undefined;
      const failed = new Promise<never>((_, reject) => {
        onError = reject;
        queue.once('error', onError);
      });
      try {
        await this.queues.withTimeout(
          Promise.race([rawClient(queue).then((c) => c.ping()), failed]),
        );
      } finally {
        if (onError) queue.off('error', onError);
      }
      this.markSuccess(Number((performance.now() - started).toFixed(2)));
    } catch (err) {
      this.markFailure(err);
    }
    return this.getStatus();
  }

  public markPublished(): void {
    this.lastPublishAt = Date.now();
    if (this.state !== 'connected') this.markSuccess();
  }

  public markSuccess(pingMs: number | null = null): void {
    const now = Date.now();
    if (pingMs !== null) this.lastPingMs = pingMs;
    this.lastSuccessAt = now;
    this.failures = 0;
    this.lastError = null;
    this.set('connected');
    if (this.lostAt === null) return;
    const lostAt = this.lostAt;
    this.lostAt = null;
    if (this.identity?.id !== 'api') return;
    void recordMessagingEvent(this.redis, {
      type: 'connection_recovered',
      severity: 'success',
      params: { seconds: Math.max(1, Math.round((now - lostAt) / 1000)) },
      runtime: this.identity.id,
      at: now,
    });
  }

  private markFailure(err: unknown): void {
    const code = messagingErrorCode(err);
    this.lastError = `${code ? `${code}: ` : ''}${sanitizeMessagingMessage(err)}`;
    this.failures++;
    const wasUp = this.state === 'connected';
    this.set(
      this.failures >= UNAVAILABLE_AFTER || !this.lastSuccessAt ? 'unavailable' : 'reconnecting',
    );
    if (!wasUp) return;
    this.lostAt = Date.now();
    if (this.identity?.id === 'api')
      void recordMessagingEvent(this.redis, {
        type: 'connection_lost',
        severity: 'critical',
        params: { error: this.lastError },
        runtime: this.identity.id,
      });
  }

  public getStatus(): MessagingConnectionStatus {
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    return {
      state: this.state,
      since: new Date(this.since).toISOString(),
      lastSuccessAt: iso(this.lastSuccessAt),
      lastPingMs: this.lastPingMs,
      lastError: this.lastError,
      lastPublishAt: iso(this.lastPublishAt),
      failures: this.failures,
    };
  }
}
