import { Injectable } from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseAction } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { HttpMetricsService, type HttpMetricsSnapshot } from '@packages/logging/index.js';
import { CorePackageId, PackageStatus } from '@packages/kernel/index.js';
import { PackageRegistryService, type PackageSummaryDto } from './package-registry.service.js';
import { OpsEventService } from './ops-event.service.js';
import { RuntimesService, type RuntimeSummaryDto } from '@modules/runtimes/index.js';
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

/** Trạng thái runtime → trạng thái health map / mức độ sự cố. */
const RUNTIME_MAP_STATUS: Record<string, HealthMapItemDto['status']> = {
  healthy: 'healthy',
  starting: 'warning',
  degraded: 'warning',
  stopping: 'warning',
  restarting: 'warning',
  stopped: 'warning',
  crashed: 'critical',
  unknown: 'unknown',
};

/** Một thành phần đang có vấn đề (package hoặc runtime). */
interface Problem {
  key: string;
  name: string;
  severity: 'error' | 'warning';
  section: string;
  description: string;
  since?: Date;
}

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
  /** Worker/Scheduler từ runtime telemetry (API chính là process hiện tại). */
  runtimes: Map<string, RuntimeSummaryDto>;
  problems: Problem[];
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
    private readonly runtimes: RuntimesService,
  ) {}

  public async getOverview(): Promise<SystemOverviewResponseDto> {
    const [packages, dbPingMs, runtimeList] = await Promise.all([
      this.registryService.getAllSummaries(),
      this.pingDatabase(),
      this.runtimes.getSummaries().catch(() => [] as RuntimeSummaryDto[]),
    ]);
    const runtimes = new Map(runtimeList.map((r) => [r.id, r]));
    const ctx: OverviewContext = {
      runtime: this.readRuntime(),
      http: this.httpMetrics.snapshot(),
      packages,
      runtimes,
      problems: this.collectProblems(packages, runtimes),
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

  private collectProblems(
    packages: PackageSummaryDto[],
    runtimes: Map<string, RuntimeSummaryDto>,
  ): Problem[] {
    const fromPackages: Problem[] = packages
      .filter(
        (p) =>
          p.statusReport.status === PackageStatus.ERROR ||
          p.statusReport.status === PackageStatus.WARNING,
      )
      .map((p) => {
        const since = this.events.getStatusSince(p.packageId);
        return {
          key: `pkg-${p.packageId}`,
          name: p.displayName,
          severity: p.statusReport.status === PackageStatus.ERROR ? 'error' : 'warning',
          section: sectionOf(p.packageId),
          description: p.statusReport.summary,
          ...(since ? { since } : {}),
        };
      });
    const fromRuntimes: Problem[] = [...runtimes.values()]
      .filter(
        (r) =>
          r.id !== 'api' && ['critical', 'warning'].includes(RUNTIME_MAP_STATUS[r.status] ?? ''),
      )
      .map((r) => ({
        key: `rt-${r.id}`,
        name: r.name,
        severity: RUNTIME_MAP_STATUS[r.status] === 'critical' ? 'error' : 'warning',
        section: `runtimes/${r.id}`,
        description:
          r.reasons.map((x) => x.message).join(' • ') ||
          this.i18n.t(`overview.runtime.status.${r.status}`),
      }));
    return [
      ...fromPackages.filter((p) => p.severity === 'error'),
      ...fromRuntimes,
      ...fromPackages.filter((p) => p.severity === 'warning'),
    ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  }

  private buildOverallHealth(ctx: OverviewContext): OverallHealthReportDto {
    const problems = ctx.problems;
    const managedRuntimes = [...ctx.runtimes.values()].filter((r) => r.id !== 'api');
    const total = ctx.packages.length + managedRuntimes.length;
    // Runtime chưa có telemetry không được tính là "ổn định".
    const unknownRuntimes = managedRuntimes.filter((r) => r.status === 'unknown').length;
    const base = {
      healthyServices: total - problems.length - unknownRuntimes,
      totalServices: total,
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

    const failingCount = problems.filter((p) => p.severity === 'error').length;
    const isCritical = failingCount > 0;
    const startedAt = problems
      .map((p) => p.since)
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      ...base,
      status: isCritical ? 'critical' : 'degraded',
      title: this.i18n.t(
        isCritical ? 'overview.health.critical.title' : 'overview.health.degraded.title',
      ),
      message: this.i18n.t(
        isCritical ? 'overview.health.critical.message' : 'overview.health.degraded.message',
        {
          count: isCritical ? failingCount : problems.length,
        },
      ),
      affectedServices: problems.map((p) => p.name),
      affectedComponents: problems.map<AffectedComponentDto>((p) => ({
        name: p.name,
        status: p.severity,
        section: p.section,
      })),
      actionLabel: this.i18n.t('overview.health.inspect', { name: firstProblem.name }),
      actionSection: firstProblem.section,
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
    const errorCount = ctx.problems.filter((p) => p.severity === 'error').length;
    const alertCount = ctx.problems.length;

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
    const runtimeItem = (id: 'worker' | 'scheduler', icon: string): HealthMapItemDto => {
      const rt = ctx.runtimes.get(id);
      const nameKey = `overview.map.${id}.name`;
      if (!rt || rt.status === 'unknown') {
        return {
          id: `runtime-${id}`,
          name: this.i18n.t(nameKey),
          category: 'runtime',
          status: 'unknown',
          subtext: rt?.reasons[0]?.message ?? this.i18n.t('overview.map.processUnmonitored'),
          metric: this.i18n.t('overview.map.notMonitored'),
          targetSection: `runtimes/${id}`,
          icon,
        };
      }
      const m = rt.metrics;
      return {
        id: `runtime-${id}`,
        name: rt.name,
        category: 'runtime',
        status: RUNTIME_MAP_STATUS[rt.status] ?? 'unknown',
        subtext: this.i18n.t(`overview.runtime.status.${rt.status}`),
        ...(rt.reasons[0] ? { secondarySubtext: rt.reasons[0].message } : {}),
        metric:
          id === 'worker'
            ? this.i18n.t('overview.map.worker.metric', {
                active: String(m['activeJobs'] ?? UNAVAILABLE),
                waiting: String(m['waitingJobs'] ?? UNAVAILABLE),
              })
            : this.i18n.t('overview.map.scheduler.metric', {
                running: String(m['runningTasks'] ?? UNAVAILABLE),
                failed: String(m['failedToday'] ?? UNAVAILABLE),
              }),
        targetSection: `runtimes/${id}`,
        icon,
      };
    };

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
        targetSection: 'runtimes/api',
        icon: 'globe',
      },
      runtimeItem('worker', 'cpu'),
      runtimeItem('scheduler', 'clock'),
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
    return ctx.problems.map((p) => ({
      id: `incident-${p.key}`,
      severity: p.severity === 'error' ? 'critical' : 'warning',
      title: this.i18n.t('overview.incident.title', { name: p.name }),
      description: p.description,
      startedAgo: this.i18n.t('overview.incident.active'),
      ...(p.since ? { startedAt: p.since.toISOString() } : {}),
      targetSection: p.section,
      actionLabel: this.i18n.t('overview.incident.action', { name: p.name }),
    }));
  }

  private buildInfraSnapshots(ctx: OverviewContext): InfraSnapshotItemDto[] {
    const { database } = this.configService;
    const label = (key: string) => this.i18n.t(`overview.snapshot.${key}`);
    const cacheMetrics =
      ctx.packages.find((p) => p.packageId === CorePackageId.CACHE)?.statusReport.metrics ?? {};
    const hitRate = cacheMetrics['hitRatePercent'];
    const runtimeSnapshot = (id: 'worker' | 'scheduler', icon: string): InfraSnapshotItemDto => {
      const rt = ctx.runtimes.get(id);
      const base = {
        id: `snap-${id}`,
        title: this.i18n.t(`overview.map.${id}.name`),
        icon,
        targetSection: `runtimes/${id}`,
      };
      if (!rt?.resources) return { ...base, metrics: [], unavailable: true };
      const m = rt.metrics;
      const value = (v: unknown) =>
        v === null || v === undefined ? UNAVAILABLE : (v as string | number);
      const specific =
        id === 'worker'
          ? [
              { label: label('activeJobs'), value: value(m['activeJobs']) },
              { label: label('waitingJobs'), value: value(m['waitingJobs']) },
              { label: label('jobsPerMinute'), value: value(m['jobsPerMinute']) },
            ]
          : [
              { label: label('tasks'), value: value(m['registeredTasks']) },
              { label: label('runningTasks'), value: value(m['runningTasks']) },
              {
                label: label('failedToday'),
                value: value(m['failedToday']),
                isWarn: Number(m['failedToday'] ?? 0) > 0,
              },
            ];
      return {
        ...base,
        metrics: [
          { label: label('cpu'), value: `${rt.resources.cpuPercent}%` },
          { label: label('memory'), value: `${rt.resources.rssMb} MB` },
          ...specific,
        ],
      };
    };

    return [
      {
        id: 'snap-api',
        title: this.i18n.t('overview.map.api.name'),
        icon: 'globe',
        targetSection: 'runtimes/api',
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
      runtimeSnapshot('worker', 'cpu'),
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
      runtimeSnapshot('scheduler', 'clock'),
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
