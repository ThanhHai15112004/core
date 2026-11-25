import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_STATUS,
  ProviderRegistryService as KernelProviderRegistryService,
  type ProviderTypeName,
  type RegisteredProviderSnapshot,
  defaultProviderRegistry,
  getProviderHealthStatusName,
  getProviderStatusName,
} from '@packages/kernel/index.js';
import { DatabaseConnectionService, DatabaseOperationsService } from '@packages/database/index.js';
import { MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RuntimeAgentService } from '@packages/runtime/index.js';
import { StorageConnectionService } from '@packages/storage/index.js';
import { HEALTH_INDICATOR_STATUS, type HealthIndicatorStatusValue } from '../enum/health.enum.js';
import {
  measureEventLoopLagMs,
  sanitizeHealthError,
  toIndicatorSeverity,
  withHealthTimeout,
} from '../helpers/health-probe.helper.js';
import type {
  HealthIndicatorDetail,
  HealthRuntimeConfig,
  MigrationHealthSummary,
  ProviderChannelHealthSummary,
  ProviderEntryHealthSummary,
  QueueHealthItemSummary,
} from '../types/health.types.js';

const BYTES_PER_MB = 1024 * 1024;

export interface ProcessProbeResult {
  readonly indicator: HealthIndicatorDetail;
  readonly live: boolean;
  readonly runtimeState: string;
  readonly eventLoopLagMs: number;
  readonly heapUsedMb: number;
  readonly heapLimitMb: number;
  readonly heapRatio: number;
  readonly rssMb: number;
}

export interface RedisAndQueueProbeResult {
  readonly redis: HealthIndicatorDetail;
  readonly queue: HealthIndicatorDetail & { readonly queues: readonly QueueHealthItemSummary[] };
}

export interface StorageProbeResult {
  readonly indicator: HealthIndicatorDetail & {
    readonly driver: string;
    readonly writeProbeEnabled: boolean;
  };
}

export interface ProvidersProbeResult {
  readonly indicator: HealthIndicatorDetail;
  readonly email: ProviderChannelHealthSummary;
  readonly sms: ProviderChannelHealthSummary;
  readonly byType: Record<ProviderTypeName, ProviderChannelHealthSummary>;
}

@Injectable()
export class HealthProbesService {
  private migrationCache: { expiresAtMs: number; summary: MigrationHealthSummary } | null = null;
  private readonly kernelProviders: KernelProviderRegistryService;

  constructor(
    @Optional()
    @Inject(DatabaseConnectionService)
    private readonly database?: DatabaseConnectionService,
    @Optional()
    @Inject(DatabaseOperationsService)
    private readonly databaseOperations?: DatabaseOperationsService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
    @Optional()
    @Inject(MessagingConnectionService)
    private readonly messagingConnection?: MessagingConnectionService,
    @Optional()
    @Inject(QueueMonitoringService)
    private readonly queueMonitoring?: QueueMonitoringService,
    @Optional()
    @Inject(StorageConnectionService)
    private readonly storageConnection?: StorageConnectionService,
    @Optional()
    @Inject(RuntimeAgentService)
    private readonly runtimeAgent?: RuntimeAgentService,
    @Optional()
    @Inject(KernelProviderRegistryService)
    kernelProviderRegistry?: KernelProviderRegistryService,
  ) {
    this.kernelProviders = kernelProviderRegistry ?? defaultProviderRegistry;
  }

  /** Xóa cache kiểm tra migration (hữu ích sau khi vừa chạy migration hoặc trong unit test). */
  public invalidateMigrationCache(): void {
    this.migrationCache = null;
  }

