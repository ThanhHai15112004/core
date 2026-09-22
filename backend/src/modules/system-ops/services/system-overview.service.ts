import { Injectable } from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseAction } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { HttpMetricsService, type HttpMetricsSnapshot } from '@packages/logging/index.js';
import { CorePackageId, PackageStatus } from '@packages/kernel/index.js';
import { PackageRegistryService, type PackageSummaryDto } from './package-registry.service.js';
import { OpsEventService } from './ops-event.service.js';
import type {
  AffectedComponentDto,
  SystemOverviewResponseDto,
  HealthMapItemDto,
  ActiveIncidentItemDto,
  InfraSnapshotItemDto,
  KeyMetricItemDto,
  OverallHealthReportDto,
} from '../responses/overview.response.js';

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = BYTES_PER_MB * 1024;
const CPU_WARN_PERCENT = 80;
const MEMORY_WARN_PERCENT = 85;
const UNAVAILABLE = '--';

/** Section của System Console dùng để drill-down theo package. */
const PACKAGE_SECTION: Record<string, string> = {
  [CorePackageId.CACHE]: 'cache',
  [CorePackageId.DATABASE]: 'database',
  [CorePackageId.LOGGING]: 'logs',
  [CorePackageId.SECURITY]: 'security',
};

const sectionOf = (packageId: string): string => PACKAGE_SECTION[packageId] ?? 'packages';

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
    private readonly events: OpsEventService,
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
      recentActivities: this.events.getRecent(20),
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
    const problems = [...failing, ...warning];
    const base = {
      healthyServices: ctx.packages.length - problems.length,
      totalServices: ctx.packages.length,
      uptimeSeconds: ctx.runtime.uptimeSeconds,
    };

    const firstProblem = problems[0];
    if (!firstProblem) {
      return {
        ...base,
        status: 'healthy',
        title: this.i18n.t('overview.health.healthy.title'),
        message: this.i18n.t('overview.health.healthy.message'),
      };
    }

    const affectedComponents: AffectedComponentDto[] = problems.map((p) => ({
      name: p.displayName,
      status: p.statusReport.status,
      section: sectionOf(p.packageId),
    }));
    const startedAt = problems
      .map((p) => this.events.getStatusSince(p.packageId))
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const isCritical = failing.length > 0;

    return {
      ...base,
      status: isCritical ? 'critical' : 'degraded',
      title: this.i18n.t(
        isCritical ? 'overview.health.critical.title' : 'overview.health.degraded.title',
      ),
      message: this.i18n.t(
        isCritical ? 'overview.health.critical.message' : 'overview.health.degraded.message',
        {
          count: isCritical ? failing.length : warning.length,
        },
      ),
      affectedServices: problems.map((p) => p.displayName),
      affectedComponents,
      actionLabel: this.i18n.t('overview.health.inspect', { name: firstProblem.displayName }),
      actionSection: sectionOf(firstProblem.packageId),
      ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
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
    const { app, database, storage } = this.configService;
    const pkg = (id: string) => ctx.packages.find((p) => p.packageId === id);
    const cachePackage = pkg(CorePackageId.CACHE);
    const securityPackage = pkg(CorePackageId.SECURITY);
    const cacheKeys = cachePackage?.statusReport.metrics['keys'];
    const cacheHitRate = cachePackage?.statusReport.metrics['hitRatePercent'];
    const unmonitored = (
      id: string,
      nameKey: string,
      targetSection: string,
      icon: string,
    ): HealthMapItemDto => ({
      id,
      name: this.i18n.t(nameKey),
      category: 'runtime',
      status: 'unknown',
      subtext: this.i18n.t('overview.map.processUnmonitored'),
      secondarySubtext: this.i18n.t('overview.map.processUnmonitoredDetail'),
      metric: this.i18n.t('overview.map.notMonitored'),
      targetSection,
      icon,
    });

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
        metric: `${ctx.http.requestsPerSecond} req/s • P95 ${ctx.http.p95LatencyMs ?? UNAVAILABLE} ms`,
        targetSection: 'runtime',
        icon: 'globe',
      },
      unmonitored('runtime-worker', 'overview.map.worker.name', 'worker', 'cpu'),
      unmonitored('runtime-scheduler', 'overview.map.scheduler.name', 'scheduler', 'clock'),
      {
        id: 'infra-db',
        name: this.i18n.t('overview.map.database.name'),
        category: 'infrastructure',
        status: ctx.dbPingMs !== null ? 'healthy' : 'critical',
        subtext: `${database.connection.toUpperCase()} • ${database.database}`,
        secondarySubtext:
          ctx.dbPingMs !== null
            ? this.i18n.t('overview.map.database.secondary', {
                ping: ctx.dbPingMs,
                pool: database.maxConnections,
              })
            : this.i18n.t('overview.map.database.pingFailed', { pool: database.maxConnections }),
        metric:
          ctx.dbPingMs !== null
            ? this.i18n.t('overview.map.database.metric', {
                ping: ctx.dbPingMs,
                pool: database.maxConnections,
              })
            : this.i18n.t('overview.map.database.unreachable'),
        targetSection: 'database',
        icon: 'database',
      },
      {
        id: 'infra-cache',
        name: this.i18n.t('overview.map.cache.name'),
        category: 'infrastructure',
        status: toHealthMapStatus(cachePackage?.statusReport.status),
        subtext: cachePackage?.statusReport.summary ?? UNAVAILABLE,
        metric: this.i18n.t('overview.map.cache.metric', {
          keys: String(cacheKeys ?? UNAVAILABLE),
          hitRate: typeof cacheHitRate === 'number' ? `${cacheHitRate}%` : UNAVAILABLE,
        }),
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
        metric: this.i18n.t('overview.map.noHealthCheck'),
        targetSection: 'packages',
        icon: 'hard-drive',
      },
      {
        id: 'infra-messaging',
        name: this.i18n.t('overview.map.messaging.name'),
        category: 'infrastructure',
        status: 'unknown',
        subtext: this.i18n.t('overview.map.messaging.subtext'),
        metric: this.i18n.t('overview.map.noHealthCheck'),
        targetSection: 'packages',
        icon: 'radio',
      },
      {
        id: 'gov-security',
        name: this.i18n.t('overview.map.security.name'),
        category: 'governance',
        status: toHealthMapStatus(securityPackage?.statusReport.status),
        subtext: this.i18n.t('overview.map.security.subtext'),
        secondarySubtext: securityPackage?.statusReport.summary ?? UNAVAILABLE,
        metric:
          securityPackage?.statusReport.metrics['tokenVerification'] === 'skeleton'
            ? this.i18n.t('overview.map.security.skeleton')
            : this.i18n.t('overview.map.security.subtext'),
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
      .map((p) => {
        const since = this.events.getStatusSince(p.packageId);
        return {
          id: `incident-${p.packageId}`,
          severity: p.statusReport.status === PackageStatus.ERROR ? 'critical' : 'warning',
          title: this.i18n.t('overview.incident.title', { name: p.displayName }),
          description: p.statusReport.summary,
          startedAgo: this.i18n.t('overview.incident.active'),
          ...(since ? { startedAt: since.toISOString() } : {}),
          targetSection: sectionOf(p.packageId),
          actionLabel: this.i18n.t('overview.incident.action', { name: p.displayName }),
        };
      });
  }

  private buildInfraSnapshots(ctx: OverviewContext): InfraSnapshotItemDto[] {
    const { database } = this.configService;
    const label = (key: string) => this.i18n.t(`overview.snapshot.${key}`);
    const cacheMetrics =
      ctx.packages.find((p) => p.packageId === CorePackageId.CACHE)?.statusReport.metrics ?? {};
    const hitRate = cacheMetrics['hitRatePercent'];
    const unavailable = (id: string, nameKey: string, targetSection: string, icon: string) => ({
      id,
      title: this.i18n.t(nameKey),
      icon,
      targetSection,
      metrics: [],
      unavailable: true,
    });

    return [
      {
        id: 'snap-api',
        title: this.i18n.t('overview.map.api.name'),
        icon: 'globe',
        targetSection: 'runtime',
        metrics: [
          {
            label: label('cpu'),
            value: `${ctx.runtime.cpuPercent}%`,
            isWarn: ctx.runtime.cpuPercent > CPU_WARN_PERCENT,
          },
          { label: label('memory'), value: `${ctx.runtime.rssMb} MB` },
          { label: label('traffic'), value: `${ctx.http.requestsPerSecond} req/s` },
          {
            label: label('p95'),
            value: ctx.http.p95LatencyMs !== null ? `${ctx.http.p95LatencyMs} ms` : UNAVAILABLE,
          },
        ],
      },
      unavailable('snap-worker', 'overview.map.worker.name', 'worker', 'cpu'),
      {
        id: 'snap-db',
        title: this.i18n.t('overview.map.database.name'),
        icon: 'database',
        targetSection: 'database',
        metrics: [
          {
            label: label('ping'),
            value: ctx.dbPingMs !== null ? `${ctx.dbPingMs} ms` : label('unavailable'),
            isWarn: ctx.dbPingMs === null,
          },
          { label: label('poolMax'), value: database.maxConnections },
          { label: label('driver'), value: database.connection.toUpperCase() },
        ],
      },
      {
        id: 'snap-cache',
        title: this.i18n.t('overview.map.cache.name'),
        icon: 'zap',
        targetSection: 'cache',
        metrics: [
          { label: label('keys'), value: Number(cacheMetrics['keys'] ?? 0) },
          {
            label: label('hitRate'),
            value: typeof hitRate === 'number' ? `${hitRate}%` : UNAVAILABLE,
          },
          { label: label('hits'), value: Number(cacheMetrics['hits'] ?? 0) },
          { label: label('misses'), value: Number(cacheMetrics['misses'] ?? 0) },
        ],
      },
      unavailable('snap-scheduler', 'overview.map.scheduler.name', 'scheduler', 'clock'),
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
