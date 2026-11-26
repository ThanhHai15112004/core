import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import { Cluster, type Redis, type RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RUNTIME_IDENTITY } from '@packages/runtime/constants/runtime.tokens.js';
import {
  REDIS_CLIENT_FACTORY,
  REDIS_CLUSTER_FACTORY,
  type RedisClientFactory,
  type RedisClusterFactory,
} from './redis.constants.js';
import type {
  RedisClusterNodesSummary,
  RedisFailoverEvent,
  RedisFailoverListener,
  RedisHaMode,
  RedisHaStatus,
} from './redis-ha.types.js';
import {
  buildBullConnectionOptions,
  buildClusterClientOptions,
  buildRedisClientOptions,
  formatBullPrefix,
  formatEndpoint,
  resolveConfiguredEndpoints,
  type RedisCacheConfig,
} from './redis-options.builder.js';

const MAX_LATENCY_SAMPLES = 200;

const TRACKED_COMMANDS = new Set([
  'get',
  'set',
  'del',
  'hget',
  'hset',
  'hgetall',
  'lpush',
  'rpush',
  'xadd',
  'xrange',
  'scan',
  'info',
  'ping',
  'eval',
  'exec',
]);

export type RedisLatencyObserver = (operation: string, durationMs: number) => void;

export interface RedisLatencySnapshot {
  count: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  lastPingMs: number | null;
}

function normalizeRedisCommand(name: unknown): string {
  const op = typeof name === 'string' ? name.toLowerCase() : 'other';
  return TRACKED_COMMANDS.has(op) ? op : 'other';
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  const val = sorted[idx];
  return val === undefined ? null : Math.round(val * 100) / 100;
}

function readClientPrimaryEndpoint(client: unknown): string | null {
  const opts = (client as { options?: { host?: unknown; port?: unknown } } | null)?.options;
  if (typeof opts?.host === 'string' && opts.host.trim() !== '') {
    const port = typeof opts.port === 'number' && Number.isFinite(opts.port) ? opts.port : 6379;
    return formatEndpoint(opts.host, port);
  }
  return null;
}