  /** Kiểm tra sức sống tiến trình Node.js: trạng thái shutdown, Event Loop Lag và V8 Heap/RSS. */
  public async checkProcess(cfg: HealthRuntimeConfig): Promise<ProcessProbeResult> {
    const eventLoopLagMs = await measureEventLoopLagMs();
    const mem = process.memoryUsage();
    const heapLimit = Math.max(1, getHeapStatistics().heap_size_limit);
    const heapRatio = Math.round((mem.heapUsed / heapLimit) * 10000) / 10000;
    const heapUsedMb = Math.round((mem.heapUsed / BYTES_PER_MB) * 10) / 10;
    const heapLimitMb = Math.round((heapLimit / BYTES_PER_MB) * 10) / 10;
    const rssMb = Math.round((mem.rss / BYTES_PER_MB) * 10) / 10;
    const runtimeState =
      typeof this.runtimeAgent?.getState === 'function' ? this.runtimeAgent.getState() : 'running';
    const shuttingDown =
      typeof this.runtimeAgent?.isShuttingDown === 'function'
        ? this.runtimeAgent.isShuttingDown()
        : runtimeState === 'stopping';

    const heapExceeded = heapRatio >= cfg.heapLimitRatio;
    const live = !shuttingDown && !heapExceeded;
    const warnings: string[] = [];
    if (shuttingDown) warnings.push('Runtime is shutting down');
    if (heapExceeded)
      warnings.push(`V8 heap usage (${Math.round(heapRatio * 100)}%) reached limit`);
    if (eventLoopLagMs >= cfg.eventLoopLagWarnMs) {
      warnings.push(`Event loop lag (${eventLoopLagMs}ms) exceeded ${cfg.eventLoopLagWarnMs}ms`);
    }

    const status: HealthIndicatorStatusValue = !live
      ? HEALTH_INDICATOR_STATUS.DOWN
      : eventLoopLagMs >= cfg.eventLoopLagWarnMs
        ? HEALTH_INDICATOR_STATUS.DEGRADED
        : HEALTH_INDICATOR_STATUS.UP;

    return {
      indicator: {
        status,
        severity: toIndicatorSeverity(status),
        state: runtimeState,
        eventLoopLagMs,
        heapUsedMb,
        heapLimitMb,
        heapRatio,
        rssMb,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      live,
      runtimeState,
      eventLoopLagMs,
      heapUsedMb,
      heapLimitMb,
      heapRatio,
      rssMb,
    };
  }

  /** Kiểm tra Database với timeout cấu hình rõ ràng (`cfg.dbTimeoutMs`). */
  public async checkDatabase(cfg: HealthRuntimeConfig): Promise<HealthIndicatorDetail> {
    if (!this.database) {
      return {
        status: HEALTH_INDICATOR_STATUS.UP,
        severity: 'ok',
        state: 'disabled',
        timeoutMs: cfg.dbTimeoutMs,
      };
    }

    const state = this.database.getStatus().state;
    if (state === 'disabled') {
      return {
        status: HEALTH_INDICATOR_STATUS.UP,
        severity: 'ok',
        state,
        timeoutMs: cfg.dbTimeoutMs,
      };
    }

    try {
      const ping = await withHealthTimeout(this.database.ping(), cfg.dbTimeoutMs, 'database');
      if (ping.ok) {
        const status: HealthIndicatorStatusValue =
          state === 'reconnecting' ? HEALTH_INDICATOR_STATUS.DEGRADED : HEALTH_INDICATOR_STATUS.UP;
        return {
          status,
          severity: toIndicatorSeverity(status),
          state,
          latencyMs: ping.latencyMs,
          timeoutMs: cfg.dbTimeoutMs,
          ...(status === HEALTH_INDICATOR_STATUS.DEGRADED
            ? { warnings: ['Database connection is recovering (reconnecting)'] }
            : {}),
        };
      }
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
        state,
        latencyMs: ping.latencyMs,
        timeoutMs: cfg.dbTimeoutMs,
        error: sanitizeHealthError(ping.error?.message ?? state),
      };
    } catch (err) {
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
        state,
        timeoutMs: cfg.dbTimeoutMs,
        error: sanitizeHealthError(err),
      };
    }
  }

  /** Kiểm tra Redis và Queue, phân biệt rõ lỗi nghiêm trọng (`down`) và suy giảm (`degraded`). */
  public async checkRedisAndQueue(cfg: HealthRuntimeConfig): Promise<RedisAndQueueProbeResult> {
    const redis = await this.checkRedis(cfg);
    const queue = await this.checkQueue(cfg, redis.status);
    return { redis, queue };
  }

  private async checkRedis(cfg: HealthRuntimeConfig): Promise<HealthIndicatorDetail> {
    if (!this.redis) {
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
        state: 'unavailable',
        timeoutMs: cfg.redisTimeoutMs,
        error: 'RedisService is not available',
      };
    }

    const isReady = typeof this.redis.isReady === 'function' ? this.redis.isReady() : true;
    const started = performance.now();
    try {
      await withHealthTimeout(this.redis.client.ping(), cfg.redisTimeoutMs, 'redis');
      const latencyMs = Math.round((performance.now() - started) * 10) / 10;
      const snap =
        typeof this.redis.getLatencySnapshot === 'function'
          ? this.redis.getLatencySnapshot()
          : null;
      const warnings: string[] = [];

      if (!isReady) {
        warnings.push('Redis client reported non-ready state despite ping response');
      }
      if (latencyMs >= cfg.redisDegradedLatencyMs) {
        warnings.push(
          `Redis PING latency (${latencyMs}ms) exceeded degraded threshold (${cfg.redisDegradedLatencyMs}ms)`,
        );
      }

      const status: HealthIndicatorStatusValue =
        warnings.length > 0 ? HEALTH_INDICATOR_STATUS.DEGRADED : HEALTH_INDICATOR_STATUS.UP;

      return {
        status,
        severity: toIndicatorSeverity(status),
        state: isReady ? 'connected' : 'reconnecting',
        latencyMs,
        timeoutMs: cfg.redisTimeoutMs,
        ...(snap?.p95Ms !== null && snap?.p95Ms !== undefined ? { p95Ms: snap.p95Ms } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (err) {
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
        state: isReady ? 'error' : 'disconnected',
        timeoutMs: cfg.redisTimeoutMs,
        error: sanitizeHealthError(err),
      };
    }
  }

  private async checkQueue(
    cfg: HealthRuntimeConfig,
    redisStatus: HealthIndicatorStatusValue,
  ): Promise<RedisAndQueueProbeResult['queue']> {
    if (!this.messagingConnection && !this.queueMonitoring) {
      return {
        status: HEALTH_INDICATOR_STATUS.UP,
        severity: 'ok',
        state: 'not_monitored',
        queues: [],
      };
    }

    const msgStatus = this.messagingConnection?.getStatus() ?? this.queueMonitoring?.status();
    const state = msgStatus?.state ?? 'unknown';

    if (redisStatus === HEALTH_INDICATOR_STATUS.DOWN || state === 'unavailable') {
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
        state: state === 'unknown' ? 'unavailable' : state,
        latencyMs: msgStatus?.lastPingMs ?? null,
        error: sanitizeHealthError(
          msgStatus?.lastError ?? 'Queue broker (Redis/BullMQ) is unavailable',
        ),
        queues: [],
      };
    }

    const warnings: string[] = [];
    if (state === 'reconnecting' || state === 'connecting') {
      warnings.push(`Queue broker connection is ${state}`);
    }
    if (redisStatus === HEALTH_INDICATOR_STATUS.DEGRADED) {
      warnings.push('Underlying Redis connection is degraded');
    }

    let queueItems: QueueHealthItemSummary[] = [];
    if (this.queueMonitoring?.usable()) {
      try {
        const list = await withHealthTimeout(
          this.queueMonitoring.queues(),
          cfg.redisTimeoutMs,
          'queue',
        );
        queueItems = list.map((q) => ({
          name: q.name,
          waiting: q.counts.waiting + (q.counts.prioritized ?? 0),
          active: q.counts.active,
          delayed: q.counts.delayed,
          failed: q.counts.failed,
          paused: q.paused,
          workers: q.workers?.length ?? 0,
        }));

        const totalWaiting = queueItems.reduce((s, q) => s + q.waiting, 0);
        const totalDelayed = queueItems.reduce((s, q) => s + q.delayed, 0);
        const totalFailed = queueItems.reduce((s, q) => s + q.failed, 0);
        const totalWorkers = queueItems.reduce((s, q) => s + q.workers, 0);
        const pausedQueues = queueItems.filter((q) => q.paused).map((q) => q.name);

        if (pausedQueues.length > 0) {
          warnings.push(`Paused queue(s): ${pausedQueues.join(', ')}`);
        }
        if (totalWaiting + totalDelayed >= cfg.queueBacklogWarnThreshold) {
          warnings.push(
            `Queue backlog (${totalWaiting + totalDelayed}) reached warning threshold (${cfg.queueBacklogWarnThreshold})`,
          );
        }
        if (totalFailed >= cfg.queueFailedWarnThreshold) {
          warnings.push(
            `Queue failed jobs (${totalFailed}) reached warning threshold (${cfg.queueFailedWarnThreshold})`,
          );
        }
        if (cfg.queueRequireActiveWorkers && totalWaiting > 0 && totalWorkers === 0) {
          warnings.push(`Queue has ${totalWaiting} waiting job(s) with 0 active workers`);
        }
      } catch (err) {
        warnings.push(`Queue metrics inspection degraded: ${sanitizeHealthError(err)}`);
      }
    }

    const status: HealthIndicatorStatusValue =
      warnings.length > 0 ? HEALTH_INDICATOR_STATUS.DEGRADED : HEALTH_INDICATOR_STATUS.UP;

    return {
      status,
      severity: toIndicatorSeverity(status),
      state,
      latencyMs: msgStatus?.lastPingMs ?? null,
      queueCount: queueItems.length,
      totalWaiting: queueItems.reduce((s, q) => s + q.waiting, 0),
      totalFailed: queueItems.reduce((s, q) => s + q.failed, 0),
      totalWorkers: queueItems.reduce((s, q) => s + q.workers, 0),
      ...(warnings.length > 0 ? { warnings } : {}),
      queues: queueItems,
    };
  }

  /** Kiểm tra Storage (ping nhanh hoặc write/read/delete probe thật theo setting). */
  public async checkStorage(cfg: HealthRuntimeConfig): Promise<StorageProbeResult> {
    if (!this.storageConnection) {
      return {
        indicator: {
          status: HEALTH_INDICATOR_STATUS.UP,
          severity: 'ok',
          state: 'disabled',
          driver: 'none',
          writeProbeEnabled: cfg.storageWriteProbeEnabled,
          timeoutMs: cfg.storageTimeoutMs,
        },
      };
    }

    const driver =
      typeof this.storageConnection.getDriverName === 'function'
        ? this.storageConnection.getDriverName()
        : 'local';

    try {
      const status = await withHealthTimeout(
        this.storageConnection.check({ writeProbe: cfg.storageWriteProbeEnabled }),
        cfg.storageTimeoutMs,
        'storage',
      );

      if (status.state === 'connected') {
        return {
          indicator: {
            status: HEALTH_INDICATOR_STATUS.UP,
            severity: 'ok',
            state: status.state,
            driver,
            writeProbeEnabled: cfg.storageWriteProbeEnabled,
            latencyMs: status.lastPingMs,
            timeoutMs: cfg.storageTimeoutMs,
          },
        };
      }

      if (status.state === 'reconnecting') {
        return {
          indicator: {
            status: HEALTH_INDICATOR_STATUS.DEGRADED,
            severity: 'degraded',
            state: status.state,
            driver,
            writeProbeEnabled: cfg.storageWriteProbeEnabled,
            latencyMs: status.lastPingMs,
            timeoutMs: cfg.storageTimeoutMs,
            error: status.lastError ? sanitizeHealthError(status.lastError) : null,
            warnings: ['Storage connection is reconnecting'],
          },
        };
      }

      return {
        indicator: {
          status: HEALTH_INDICATOR_STATUS.DOWN,
          severity: 'critical',
          state: status.state,
          driver,
          writeProbeEnabled: cfg.storageWriteProbeEnabled,
          timeoutMs: cfg.storageTimeoutMs,
          error: sanitizeHealthError(status.lastError ?? status.state),
        },
      };
    } catch (err) {
      return {
        indicator: {
          status: HEALTH_INDICATOR_STATUS.DOWN,
          severity: 'critical',
          state: 'unavailable',
          driver,
          writeProbeEnabled: cfg.storageWriteProbeEnabled,
          timeoutMs: cfg.storageTimeoutMs,
          error: sanitizeHealthError(err),
        },
      };
    }
  }

  /** Kiểm tra trạng thái Email, SMS và các Provider phụ thuộc từ Kernel L1 Provider Registry. */
  public async checkProviders(cfg: HealthRuntimeConfig): Promise<ProvidersProbeResult> {
    const byType = {} as Record<ProviderTypeName, ProviderChannelHealthSummary>;

    for (const providerType of ALL_PROVIDER_TYPES) {
      byType[providerType] = await this.inspectProviderType(providerType, cfg);
    }

    const channelStatuses = ALL_PROVIDER_TYPES.map((t) => byType[t].status);
    const hasProblem = channelStatuses.some((s) => s !== HEALTH_INDICATOR_STATUS.UP);
    const overallStatus: HealthIndicatorStatusValue = hasProblem
      ? HEALTH_INDICATOR_STATUS.DEGRADED
      : HEALTH_INDICATOR_STATUS.UP;

    const degradedChannels = ALL_PROVIDER_TYPES.filter(
      (t) => byType[t].status !== HEALTH_INDICATOR_STATUS.UP,
    );

    return {
      indicator: {
        status: overallStatus,
        severity: toIndicatorSeverity(overallStatus),
        timeoutMs: cfg.providersTimeoutMs,
        activeProbeEnabled: cfg.providersActiveProbeEnabled,
        emailStatus: byType.EMAIL.status,
        smsStatus: byType.SMS.status,
        ...(degradedChannels.length > 0
          ? { warnings: [`Provider dependency degraded: ${degradedChannels.join(', ')}`] }
          : {}),
      },
      email: byType.EMAIL,
      sms: byType.SMS,
      byType,
    };
  }

  private async inspectProviderType(
    providerType: ProviderTypeName,
    cfg: HealthRuntimeConfig,
  ): Promise<ProviderChannelHealthSummary> {
    const entries = this.kernelProviders.listProviders(providerType);
    const summaries: ProviderEntryHealthSummary[] = [];

    for (const entry of entries) {
      const summary = await this.inspectSingleProviderEntry(entry, cfg);
      summaries.push(summary);
    }

    const resolved = this.kernelProviders.resolveProvider({ providerType });
    const fallbackAvailable = entries.some(
      (e) =>
        !e.isPrimary &&
        e.status === PROVIDER_STATUS.ACTIVE &&
        e.healthStatus !== PROVIDER_HEALTH_STATUS.DOWN &&
        (e.fallbackAllowed || e.role === 'FALLBACK'),
    );

    const activeCount = entries.filter((e) => e.status === PROVIDER_STATUS.ACTIVE).length;
    const healthyCount = summaries.filter((s) => s.healthStatus === 'HEALTHY').length;
    const degradedCount = summaries.filter((s) => s.healthStatus === 'DEGRADED').length;
    const downCount = summaries.filter((s) => s.healthStatus === 'DOWN').length;

    let adapterReady: boolean | null = null;
    if (entries.length === 0) {
      const fallbackProbe = this.kernelProviders.resolveHealthProbe(providerType, '*', 'default');
      if (fallbackProbe) {
        try {
          const probeRes = await withHealthTimeout(
            fallbackProbe({
              providerId: 0,
              providerCode: 'default',
              providerType,
              driverCode: 'default',
              domainRefCode: null,
              secretRef: null,
              config: {},
              timeoutMs: cfg.providersTimeoutMs,
            }),
            cfg.providersTimeoutMs,
            `provider:${providerType}`,
          );
          adapterReady = probeRes.status === 'HEALTHY';
        } catch {
          adapterReady = false;
        }
      }
    }

    let status: HealthIndicatorStatusValue = HEALTH_INDICATOR_STATUS.UP;
    if (entries.length === 0) {
      status =
        adapterReady === false ? HEALTH_INDICATOR_STATUS.DEGRADED : HEALTH_INDICATOR_STATUS.UP;
    } else if (!resolved.resolved) {
      status = HEALTH_INDICATOR_STATUS.DOWN;
    } else if (
      resolved.usedFallback ||
      degradedCount > 0 ||
      downCount > 0 ||
      resolved.provider?.healthStatus === PROVIDER_HEALTH_STATUS.DEGRADED
    ) {
      status = HEALTH_INDICATOR_STATUS.DEGRADED;
    }

    return {
      providerType,
      status,
      configured: entries.length > 0,
      total: entries.length,
      activeCount,
      healthyCount,
      degradedCount,
      downCount,
      fallbackAvailable,
      resolvedProviderCode: resolved.provider?.providerCode ?? null,
      resolutionReason: entries.length > 0 ? resolved.reason : null,
      adapterReady,
      providers: summaries,
    };
  }

  private async inspectSingleProviderEntry(
    entry: RegisteredProviderSnapshot,
    cfg: HealthRuntimeConfig,
  ): Promise<ProviderEntryHealthSummary> {
    let healthStatus = entry.healthStatusName;
    let latencyMs = entry.lastHealthLatencyMs;
    let errorCode = entry.lastHealthErrorCode;
    let lastCheckedAt = entry.lastHealthCheckAt;

    if (cfg.providersActiveProbeEnabled && entry.status !== PROVIDER_STATUS.DISABLED) {
      const probe = this.kernelProviders.resolveHealthProbe(
        entry.providerType,
        entry.providerCode,
        entry.driverCode,
      );
      if (probe) {
        try {
          const res = await withHealthTimeout(
            probe({
              providerId: entry.id,
              providerCode: entry.providerCode,
              providerType: entry.providerType,
              driverCode: entry.driverCode,
              domainRefCode: entry.domainRefCode,
              secretRef: entry.secretRef,
              config: {},
              timeoutMs: cfg.providersTimeoutMs,
            }),
            cfg.providersTimeoutMs,
            `provider:${entry.providerCode}`,
          );
          healthStatus = res.status;
          latencyMs = res.latencyMs;
          errorCode = res.errorCode ?? null;
          lastCheckedAt = new Date().toISOString();
        } catch {
          healthStatus = 'DOWN';
          errorCode = 'PROBE_TIMEOUT_OR_ERROR';
          lastCheckedAt = new Date().toISOString();
        }
      }
    }

    return {
      providerCode: entry.providerCode,
      providerType: entry.providerType,
      driverCode: entry.driverCode,
      displayName: entry.displayName,
      isPrimary: entry.isPrimary,
      operationalStatus: entry.statusName ?? getProviderStatusName(entry.status),
      healthStatus: healthStatus ?? getProviderHealthStatusName(entry.healthStatus),
      latencyMs,
      errorCode,
      lastCheckedAt,
    };
  }

  /** Kiểm tra trạng thái phiên bản Migration của Database (có cache TTL ngắn). */
  public async checkMigrations(cfg: HealthRuntimeConfig): Promise<MigrationHealthSummary> {
    if (!cfg.migrationCheckEnabled || !this.databaseOperations) {
      return {
        status: HEALTH_INDICATOR_STATUS.UP,
        enabled: false,
        upToDate: true,
        total: 0,
        applied: 0,
        pending: 0,
        tampered: 0,
        pendingNames: [],
        tamperedNames: [],
        lastRunAt: null,
        lastRunStatus: null,
        cached: false,
      };
    }

    const dbState = this.database?.getStatus().state ?? 'disabled';
    if (dbState === 'disabled') {
      return {
        status: HEALTH_INDICATOR_STATUS.UP,
        enabled: false,
        upToDate: true,
        total: 0,
        applied: 0,
        pending: 0,
        tampered: 0,
        pendingNames: [],
        tamperedNames: [],
        lastRunAt: null,
        lastRunStatus: null,
        cached: false,
      };
    }

    const now = Date.now();
    if (
      cfg.migrationCacheTtlSec > 0 &&
      this.migrationCache &&
      now < this.migrationCache.expiresAtMs
    ) {
      return { ...this.migrationCache.summary, cached: true };
    }

    try {
      const { items, lastRun } = await withHealthTimeout(
        this.databaseOperations.migrations(),
        cfg.dbTimeoutMs,
        'migration',
      );
      const pendingItems = items.filter((m) => m.status === 'pending');
      const tamperedItems = items.filter(
        (m) => m.status === 'applied' && m.integrity && m.integrity !== 'ok',
      );
      const appliedCount = items.filter((m) => m.status === 'applied').length;
      const upToDate = pendingItems.length === 0 && tamperedItems.length === 0;
      const status: HealthIndicatorStatusValue = upToDate
        ? HEALTH_INDICATOR_STATUS.UP
        : HEALTH_INDICATOR_STATUS.DEGRADED;

      const summary: MigrationHealthSummary = {
        status,
        enabled: true,
        upToDate,
        total: items.length,
        applied: appliedCount,
        pending: pendingItems.length,
        tampered: tamperedItems.length,
        pendingNames: pendingItems.map((m) => m.name),
        tamperedNames: tamperedItems.map((m) => `${m.name} (${m.integrity})`),
        lastRunAt: lastRun?.at ?? null,
        lastRunStatus: lastRun?.status ?? null,
        cached: false,
      };

      if (cfg.migrationCacheTtlSec > 0) {
        this.migrationCache = {
          expiresAtMs: now + cfg.migrationCacheTtlSec * 1000,
          summary,
        };
      }
      return summary;
    } catch (err) {
      return {
        status: HEALTH_INDICATOR_STATUS.DOWN,
        enabled: true,
        upToDate: false,
        total: 0,
        applied: 0,
        pending: 0,
        tampered: 0,
        pendingNames: [],
        tamperedNames: [],
        lastRunAt: null,
        lastRunStatus: null,
        cached: false,
        error: sanitizeHealthError(err),
      };
    }
  }
}
