import { getHeapStatistics } from 'node:v8';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  defaultProviderRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { DatabaseConnectionService, DatabaseOperationsService } from '@packages/database/index.js';
import { MessagingConnectionService } from '@packages/messaging/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  RuntimeAgentService,
  evaluateStatelessReadiness,
} from '@packages/runtime/index.js';
import { PlatformSecurityService, type UserIdentity } from '@packages/security/index.js';
import { StorageConnectionService } from '@packages/storage/index.js';
import {
  HEALTH_INDICATOR_STATUS,
  HEALTH_STATUS,
  type HealthIndicatorStatusValue,
} from '../enum/health.enum.js';
import { resolveHealthConfig } from '../helpers/health-config.helper.js';
import {
  aggregateHealthStatus,
  hasAdminHealthAccess,
  redactHealthCheckResult,
  redactReadinessResult,
  toIndicatorSeverity,
} from '../helpers/health-probe.helper.js';
import type {
  DetailedHealthCheckResult,
  HealthCheckResult,
  HealthIndicatorDetail,
  HealthRuntimeConfig,
  LivenessCheckResult,
  PublicHealthCheckResult,
  ReadinessCheckResult,
} from '../types/health.types.js';
import { HealthProbesService } from './health-probes.service.js';

/** Health thật qua `@nestjs/terminus` kết hợp Liveness, Readiness, Redis/Queue, Storage, Email/SMS/Provider và Migration. */
@Injectable()
export class HealthService {
  private readonly probes: HealthProbesService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly redisRef?: RedisService;
  private readonly databaseRef?: DatabaseConnectionService;

  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
    @Inject(MemoryHealthIndicator) private readonly memory: MemoryHealthIndicator,
    @Inject(DatabaseConnectionService) database: DatabaseConnectionService,
    @Inject(RedisService) redis: RedisService,
    @Optional()
    @Inject(StorageConnectionService)
    storageConnection?: StorageConnectionService,
    @Optional()
    @Inject(HealthProbesService)
    probes?: HealthProbesService,
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistry?: SettingRegistryService,
    @Optional()
    @Inject(DatabaseOperationsService)
    databaseOperations?: DatabaseOperationsService,
    @Optional()
    @Inject(MessagingConnectionService)
    messagingConnection?: MessagingConnectionService,
    @Optional()
    @Inject(QueueMonitoringService)
    queueMonitoring?: QueueMonitoringService,
    @Optional()
    @Inject(RuntimeAgentService)
    runtimeAgent?: RuntimeAgentService,
    @Optional()
    @Inject(KernelProviderRegistryService)
    kernelProviderRegistry?: KernelProviderRegistryService,
    @Optional()
    @Inject(CoreConfigService)
    private readonly configService?: CoreConfigService,
    @Optional()
    @Inject(PlatformSecurityService)
    private readonly platformSecurity?: PlatformSecurityService,
  ) {
    this.redisRef = redis;
    this.databaseRef = database;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.probes =
      probes ??
      new HealthProbesService(
        database,
        databaseOperations,
        redis,
        messagingConnection,
        queueMonitoring,
        storageConnection,
        runtimeAgent,
        kernelProviderRegistry ?? defaultProviderRegistry,
      );
  }

  /** Xóa cache migration khi cần kiểm tra lại ngay lập tức. */
  public invalidateMigrationCache(): void {
    this.probes.invalidateMigrationCache();
  }

  /** Liveness Check: chỉ kiểm tra tiến trình còn sống (không chạm DB/Redis/Storage bên ngoài). */
  public async liveness(): Promise<LivenessCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const proc = await this.probes.checkProcess(cfg);
    return {
      status: proc.live ? HEALTH_STATUS.OK : HEALTH_STATUS.DOWN,
      live: proc.live,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: {
        process: proc.indicator,
      },
    };
  }

  /** Readiness Check: kiểm tra ứng dụng có thể nhận request (runtime + DB + Redis + Storage + tùy chọn Migration). */
  public async readiness(): Promise<ReadinessCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const [proc, database, redisAndQueue, storage, migration] = await Promise.all([
      this.probes.checkProcess(cfg),
      this.probes.checkDatabase(cfg),
      this.probes.checkRedisAndQueue(cfg),
      this.probes.checkStorage(cfg),
      this.probes.checkMigrations(cfg),
    ]);

    const migrationReadinessStatus: HealthIndicatorStatusValue =
      !migration.upToDate && cfg.failOnPendingMigration
        ? HEALTH_INDICATOR_STATUS.DOWN
        : migration.status;

    const checks: Record<string, HealthIndicatorDetail> = {
      process: proc.indicator,
      database,
      redis: redisAndQueue.redis,
      queue: redisAndQueue.queue,
      storage: storage.indicator,
      migration: {
        status: migrationReadinessStatus,
        severity: toIndicatorSeverity(migrationReadinessStatus),
        enabled: migration.enabled,
        upToDate: migration.upToDate,
        pending: migration.pending,
        tampered: migration.tampered,
        ...(migration.error ? { error: migration.error } : {}),
      },
    };

    const criticalReady =
      proc.ready &&
      database.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      redisAndQueue.redis.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      storage.indicator.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      migrationReadinessStatus !== HEALTH_INDICATOR_STATUS.DOWN;

    const overall = aggregateHealthStatus(Object.values(checks).map((c) => c.status));
    return {
      status: !criticalReady ? HEALTH_STATUS.DOWN : overall,
      ready: criticalReady,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /** Readiness API công khai/admin: tự động ẩn chi tiết nhạy cảm nếu caller không phải quản trị viên. */
  public async getPublicOrAdminReadiness(
    actor?: UserIdentity | null,
  ): Promise<ReadinessCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const full = await this.readiness();
    if (!cfg.hidePublicDetails || hasAdminHealthAccess(actor)) {
      return full;
    }
    return redactReadinessResult(full);
  }

  /** Kiểm tra tổng hợp sức khỏe hệ thống (giữ tương thích cho SystemOverviewService và unit test). */
  public async check(): Promise<HealthCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const [proc, database, redisAndQueue, storage, providers, migration, heapIndicator] =
      await Promise.all([
        this.probes.checkProcess(cfg),
        this.probes.checkDatabase(cfg),
        this.probes.checkRedisAndQueue(cfg),
        this.probes.checkStorage(cfg),
        this.probes.checkProviders(cfg),
        this.probes.checkMigrations(cfg),
        this.checkTerminusHeap(cfg),
      ]);

    const checks: Record<string, HealthIndicatorDetail> = {
      database,
      redis: redisAndQueue.redis,
      queue: {
        status: redisAndQueue.queue.status,
        severity: redisAndQueue.queue.severity,
        state: redisAndQueue.queue.state,
        queueCount: redisAndQueue.queue.queues.length,
        ...(redisAndQueue.queue.warnings ? { warnings: redisAndQueue.queue.warnings } : {}),
        ...(redisAndQueue.queue.error ? { error: redisAndQueue.queue.error } : {}),
      },
      storage: storage.indicator,
      providers: providers.indicator,
      migration: {
        status: migration.status,
        severity: toIndicatorSeverity(migration.status),
        enabled: migration.enabled,
        upToDate: migration.upToDate,
        applied: migration.applied,
        pending: migration.pending,
        tampered: migration.tampered,
        ...(migration.error ? { error: migration.error } : {}),
      },
      heap: heapIndicator,
    };

    const migrationBlocksReady = !migration.upToDate && cfg.failOnPendingMigration;
    const criticalReady =
      proc.ready &&
      database.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      redisAndQueue.redis.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      storage.indicator.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      !migrationBlocksReady;

    // Khi `database`, `redis`, `storage` hoặc `queue` bị `down` -> 'degraded' khi tương thích test cũ?
    // Lưu ý: giữ status 'degraded' khi một dependency down nhẹ/fallback hoặc trả 'down' khi critical?
    // Để tương thích ngược với caller cũ kiểm tra `result.status !== 'ok'` (và test cũ expect `'degraded'`),
    // chỉ trả 'down' nếu tiến trình không còn `live`, còn lại dùng 'degraded' khi có indicator down/degraded!
    const hasNonUp = Object.values(checks).some((c) => c.status !== HEALTH_INDICATOR_STATUS.UP);
    const status = !proc.live
      ? HEALTH_STATUS.DOWN
      : hasNonUp
        ? HEALTH_STATUS.DEGRADED
        : HEALTH_STATUS.OK;

    return {
      status,
      ready: criticalReady,
      live: proc.live,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /** Health API cho endpoint `/health`: ẩn chi tiết nếu caller không có quyền quản trị. */
  public async getPublicOrAdminHealth(
    actor?: UserIdentity | null,
  ): Promise<HealthCheckResult | PublicHealthCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const full = await this.check();
    if (!cfg.hidePublicDetails || hasAdminHealthAccess(actor)) {
      return full;
    }
    return redactHealthCheckResult(full);
  }

  /** Báo cáo sức khỏe chi tiết đầy đủ dành riêng cho quản trị viên / System Console. */
  public async getDetailedHealth(): Promise<DetailedHealthCheckResult> {
    const cfg = resolveHealthConfig(this.settingRegistry);
    const [proc, database, redisAndQueue, storage, providers, migration, heapIndicator] =
      await Promise.all([
        this.probes.checkProcess(cfg),
        this.probes.checkDatabase(cfg),
        this.probes.checkRedisAndQueue(cfg),
        this.probes.checkStorage(cfg),
        this.probes.checkProviders(cfg),
        this.probes.checkMigrations(cfg),
        this.checkTerminusHeap(cfg),
      ]);

    const checks: Record<string, HealthIndicatorDetail> = {
      process: proc.indicator,
      database,
      redis: redisAndQueue.redis,
      queue: redisAndQueue.queue,
      storage: storage.indicator,
      providers: providers.indicator,
      migration: {
        status: migration.status,
        severity: toIndicatorSeverity(migration.status),
        enabled: migration.enabled,
        upToDate: migration.upToDate,
        total: migration.total,
        applied: migration.applied,
        pending: migration.pending,
        tampered: migration.tampered,
        ...(migration.error ? { error: migration.error } : {}),
      },
      heap: heapIndicator,
    };

    const migrationBlocksReady = !migration.upToDate && cfg.failOnPendingMigration;
    const criticalReady =
      proc.ready &&
      database.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      redisAndQueue.redis.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      storage.indicator.status !== HEALTH_INDICATOR_STATUS.DOWN &&
      !migrationBlocksReady;

    const warnings: string[] = [];
    const criticalErrors: string[] = [];

    for (const [name, detail] of Object.entries(checks)) {
      if (detail.status === HEALTH_INDICATOR_STATUS.DOWN) {
        criticalErrors.push(`${name}: ${detail.error ?? detail.state ?? 'down'}`);
      } else if (detail.status === HEALTH_INDICATOR_STATUS.DEGRADED) {
        const msg = detail.warnings?.join('; ') ?? detail.error ?? `${name} degraded`;
        warnings.push(`${name}: ${msg}`);
      }
    }

    if (!migration.upToDate && migration.enabled) {
      if (migration.pending > 0) {
        warnings.push(`migration: ${migration.pending} pending migration(s)`);
      }
      if (migration.tampered > 0) {
        warnings.push(`migration: ${migration.tampered} integrity mismatch(es)`);
      }
    }

    const aggregated = aggregateHealthStatus(Object.values(checks).map((c) => c.status));
    const status = !criticalReady ? HEALTH_STATUS.DOWN : aggregated;

    return {
      status,
      live: proc.live,
      ready: criticalReady,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      runtimeState: proc.runtimeState,
      warnings,
      criticalErrors,
      checks,
      dependencies: {
        process: {
          status: proc.indicator.status,
          runtimeState: proc.runtimeState,
          draining: proc.draining,
          inFlightRequests: proc.inFlightRequests,
          eventLoopLagMs: proc.eventLoopLagMs,
          heapUsedMb: proc.heapUsedMb,
          heapLimitMb: proc.heapLimitMb,
          heapRatio: proc.heapRatio,
          rssMb: proc.rssMb,
        },
        database,
        redis: redisAndQueue.redis,
        queue: redisAndQueue.queue,
        storage: storage.indicator,
        migration,
        providers: {
          status: providers.indicator.status,
          email: providers.email,
          sms: providers.sms,
          byType: providers.byType,
        },
      },
      stateless: evaluateStatelessReadiness({
        environment: this.configService?.app.env ?? 'development',
        instanceId: this.configService?.app.instanceId ?? `${process.pid}`,
        runtimeState: proc.runtimeState,
        draining: proc.draining,
        inFlightRequests: proc.inFlightRequests,
        storageDriver:
          this.configService?.storage.driver ??
          (storage.indicator.driver === 's3' ? 's3' : 'local'),
        allowLocalStorageInProd: this.configService?.storage.allowLocalInProduction ?? false,
        cacheDriver: this.configService?.cache.driver ?? 'redis',
        allowMemoryCacheInProd: this.configService?.cache.allowMemoryInProduction ?? false,
        redisReady:
          typeof this.redisRef?.isReady === 'function'
            ? this.redisRef.isReady()
            : redisAndQueue.redis.status !== HEALTH_INDICATOR_STATUS.DOWN,
        databaseEnabled:
          this.configService?.database.enabled ??
          (this.databaseRef?.getStatus?.().state ?? 'connected') !== 'disabled',
        distributedRateLimitReady:
          typeof this.platformSecurity?.isDistributedStoreReady === 'function'
            ? this.platformSecurity.isDistributedStoreReady()
            : redisAndQueue.redis.status !== HEALTH_INDICATOR_STATUS.DOWN,
        drainDelayMs: this.configService?.runtime.drainDelayMs ?? 0,
        gracefulTimeoutMs: this.configService?.runtime.gracefulTimeoutMs ?? 30_000,
      }),
      settings: cfg,
    };
  }

  /** Kiểm tra V8 Heap qua `@nestjs/terminus` `MemoryHealthIndicator`. */
  private async checkTerminusHeap(cfg: HealthRuntimeConfig): Promise<HealthIndicatorDetail> {
    const limitBytes = getHeapStatistics().heap_size_limit * cfg.heapLimitRatio;
    const res = await this.health
      .check([() => this.memory.checkHeap('heap', limitBytes)])
      .catch((err: unknown) => {
        const body = (err as { getResponse?: () => unknown }).getResponse?.();
        if (body && typeof body === 'object' && 'details' in body) {
          return body as { details: Record<string, HealthIndicatorResult[string]> };
        }
        return null;
      });

    const heapDetail = res?.details?.['heap'];
    if (!heapDetail) {
      const i = this.indicator.check('heap').down({ error: 'Heap check unavailable' });
      const raw = i['heap'];
      return {
        ...(raw ?? {}),
        status: HEALTH_INDICATOR_STATUS.DOWN,
        severity: 'critical',
      };
    }

    const status =
      heapDetail.status === 'up' ? HEALTH_INDICATOR_STATUS.UP : HEALTH_INDICATOR_STATUS.DOWN;
    return {
      ...heapDetail,
      status,
      severity: toIndicatorSeverity(status),
    };
  }
}