/**
 * Kết nối Redis dùng chung cho mọi runtime (hỗ trợ Standalone, Sentinel và Cluster).
 * Redis có thể dùng chung với project khác nên MỌI key phải đi qua `key()` để có `REDIS_PREFIX`,
 * và không bao giờ dùng lệnh xoá toàn bộ DB.
 * Mất kết nối không làm crash app: lệnh sẽ lỗi nhanh và caller hiểu là "không có telemetry".
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly redisConfig: RedisCacheConfig;
  private readonly options: RedisOptions;
  private readonly prefix: string;
  private readonly clusterClient: Cluster | null = null;
  private readonly subscribers: Redis[] = [];
  private readonly bullClusterClients: Cluster[] = [];
  private readonly latencySamples: number[] = [];
  private readonly latencyObservers = new Set<RedisLatencyObserver>();
  private readonly failoverListeners = new Set<RedisFailoverListener>();
  private readonly clusterFactory: RedisClusterFactory;

  private lastPingMs: number | null = null;
  private lastError: string | null = null;
  private reconnectCount = 0;
  private failoverCount = 0;
  private lastFailoverAt: number | null = null;
  private lastSwitchReason: string | null = null;
  private currentPrimary: string | null = null;

  public readonly client: Redis;
  /** Tên kết nối `core-<runtime>` (CLIENT SETNAME). */
  public readonly clientName: string;

  constructor(
    config: CoreConfigService,
    @Inject(REDIS_CLIENT_FACTORY) private readonly factory: RedisClientFactory,
    @Optional() @Inject(RUNTIME_IDENTITY) identity?: { id: string },
    @Optional() @Inject(REDIS_CLUSTER_FACTORY) clusterFactory?: RedisClusterFactory,
  ) {
    this.redisConfig = config.cache.redis;
    this.prefix = this.redisConfig.prefix;
    this.clientName = `core-${identity?.id ?? 'app'}`;
    this.clusterFactory = clusterFactory ?? ((nodes, opts) => new Cluster(nodes, opts));
    this.options = buildRedisClientOptions(this.redisConfig, this.clientName);

    if (this.redisConfig.mode === 'cluster') {
      const cluster = this.createClusterClient();
      this.clusterClient = cluster;
      this.client = cluster as unknown as Redis;
    } else {
      this.client = this.createClient();
    }
  }

  /** Chế độ triển khai Redis hiện tại (`standalone` | `sentinel` | `cluster`). */
  public get mode(): RedisHaMode {
    return this.redisConfig.mode;
  }

  /** Có đang chạy Redis Cluster hay không. */
  public isCluster(): boolean {
    return this.redisConfig.mode === 'cluster' && this.clusterClient !== null;
  }

  /** Số DB Redis đang dùng (SELECT; Cluster luôn là 0). */
  public get db(): number {
    return this.isCluster() ? 0 : (this.options.db ?? 0);
  }

  /** Kiểm tra xem kết nối hoặc dịch vụ đã sẵn sàng tiếp nhận yêu cầu hay chưa */
  public isReady(): boolean {
    return this.client.status === 'ready';
  }

  /** Đợi kết nối sẵn sàng tối đa `timeoutMs`; trả về có sẵn sàng hay không. */
  public waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.isReady()) return Promise.resolve(true);
    return new Promise((resolve) => {
      /** Đánh dấu hoàn tất tiến trình hoặc giải phóng tài nguyên */
      const done = (ready: boolean) => {
        clearTimeout(timer);
        this.client.off('ready', onReady);
        resolve(ready);
      };
      /** Xử lý sự kiện khi kết nối dịch vụ đã sẵn sàng hoạt động */
      const onReady = () => done(true);
      const timer = setTimeout(() => done(this.isReady()), timeoutMs);
      this.client.once('ready', onReady);
    });
  }

  /** Lấy thông tin lỗi phát sinh gần nhất của dịch vụ */
  public getLastError(): string | null {
    return this.lastError;
  }

  /** Trả về danh sách client master (`[client]` với Standalone/Sentinel; toàn bộ master nodes với Cluster). */
  public getMasterClients(): Redis[] {
    if (!this.clusterClient) return [this.client];
    const fn = (this.clusterClient as unknown as { nodes?: (role?: string) => Redis[] }).nodes;
    if (typeof fn !== 'function') return [this.client];
    const masters = fn.call(this.clusterClient, 'master');
    return masters.length > 0 ? masters : [this.client];
  }

  /** Đăng ký listener nhận thông báo khi Redis failover hoặc đổi Primary. */
  public onFailover(listener: RedisFailoverListener): () => void {
    this.failoverListeners.add(listener);
    return () => {
      this.failoverListeners.delete(listener);
    };
  }

  /** Ảnh chụp trạng thái Redis HA (mode, endpoints, primary, failover/reconnect count, timeouts). */
  public getHaStatus(): RedisHaStatus {
    const clusterNodes = this.summarizeClusterNodes();
    const endpoints = resolveConfiguredEndpoints(this.redisConfig);
    return {
      mode: this.mode,
      state: this.client.status ?? 'unknown',
      ready: this.isReady(),
      endpoints,
      currentPrimary: this.resolveCurrentPrimary(),
      masterName: this.mode === 'sentinel' ? (this.redisConfig.sentinelMasterName ?? null) : null,
      reconnectCount: this.reconnectCount,
      failoverCount: this.failoverCount,
      lastFailoverAt: this.lastFailoverAt ? new Date(this.lastFailoverAt).toISOString() : null,
      lastSwitchReason: this.lastSwitchReason,
      lastError: this.lastError,
      timeouts: {
        connectTimeoutMs: this.redisConfig.connectTimeoutMs,
        commandTimeoutMs: this.redisConfig.commandTimeoutMs,
        maxRetriesPerRequest: this.redisConfig.maxRetriesPerRequest,
        retryBaseDelayMs: this.redisConfig.retryBaseDelayMs,
        retryMaxDelayMs: this.redisConfig.retryMaxDelayMs,
      },
      ...(clusterNodes ? { clusterNodes } : {}),
    };
  }

  /** Ghép key có prefix, vd. `key('runtime', 'hb', 'api')` → `core:runtime:hb:api`. */
  public key(...parts: string[]): string {
    return `${this.prefix}${parts.join(':')}`;
  }

  /** Prefix cho BullMQ (Cluster tự bọc hash tag `{...}` tránh lỗi `CROSSSLOT`). */
  public bullPrefix(): string {
    return formatBullPrefix(this.prefix, this.mode);
  }

  /** Options/client kết nối cho BullMQ (hỗ trợ Standalone, Sentinel và Cluster). */
  public bullConnection(): ConnectionOptions {
    if (this.mode === 'cluster') {
      const { nodes, options } = buildClusterClientOptions(
        this.redisConfig,
        `${this.clientName}-bull`,
        {
          enableOfflineQueue: true,
          enableReadyCheck: false,
          maxRetriesPerRequest: null,
          omitCommandTimeout: true,
        },
      );
      const bullCluster = this.clusterFactory(nodes, options);
      bullCluster.on('error', () => undefined);
      this.bullClusterClients.push(bullCluster);
      return bullCluster as unknown as ConnectionOptions;
    }
    return buildBullConnectionOptions(
      this.redisConfig,
      this.clientName,
    ) as unknown as ConnectionOptions;
  }

  /** Client riêng cho pub/sub (client đã SUBSCRIBE không chạy được lệnh thường). */
  public createSubscriber(): Redis {
    if (this.mode === 'cluster') {
      const { nodes, options } = buildClusterClientOptions(
        this.redisConfig,
        `${this.clientName}-sub`,
        { enableOfflineQueue: true, omitCommandTimeout: true },
      );
      const subCluster = this.clusterFactory(nodes, options);
      this.attachBasicLogging(subCluster as unknown as Redis);
      subCluster.connect().catch(() => undefined);
      const sub = subCluster as unknown as Redis;
      this.subscribers.push(sub);
      return sub;
    }
    const sub = this.createClient({ enableOfflineQueue: true, commandTimeout: undefined });
    this.subscribers.push(sub);
    return sub;
  }

  /** Đăng ký observer nhận độ trễ từng lệnh Redis (trả về hàm hủy đăng ký). */
  public registerLatencyObserver(observer: RedisLatencyObserver): () => void {
    this.latencyObservers.add(observer);
    return () => {
      this.latencyObservers.delete(observer);
    };
  }

  /** Đo RTT lệnh PING tới Redis (ms); trả về `null` nếu chưa sẵn sàng hoặc lỗi. */
  public async measurePingMs(): Promise<number | null> {
    if (!this.isReady()) return null;
    const started = performance.now();
    try {
      await this.client.ping();
      const ms = Math.round((performance.now() - started) * 100) / 100;
      this.lastPingMs = ms;
      return ms;
    } catch {
      return null;
    }
  }

  /** Ảnh chụp phân vị độ trễ lệnh Redis (p50/p95/p99, avg, lastPingMs) từ ring buffer. */
  public getLatencySnapshot(): RedisLatencySnapshot {
    const count = this.latencySamples.length;
    if (count === 0) {
      return {
        count: 0,
        avgMs: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        lastPingMs: this.lastPingMs,
      };
    }
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
      count,
      avgMs: Math.round((sum / count) * 100) / 100,
      p50Ms: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      p99Ms: quantile(sorted, 0.99),
      lastPingMs: this.lastPingMs,
    };
  }

  /** Đóng ở pha cuối để các provider khác còn ghi được sự kiện lúc shutdown. */
  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(
      [this.client, ...this.subscribers, ...this.bullClusterClients].map((c) => c.quit()),
    );
  }

  /** Ghi nhận mẫu độ trễ vào ring buffer và thông báo cho các observer. */
  private recordCommandLatency(operation: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
    for (const observer of this.latencyObservers) {
      try {
        observer(operation, durationMs);
      } catch {
        // Bỏ qua lỗi từ observer đo lường để không ảnh hưởng luồng Redis chính.
      }
    }
  }

  /** Bọc `sendCommand` của ioredis (nếu có) để đo độ trễ lệnh mà vẫn tương thích mock client trong test. */
  private instrumentClient(client: Redis): void {
    const rawSend = (client as unknown as { sendCommand?: (cmd: unknown) => unknown }).sendCommand;
    if (typeof rawSend !== 'function') return;

    (client as unknown as { sendCommand: (cmd: unknown) => unknown }).sendCommand = (
      command: unknown,
    ) => {
      const cmdObj = command as { name?: unknown; promise?: Promise<unknown> } | null;
      const started = performance.now();
      const op = normalizeRedisCommand(cmdObj?.name);
      const result = rawSend.call(client, command);
      const promise = cmdObj?.promise;
      if (promise && typeof promise.finally === 'function') {
        void promise
          .finally(() => {
            this.recordCommandLatency(op, performance.now() - started);
          })
          .catch(() => undefined);
      }
      return result;
    };
  }

  /** Theo dõi trạng thái cơ bản cho các client phụ (subscriber). */
  private attachBasicLogging(client: Redis): void {
    client.on('error', (err: Error) => {
      if (this.lastError !== err.message) {
        this.logger.warn(`Redis subscriber unavailable: ${err.message}`);
      }
      this.lastError = err.message;
    });
  }

  private resolveCurrentPrimary(): string | null {
    if (this.isCluster()) {
      const masters = this.getMasterClients();
      const firstReady = masters.find((m) => m.status === 'ready') ?? masters[0];
      return readClientPrimaryEndpoint(firstReady) ?? this.currentPrimary;
    }
    return this.currentPrimary ?? readClientPrimaryEndpoint(this.client);
  }

  private summarizeClusterNodes(): RedisClusterNodesSummary | undefined {
    if (!this.clusterClient) return undefined;
    const nodesFn = (this.clusterClient as unknown as { nodes?: (role?: string) => Redis[] }).nodes;
    if (typeof nodesFn !== 'function') return undefined;
    const allNodes = nodesFn.call(this.clusterClient, 'all');
    const masterNodes = nodesFn.call(this.clusterClient, 'master');
    const readyMasters = masterNodes.filter((n) => n.status === 'ready').length;
    return {
      total: allNodes.length,
      masters: masterNodes.length,
      readyMasters,
    };
  }

  private emitFailover(
    reason: string,
    previousPrimary: string | null,
    currentPrimary: string | null,
    countFailover: boolean,
  ): void {
    const now = Date.now();
    if (countFailover) {
      this.failoverCount++;
      this.lastFailoverAt = now;
    }
    this.lastSwitchReason = reason;
    const event: RedisFailoverEvent = {
      mode: this.mode,
      reason,
      previousPrimary,
      currentPrimary,
      at: now,
    };
    for (const listener of this.failoverListeners) {
      try {
        listener(event);
      } catch {
        // Không để lỗi listener ảnh hưởng kết nối Redis.
      }
    }
  }

  /** Khởi tạo client Standalone hoặc Sentinel và gắn event theo dõi HA. */
  private createClient(overrides: Partial<RedisOptions> = {}): Redis {
    const isPrimary = Object.keys(overrides).length === 0;
    const client = this.factory({ ...this.options, ...overrides });
    this.instrumentClient(client);

    client.on('ready', () => {
      if (this.lastError) this.logger.log('Redis connection restored');
      this.lastError = null;
      if (isPrimary) {
        const nextPrimary = readClientPrimaryEndpoint(client);
        const prevPrimary = this.currentPrimary;
        if (nextPrimary && prevPrimary && nextPrimary !== prevPrimary) {
          this.logger.warn(`Redis primary changed: ${prevPrimary} -> ${nextPrimary}`);
          this.currentPrimary = nextPrimary;
          this.emitFailover('primary_changed', prevPrimary, nextPrimary, true);
        } else if (nextPrimary) {
          this.currentPrimary = nextPrimary;
        }
      }
    });

    client.on('error', (err: Error) => {
      // Chỉ log khi lỗi đổi để tránh spam log mỗi lần retry.
      if (this.lastError !== err.message) {
        this.logger.warn(`Redis unavailable: ${err.message}`);
      }
      this.lastError = err.message;
    });

    if (isPrimary) {
      client.on('reconnecting', () => {
        this.reconnectCount++;
      });
      // Sự kiện của ioredis Sentinel khi master mới được bầu chọn.
      client.on('+switch-master', (...args: unknown[]) => {
        const prev = this.currentPrimary;
        const next =
          readClientPrimaryEndpoint(client) ?? (typeof args[0] === 'string' ? args[0] : prev);
        this.currentPrimary = next;
        this.logger.warn(
          `Redis Sentinel switched master: ${prev ?? 'unknown'} -> ${next ?? 'unknown'}`,
        );
        this.emitFailover('sentinel_switch_master', prev, next, true);
      });
    }

    client.connect().catch(() => undefined);
    return client;
  }

  /** Khởi tạo client Redis Cluster và gắn event theo dõi topology/node. */
  private createClusterClient(): Cluster {
    const { nodes, options } = buildClusterClientOptions(this.redisConfig, this.clientName);
    const cluster = this.clusterFactory(nodes, options);
    this.instrumentClient(cluster as unknown as Redis);

    cluster.on('ready', () => {
      if (this.lastError) this.logger.log('Redis Cluster connection restored');
      this.lastError = null;
      this.currentPrimary = this.resolveCurrentPrimary();
    });

    cluster.on('reconnecting', () => {
      this.reconnectCount++;
    });

    cluster.on('error', (err: Error) => {
      if (this.lastError !== err.message) {
        this.logger.warn(`Redis Cluster unavailable: ${err.message}`);
      }
      this.lastError = err.message;
    });

    cluster.on('node error', (err: Error, address?: string) => {
      const msg = address ? `${address}: ${err.message}` : err.message;
      if (this.lastError !== msg) {
        this.logger.warn(`Redis Cluster node error: ${msg}`);
      }
      this.lastError = msg;
    });

    cluster.on('-node', (node: Redis) => {
      const endpoint = readClientPrimaryEndpoint(node);
      this.logger.warn(`Redis Cluster node removed: ${endpoint ?? 'unknown'}`);
      this.emitFailover('cluster_node_removed', endpoint, this.resolveCurrentPrimary(), true);
    });

    cluster.on('+node', (node: Redis) => {
      const endpoint = readClientPrimaryEndpoint(node);
      this.logger.log(`Redis Cluster node added: ${endpoint ?? 'unknown'}`);
      this.emitFailover('cluster_node_added', this.currentPrimary, endpoint, false);
    });

    cluster.connect().catch(() => undefined);
    return cluster;
  }
}
