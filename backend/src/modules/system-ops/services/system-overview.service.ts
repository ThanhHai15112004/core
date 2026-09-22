import { Injectable } from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseAction } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { HttpMetricsService, type HttpMetricsSnapshot } from '@packages/logging/index.js';
import { CorePackageId, PackageStatus } from '@packages/kernel/index.js';
import { PackageRegistryService, type PackageSummaryDto } from './package-registry.service.js';
import type {
  SystemOverviewResponseDto,
  HealthMapItemDto,
  ActiveIncidentItemDto,
  InfraSnapshotItemDto,
  RecentActivityEventDto,
  KeyMetricItemDto,
  OverallHealthReportDto,
} from '../responses/overview.response.js';

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = BYTES_PER_MB * 1024;
const CPU_WARN_PERCENT = 80;
const MEMORY_WARN_PERCENT = 85;
const UNAVAILABLE = '--';

/** Số đo của process/OS tại thời điểm gọi API. */
interface RuntimeSnapshot {
  uptimeSeconds: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  totalMemGb: number;
  usedMemGb: number;
  freeMemGb: number;
  memoryPercent: number;
  cpuCores: number;
  cpuPercent: number;
  loadAvg: number[];
}

interface OverviewContext {
  runtime: RuntimeSnapshot;
  http: HttpMetricsSnapshot;
  packages: PackageSummaryDto[];
  /** `null` = không ping được hoặc không có package database. */
  dbPingMs: number | null;
}

@Injectable()
export class SystemOverviewService {
  constructor(
    private readonly configService: CoreConfigService,
    private readonly registryService: PackageRegistryService,
    private readonly httpMetrics: HttpMetricsService,
    private readonly i18n: CoreI18nService,
  ) {}

  public async getOverview(): Promise<SystemOverviewResponseDto> {
    const [packages, dbPingMs] = await Promise.all([
      this.registryService.getAllSummaries(),
      this.pingDatabase(),
    ]);
    const ctx: OverviewContext = {
      runtime: this.readRuntime(),
      http: this.httpMetrics.snapshot(),
      packages,
      dbPingMs,
    };

    return {
      environment: this.environment,
      timestamp: new Date().toISOString(),
      overallHealth: this.buildOverallHealth(ctx),
      keyMetrics: this.buildKeyMetrics(ctx),
      healthMap: this.buildHealthMap(ctx),
      incidents: this.buildIncidents(ctx),
      infraSnapshots: this.buildInfraSnapshots(ctx),
      recentActivities: this.buildRecentActivities(ctx),
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptimeSeconds: ctx.runtime.uptimeSeconds,
        heapUsedMb: ctx.runtime.heapUsedMb,
        heapTotalMb: ctx.runtime.heapTotalMb,
        rssMb: ctx.runtime.rssMb,
        totalMemGb: ctx.runtime.totalMemGb,
        freeMemGb: ctx.runtime.freeMemGb,
        cpuCores: ctx.runtime.cpuCores,
        loadAvg: ctx.runtime.loadAvg,
      },
    };
  }

  private get environment(): SystemOverviewResponseDto['environment'] {
    const env = this.configService.app.env;
    return env === 'production' || env === 'staging' ? env : 'development';
  }

  private async pingDatabase(): Promise<number | null> {
    const dbPackage = this.registryService.getPackage(CorePackageId.DATABASE);
    if (!dbPackage?.executeAction) {
      return null;
    }

    const start = Date.now();
    try {
      const result = await dbPackage.executeAction(DatabaseAction.PING);
      return result.success ? Math.max(1, Date.now() - start) : null;
    } catch {
      return null;
    }
  }

  private readRuntime(): RuntimeSnapshot {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuCores = os.cpus().length;
    const loadAvg = os.loadavg();

    return {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMb: Math.round(mem.heapUsed / BYTES_PER_MB),
      heapTotalMb: Math.round(mem.heapTotal / BYTES_PER_MB),
      rssMb: Math.round(mem.rss / BYTES_PER_MB),
      totalMemGb: Number((totalMem / BYTES_PER_GB).toFixed(1)),
      usedMemGb: Number(((totalMem - freeMem) / BYTES_PER_GB).toFixed(1)),
      freeMemGb: Number((freeMem / BYTES_PER_GB).toFixed(1)),
      memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      cpuCores,
      // Load average 1 phút / số nhân ≈ % CPU (luôn là 0 trên Windows).
      cpuPercent: Math.min(100, Math.round(((loadAvg[0] ?? 0) / Math.max(1, cpuCores)) * 100)),
      loadAvg,
    };
  }

  private packagesWithStatus(ctx: OverviewContext, status: PackageStatus): PackageSummaryDto[] {
    return ctx.packages.filter((p) => p.statusReport.status === status);
  }

  private buildOverallHealth(ctx: OverviewContext): OverallHealthReportDto {
    const failing = this.packagesWithStatus(ctx, PackageStatus.ERROR);
    const warning = this.packagesWithStatus(ctx, PackageStatus.WARNING);
    const base = {
      healthyServices: ctx.packages.length - failing.length - warning.length,
      totalServices: ctx.packages.length,
      uptimeSeconds: ctx.runtime.uptimeSeconds,
    };

    if (failing.length > 0) {
      return {
        ...base,
        status: 'critical',
        title: this.i18n.t('overview.health.critical.title'),
        message: this.i18n.t('overview.health.critical.message', { count: failing.length }),
        actionLabel: this.i18n.t('overview.health.critical.action'),
        actionSection: 'packages',
        affectedServices: failing.map((p) => p.displayName),
      };
    }

    if (warning.length > 0) {
      return {
        ...base,
        status: 'degraded',
        title: this.i18n.t('overview.health.degraded.title'),
        message: this.i18n.t('overview.health.degraded.message', { count: warning.length }),
        affectedServices: warning.map((p) => p.displayName),
      };
    }

    return {
      ...base,
      status: 'healthy',
      title: this.i18n.t('overview.health.healthy.title'),
      message: this.i18n.t('overview.health.healthy.message'),
    };
  }

  private buildKeyMetrics(ctx: OverviewContext): KeyMetricItemDto[] {
    const { http, runtime } = ctx;
    const hasTraffic = http.totalRequests > 0;
    const trafficText = hasTraffic
      ? this.i18n.t('overview.metric.window', {
          count: http.totalRequests,
          seconds: http.windowSeconds,
        })
      : this.i18n.t('overview.metric.noTraffic', { seconds: http.windowSeconds });
    const errorCount = this.packagesWithStatus(ctx, PackageStatus.ERROR).length;
    const alertCount = errorCount + this.packagesWithStatus(ctx, PackageStatus.WARNING).length;

    return [
      {
        id: 'req_sec',
        label: this.i18n.t('overview.metric.reqSec'),
        value: http.requestsPerSecond,
        unit: 'req/s',
        trendText: trafficText,
        trendDirection: 'neutral',
        trendIsGood: true,
        status: 'normal',
      },
      {
        id: 'p95_lat',
        label: this.i18n.t('overview.metric.p95'),
        value: http.p95LatencyMs ?? UNAVAILABLE,
        unit: 'ms',
        trendText: trafficText,
        trendDirection: 'neutral',
        trendIsGood: true,
        status: 'normal',
      },
      {
        id: 'err_rate',
        label: this.i18n.t('overview.metric.errorRate'),
        value: `${http.errorRatePercent}%`,
        trendText: this.i18n.t('overview.metric.errors', { count: http.errorCount }),
        trendDirection: 'neutral',
        trendIsGood: http.errorCount === 0,
        status: http.errorCount > 0 ? 'critical' : 'normal',
      },
      {
        id: 'cpu_load',
        label: this.i18n.t('overview.metric.cpu'),
        value: `${runtime.cpuPercent}%`,
        trendText: this.i18n.t('overview.metric.cores', { count: runtime.cpuCores }),
        trendDirection: 'neutral',
        trendIsGood: runtime.cpuPercent < CPU_WARN_PERCENT,
        status: runtime.cpuPercent > CPU_WARN_PERCENT ? 'warning' : 'normal',
      },
      {
        id: 'mem_usage',
        label: this.i18n.t('overview.metric.memory'),
        value: `${runtime.usedMemGb} / ${runtime.totalMemGb} GB`,
        trendText: this.i18n.t('overview.metric.memoryDetail', {
          percent: runtime.memoryPercent,
          heap: runtime.heapUsedMb,
        }),
        trendDirection: 'neutral',
        trendIsGood: runtime.memoryPercent < MEMORY_WARN_PERCENT,
        status: runtime.memoryPercent > MEMORY_WARN_PERCENT ? 'warning' : 'normal',
      },
      {
        id: 'alerts_count',
        label: this.i18n.t('overview.metric.alerts'),
        value: alertCount,
        trendText: this.i18n.t('overview.metric.critical', { count: errorCount }),
        trendDirection: 'neutral',
        trendIsGood: alertCount === 0,
        status: errorCount > 0 ? 'critical' : alertCount > 0 ? 'warning' : 'normal',
      },
    ];
  }

  private buildHealthMap(ctx: OverviewContext): HealthMapItemDto[] {
    const { app, database, cache, storage } = this.configService;
    const cachePackage = ctx.packages.find((p) => p.packageId === CorePackageId.CACHE);
    const securityPackage = ctx.packages.find((p) => p.packageId === CorePackageId.SECURITY);
    const unmonitoredProcess = {
      category: 'runtime',
      status: 'unknown',
      subtext: this.i18n.t('overview.map.processUnmonitored'),
      secondarySubtext: this.i18n.t('overview.map.processUnmonitoredDetail'),
    } as const;

    return [
      {
        id: 'runtime-api',
        name: this.i18n.t('overview.map.api.name'),
        category: 'runtime',
        status: 'healthy',
        subtext: this.i18n.t('overview.map.api.subtext', { port: app.port }),
        secondarySubtext: this.i18n.t('overview.map.api.secondary', {
          heap: ctx.runtime.heapUsedMb,
          uptime: ctx.runtime.uptimeSeconds,
        }),
        targetSection: 'runtime',
        icon: 'globe',
      },
      {
        ...unmonitoredProcess,
        id: 'runtime-worker',
        name: this.i18n.t('overview.map.worker.name'),
        targetSection: 'worker',
        icon: 'cpu',
      },
      {
        ...unmonitoredProcess,
        id: 'runtime-scheduler',
        name: this.i18n.t('overview.map.scheduler.name'),
        targetSection: 'scheduler',
        icon: 'clock',
      },
      {
        id: 'infra-db',
        name: this.i18n.t('overview.map.database.name'),
        category: 'infrastructure',
        status: ctx.dbPingMs !== null ? 'healthy' : 'warning',
        subtext: `${database.connection.toUpperCase()} • ${database.database}`,
        secondarySubtext:
          ctx.dbPingMs !== null
            ? this.i18n.t('overview.map.database.secondary', {
                ping: ctx.dbPingMs,
                pool: database.maxConnections,
              })
            : this.i18n.t('overview.map.database.pingFailed', { pool: database.maxConnections }),
        targetSection: 'database',
        icon: 'database',
      },
      {
        id: 'infra-cache',
        name: this.i18n.t('overview.map.cache.name'),
        category: 'infrastructure',
        status: toHealthMapStatus(cachePackage?.statusReport.status),
        subtext: cachePackage?.statusReport.summary ?? UNAVAILABLE,
        secondarySubtext: `${this.i18n.t('overview.snapshot.prefix')}: ${cache.redis.prefix}`,
        targetSection: 'cache',
        icon: 'zap',
      },
      {
        id: 'infra-storage',
        name: this.i18n.t('overview.map.storage.name'),
        category: 'infrastructure',
        status: 'unknown',
        subtext: this.i18n.t('overview.map.storage.subtext', {
          driver: storage.driver.toUpperCase(),
        }),
        secondarySubtext: this.i18n.t('overview.map.storage.secondary'),
        targetSection: 'packages',
        icon: 'hard-drive',
      },
      {
        id: 'gov-security',
        name: this.i18n.t('overview.map.security.name'),
        category: 'governance',
        status: toHealthMapStatus(securityPackage?.statusReport.status),
        subtext: this.i18n.t('overview.map.security.subtext'),
        secondarySubtext: securityPackage?.statusReport.summary ?? UNAVAILABLE,
        targetSection: 'security',
        icon: 'shield-check',
      },
    ];
  }

  private buildIncidents(ctx: OverviewContext): ActiveIncidentItemDto[] {
    return ctx.packages
      .filter(
        (p) =>
          p.statusReport.status === PackageStatus.WARNING ||
          p.statusReport.status === PackageStatus.ERROR,
      )
      .map((p) => ({
        id: `incident-${p.packageId}`,
        severity: p.statusReport.status === PackageStatus.ERROR ? 'critical' : 'warning',
        title: this.i18n.t('overview.incident.title', { name: p.displayName }),
        description: p.statusReport.summary,
        startedAgo: this.i18n.t('overview.incident.active'),
        targetSection: 'packages',
        actionLabel: this.i18n.t('overview.incident.action', { name: p.displayName }),
      }));
  }

  private buildInfraSnapshots(ctx: OverviewContext): InfraSnapshotItemDto[] {
    const { app, database, cache } = this.configService;
    const label = (key: string) => this.i18n.t(`overview.snapshot.${key}`);

    return [
      {
        id: 'snap-api',
        title: this.i18n.t('overview.map.api.name'),
        icon: 'globe',
        targetSection: 'runtime',
        metrics: [
          { label: label('port'), value: app.port },
          { label: label('heapUsed'), value: `${ctx.runtime.heapUsedMb} MB` },
          { label: label('heapTotal'), value: `${ctx.runtime.heapTotalMb} MB` },
          { label: label('nodeVersion'), value: process.version },
        ],
      },
      {
        id: 'snap-db',
        title: this.i18n.t('overview.map.database.name'),
        icon: 'database',
        targetSection: 'database',
        metrics: [
          { label: label('driver'), value: database.connection.toUpperCase() },
          {
            label: label('ping'),
            value: ctx.dbPingMs !== null ? `${ctx.dbPingMs} ms` : label('unavailable'),
            isWarn: ctx.dbPingMs === null,
          },
          { label: label('poolMax'), value: database.maxConnections },
          { label: label('synchronize'), value: String(database.synchronize) },
        ],
      },
      {
        id: 'snap-cache',
        title: this.i18n.t('overview.map.cache.name'),
        icon: 'zap',
        targetSection: 'cache',
        metrics: [
          { label: label('driver'), value: 'memory' },
          { label: label('prefix'), value: cache.redis.prefix },
          { label: label('configuredRedis'), value: `${cache.redis.host}:${cache.redis.port}` },
        ],
      },
    ];
  }

  private buildRecentActivities(ctx: OverviewContext): RecentActivityEventDto[] {
    const { app, database } = this.configService;
    const startedAt = new Date(Date.now() - ctx.runtime.uptimeSeconds * 1000).toISOString();
    const dbParams = { driver: database.connection.toUpperCase(), database: database.database };

    return [
      {
        id: 'act-db-ping',
        time: new Date().toISOString(),
        level: ctx.dbPingMs !== null ? 'success' : 'error',
        source: this.i18n.t('overview.map.database.name'),
        message:
          ctx.dbPingMs !== null
            ? this.i18n.t('overview.activity.dbPingOk', { ...dbParams, ping: ctx.dbPingMs })
            : this.i18n.t('overview.activity.dbPingFailed', dbParams),
      },
      {
        id: 'act-api-started',
        time: startedAt,
        level: 'info',
        source: this.i18n.t('overview.map.api.name'),
        message: this.i18n.t('overview.activity.apiStarted', {
          port: app.port,
          env: this.environment,
        }),
      },
    ];
  }
}

function toHealthMapStatus(status: PackageStatus | undefined): HealthMapItemDto['status'] {
  switch (status) {
    case PackageStatus.HEALTHY:
      return 'healthy';
    case PackageStatus.WARNING:
      return 'warning';
    case PackageStatus.ERROR:
      return 'critical';
    default:
      return 'unknown';
  }
}
