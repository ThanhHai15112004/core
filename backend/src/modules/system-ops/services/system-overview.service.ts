import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  TrafficService,
  type TrafficProblemDto,
  type TrafficSummaryDto,
} from '@modules/traffic/index.js';
import { PerformanceService, type BottleneckDto } from '@modules/performance/index.js';
import { HealthService, type HealthCheckResult } from '@modules/health/index.js';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { HttpMetricsReader, type HttpMetricsSnapshot } from '@packages/metrics/index.js';
import { CorePackageId, PackageStatus } from '@packages/kernel/index.js';
import { PackageRegistryService, type PackageSummaryDto } from './package-registry.service.js';
import { OpsEventService } from './ops-event.service.js';
import { RuntimesService, type RuntimeSummaryDto } from '@modules/runtimes/index.js';
import type {
  SystemOverviewResponseDto,
  HealthMapItemDto,
  ActiveIncidentItemDto,
  KeyMetricItemDto,
  OverallHealthReportDto,
} from '../responses/overview.response.js';

const BYTES_PER_MB = 1024 * 1024;
const UNAVAILABLE = '--';

/** Section của System Console dùng để drill-down theo package. */
const PACKAGE_SECTION: Record<string, string> = {
  [CorePackageId.CACHE]: 'cache',
  [CorePackageId.DATABASE]: 'database',
  [CorePackageId.LOGGING]: 'logs',
  [CorePackageId.SECURITY]: 'security',
};

/** Xác định phân vùng (section) tương ứng trên System Console của package */
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
  /** `traffic`/`performance` không phải một service nên không trừ vào số service ổn định. */
  kind: 'service' | 'traffic' | 'performance';
  name: string;
  severity: 'error' | 'warning';
  section: string;
  description: string;
  since?: Date;
}

/** Thông tin process API tại thời điểm gọi. */
interface RuntimeSnapshot {
  uptimeSeconds: number;
  heapUsedMb: number;
}

interface OverviewContext {
  runtime: RuntimeSnapshot;
  /** Kết quả `/health` (terminus: database, redis, heap). */
  health: HealthCheckResult | null;
  http: HttpMetricsSnapshot;
  packages: PackageSummaryDto[];
  /** Worker/Scheduler từ runtime telemetry (API chính là process hiện tại). */
  runtimes: Map<string, RuntimeSummaryDto>;
  problems: Problem[];
  /** HTTP traffic 15 phút gần nhất; `null` khi không có telemetry. */
  traffic: { summary: TrafficSummaryDto | null; problems: TrafficProblemDto[] };
  /** Điểm nghẽn hiệu năng; `null` khi không có telemetry. */
  bottlenecks: BottleneckDto[] | null;
  /** `null` = không ping được hoặc không có package database. */
  dbPingMs: number | null;
}

@Injectable()
export class SystemOverviewService {
  constructor(
    private readonly configService: CoreConfigService,
    private readonly registryService: PackageRegistryService,
    private readonly httpMetrics: HttpMetricsReader,
    private readonly i18n: CoreI18nService,
    private readonly events: OpsEventService,
    private readonly runtimes: RuntimesService,
    private readonly traffic: TrafficService,
    private readonly performance: PerformanceService,
    private readonly dbConnection: DatabaseConnectionService,
    private readonly healthService: HealthService,
  ) {}

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  public async getOverview(): Promise<SystemOverviewResponseDto> {
    const trafficQuery = { range: '15m', includeInternal: true } as const;
    const [
      packages,
      dbPingMs,
      runtimeList,
      trafficProblems,
      trafficSummary,
      bottlenecks,
      http,
      health,
    ] = await Promise.all([
      this.registryService.getAllSummaries(),
      this.pingDatabase(),
      this.runtimes.getSummaries().catch(() => [] as RuntimeSummaryDto[]),
      this.traffic
        .getInsights(trafficQuery)
        .then((i) => i.problems)
        .catch(() => [] as TrafficProblemDto[]),
      this.traffic.getSummary(trafficQuery).catch(() => null),
      this.performance.getBottlenecks().catch(() => null),
      this.httpMetrics.snapshot(),
      this.healthService.check().catch(() => null),
    ]);
    const runtimes = new Map(runtimeList.map((r) => [r.id, r]));
    const ctx: OverviewContext = {
      runtime: this.readRuntime(),
      health,
      http,
      packages,
      runtimes,
      problems: this.collectProblems(packages, runtimes, trafficProblems, bottlenecks ?? []),
      traffic: { summary: trafficSummary, problems: trafficProblems },
      bottlenecks,
      dbPingMs,
    };

    return {
      environment: this.environment,
      overallHealth: this.buildOverallHealth(ctx),
      keyMetrics: this.buildKeyMetrics(ctx),
      healthMap: this.buildHealthMap(ctx),
      incidents: this.buildIncidents(ctx),
      recentActivities: this.events.getRecent(20),
    };
  }

  private get environment(): SystemOverviewResponseDto['environment'] {
    const env = this.configService.app.env;
    return env === 'production' || env === 'staging' ? env : 'development';
  }

  /** Latency của health check `SELECT 1` gần nhất; `null` khi database chưa kết nối được. */
  private async pingDatabase(): Promise<number | null> {
    const status = this.dbConnection.getStatus();
    return status.state === 'connected' ? (status.lastPingMs ?? null) : null;
  }

  /** Đọc thông tin trạng thái của runtime process hiện tại */
  private readRuntime(): RuntimeSnapshot {
    return {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / BYTES_PER_MB),
    };
  }

  /** Mức theo cặp ngưỡng warn/crit; `null` → chưa có số liệu. */
  private static level(
    value: number | null,
    t: { warn: number; crit: number },
  ): KeyMetricItemDto['status'] {
    if (value === null) return 'normal';
    return value >= t.crit ? 'critical' : value >= t.warn ? 'warning' : 'normal';
  }

  /** Runtime có giá trị lớn nhất theo heartbeat (CPU% / RAM%) — số đo của process, không phải của máy chủ. */
  private busiest(ctx: OverviewContext, key: 'cpuPercent' | 'memoryPercent') {
    return [...ctx.runtimes.values()]
      .filter((r) => r.resources && r.resources[key] !== null)
      .sort((a, b) => (b.resources![key] ?? 0) - (a.resources![key] ?? 0))[0];
  }

  /** Sức khỏe request đi qua API (khác với sức khỏe process API). */
  private trafficItem(ctx: OverviewContext): HealthMapItemDto {
    const { summary, problems } = ctx.traffic;
    const base = {
      id: 'runtime-traffic',
      name: this.i18n.t('overview.map.traffic.name'),
      category: 'runtime' as const,
      targetSection: 'http-traffic',
    };
    if (!summary) {
      return {
        ...base,
        status: 'unknown',
        subtext: this.i18n.t('overview.map.traffic.unavailable'),
        metric: UNAVAILABLE,
      };
    }
    const status = problems.some((p) => p.severity === 'critical')
      ? 'critical'
      : problems.length > 0
        ? 'warning'
        : summary.stats.requests > 0
          ? 'healthy'
          : 'unknown';
    const { stats } = summary;
    return {
      ...base,
      status,
      subtext: problems[0]?.title ?? this.i18n.t('overview.map.traffic.subtext'),
      metric: this.i18n.t('overview.map.traffic.metric', {
        rps: stats.requestsPerSecond,
        p95: stats.p95LatencyMs ?? UNAVAILABLE,
        errors: stats.errorRatePercent,
      }),
    };
  }

  /** Hiệu năng toàn hệ thống: có điểm nghẽn nào không. */
  private performanceItem(ctx: OverviewContext): HealthMapItemDto {
    const base = {
      id: 'runtime-performance',
      name: this.i18n.t('overview.map.performance.name'),
      category: 'runtime' as const,
      targetSection: 'performance',
    };
    const list = ctx.bottlenecks;
    if (!list) {
      return {
        ...base,
        status: 'unknown',
        subtext: this.i18n.t('overview.map.performance.unavailable'),
        metric: UNAVAILABLE,
      };
    }
    return {
      ...base,
      status: list.some((b) => b.severity === 'critical')
        ? 'critical'
        : list.length > 0
          ? 'warning'
          : 'healthy',
      subtext: list[0]?.title ?? this.i18n.t('overview.map.performance.subtext'),
      metric: this.i18n.t('overview.map.performance.metric', { count: list.length }),
    };
  }

  /** Thu thập và tổng hợp danh sách các sự cố hiện có trong hệ thống */
  private collectProblems(
    packages: PackageSummaryDto[],
    runtimes: Map<string, RuntimeSummaryDto>,
    traffic: TrafficProblemDto[],
    bottlenecks: BottleneckDto[],
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
          kind: 'service' as const,
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
        kind: 'service' as const,
        name: r.name,
        severity: RUNTIME_MAP_STATUS[r.status] === 'critical' ? 'error' : 'warning',
        section: `runtimes/${r.id}`,
        description:
          r.reasons.map((x) => x.message).join(' • ') ||
          this.i18n.t(`overview.runtime.status.${r.status}`),
      }));
    const fromTraffic: Problem[] = traffic.map((t, i) => ({
      key: `traffic-${t.kind}-${t.routeId ?? i}`,
      kind: 'traffic',
      name: t.title,
      severity: t.severity === 'critical' ? 'error' : 'warning',
      section: t.routeId ? `http-traffic/endpoints/${t.routeId}` : 'http-traffic',
      description: t.message,
      ...(t.since ? { since: new Date(t.since) } : {}),
    }));
    // API latency/lỗi đã có ở HTTP Traffic; runtime đã báo vấn đề thì không nhắc lại cùng runtime.
    const reported = new Set(fromRuntimes.map((r) => r.key.slice('rt-'.length)));
    const fromPerformance: Problem[] = bottlenecks
      .filter((b) => b.component !== 'api' && !(b.runtime && reported.has(b.runtime)))
      .map((b) => ({
        key: `perf-${b.id}`,
        kind: 'performance',
        name: b.title,
        severity: b.severity === 'critical' ? 'error' : 'warning',
        section: b.target,
        description: b.message,
        ...(b.since ? { since: new Date(b.since) } : {}),
      }));
    return [
      ...fromPackages.filter((p) => p.severity === 'error'),
      ...fromRuntimes,
      ...fromTraffic,
      ...fromPerformance,
      ...fromPackages.filter((p) => p.severity === 'warning'),
    ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  }

  /** Xây dựng báo cáo đánh giá sức khỏe tổng thể của hệ thống */
  private buildOverallHealth(ctx: OverviewContext): OverallHealthReportDto {
    const problems = ctx.problems;
    const managedRuntimes = [...ctx.runtimes.values()].filter((r) => r.id !== 'api');
    const total = ctx.packages.length + managedRuntimes.length;
    // Runtime chưa có telemetry không được tính là "ổn định".
    const unknownRuntimes = managedRuntimes.filter((r) => r.status === 'unknown').length;
    const base = {
      healthyServices:
        total - problems.filter((p) => p.kind === 'service').length - unknownRuntimes,
      totalServices: total,
      uptimeSeconds: ctx.runtime.uptimeSeconds,
    };

    const firstProblem = problems[0];
    if (!firstProblem) {
      return {
        ...base,
        status: 'healthy',
        title: this.i18n.t('overview.health.healthy.title'),
      };
    }

    const isCritical = problems.some((p) => p.severity === 'error');
    return {
      ...base,
      status: isCritical ? 'critical' : 'degraded',
      title: this.i18n.t(
        isCritical ? 'overview.health.critical.title' : 'overview.health.degraded.title',
      ),
      actionLabel: this.i18n.t('overview.health.inspect', { name: firstProblem.name }),
      actionSection: firstProblem.section,
    };
  }

  /** Tổng hợp danh sách các chỉ số vận hành then chốt (Key Metrics) */
  private buildKeyMetrics(ctx: OverviewContext): KeyMetricItemDto[] {
    const { http } = ctx;
    const rules = this.configService.performance.rules;
    const th = this.configService.traffic.thresholds;
    const noData = this.i18n.t('overview.metric.telemetryUnavailable');
    const trafficText =
      http.totalRequests === null
        ? noData
        : http.totalRequests > 0
          ? this.i18n.t('overview.metric.window', {
              count: http.totalRequests,
              seconds: http.windowSeconds,
            })
          : this.i18n.t('overview.metric.noTraffic', { seconds: http.windowSeconds });
    const errorCount = ctx.problems.filter((p) => p.severity === 'error').length;
    const alertCount = ctx.problems.length;
    const cpu = this.busiest(ctx, 'cpuPercent');
    const mem = this.busiest(ctx, 'memoryPercent');
    const cpuValue = cpu?.resources?.cpuPercent ?? null;
    const memRes = mem?.resources ?? null;
    const memPercent = memRes?.memoryPercent ?? null;
    const memUsed = memRes
      ? memRes.memoryLimitSource === 'cgroup'
        ? memRes.rssMb
        : memRes.heapUsedMb
      : null;
    const noRuntime = this.i18n.t('overview.metric.noRuntime');
    const L = SystemOverviewService.level;

    return [
      {
        id: 'req_sec',
        label: this.i18n.t('overview.metric.reqSec'),
        value: http.requestsPerSecond ?? UNAVAILABLE,
        unit: 'req/s',
        trendText: trafficText,
        status: 'normal',
      },
      {
        id: 'p95_lat',
        label: this.i18n.t('overview.metric.p95'),
        value: http.p95LatencyMs ?? UNAVAILABLE,
        unit: 'ms',
        trendText: trafficText,
        status: L(http.p95LatencyMs, rules.apiP95Ms),
      },
      {
        id: 'err_rate',
        label: this.i18n.t('overview.metric.errorRate'),
        value: http.errorRatePercent === null ? UNAVAILABLE : `${http.errorRatePercent}%`,
        trendText:
          http.errorCount === null
            ? noData
            : this.i18n.t('overview.metric.errors', { count: http.errorCount }),
        status: L(http.errorRatePercent, {
          warn: th.errorRateWarnPercent,
          crit: th.errorRateCritPercent,
        }),
      },
      {
        id: 'cpu_load',
        label: this.i18n.t('overview.metric.cpu'),
        value: cpuValue === null ? UNAVAILABLE : `${cpuValue}%`,
        trendText: cpu
          ? this.i18n.t('overview.metric.cpuDetail', { runtime: cpu.name })
          : noRuntime,
        status: L(cpuValue, rules.cpuPercent),
      },
      {
        id: 'mem_usage',
        label: this.i18n.t('overview.metric.memory'),
        value:
          memRes && memUsed !== null && memRes.memoryLimitMb !== null
            ? `${Math.round(memUsed)} / ${Math.round(memRes.memoryLimitMb)} MB`
            : UNAVAILABLE,
        trendText: mem
          ? this.i18n.t('overview.metric.memoryDetail', {
              runtime: mem.name,
              percent: memPercent ?? UNAVAILABLE,
              source: this.i18n.t(
                `overview.metric.limit.${memRes?.memoryLimitSource ?? 'v8-heap'}`,
              ),
            })
          : noRuntime,
        status: L(memPercent, rules.memoryPercent),
      },
      {
        id: 'alerts_count',
        label: this.i18n.t('overview.metric.alerts'),
        value: alertCount,
        trendText: this.i18n.t('overview.metric.critical', { count: errorCount }),
        status: errorCount > 0 ? 'critical' : alertCount > 0 ? 'warning' : 'normal',
      },
    ];
  }

  /** API: trạng thái theo health check (terminus) — không mặc định "healthy". */
  private apiItem(ctx: OverviewContext): HealthMapItemDto {
    const { app } = this.configService;
    const down = Object.entries(ctx.health?.checks ?? {})
      .filter(([, c]) => c.status === 'down')
      .map(([k]) => k);
    const status: HealthMapItemDto['status'] = !ctx.health
      ? 'unknown'
      : ctx.health.status === 'ok'
        ? 'healthy'
        : down.includes('database') || down.includes('redis')
          ? 'critical'
          : 'warning';
    const rps = ctx.http.requestsPerSecond;
    return {
      id: 'runtime-api',
      name: this.i18n.t('overview.map.api.name'),
      category: 'runtime',
      status,
      subtext: down.length
        ? this.i18n.t('overview.map.api.degraded', { checks: down.join(', ') })
        : this.i18n.t('overview.map.api.subtext', { port: app.port }),
      secondarySubtext: this.i18n.t('overview.map.api.secondary', {
        heap: ctx.runtime.heapUsedMb,
        uptime: ctx.runtime.uptimeSeconds,
      }),
      metric: `${rps ?? UNAVAILABLE} req/s • P95 ${ctx.http.p95LatencyMs ?? UNAVAILABLE} ms`,
      targetSection: 'runtimes/api',
    };
  }

  /** Xây dựng bản đồ sức khỏe (Health Map) cho các dịch vụ và runtime */
  private buildHealthMap(ctx: OverviewContext): HealthMapItemDto[] {
    const { database } = this.configService;
    /** Lấy thông tin định nghĩa của package theo mã định danh */
    const pkg = (id: string) => ctx.packages.find((p) => p.packageId === id);
    const cachePackage = pkg(CorePackageId.CACHE);
    const storagePackage = pkg(CorePackageId.STORAGE);
    const storageObjects = storagePackage?.statusReport.metrics['objects'];
    const storageBytes = storagePackage?.statusReport.metrics['bytes'];
    const messagingPackage = pkg(CorePackageId.MESSAGING);
    const messagingBacklog = messagingPackage?.statusReport.metrics['backlog'];
    const messagingDeadLetter = messagingPackage?.statusReport.metrics['deadLetter'];
    const securityPackage = pkg(CorePackageId.SECURITY);
    const cacheKeys = cachePackage?.statusReport.metrics['keys'];
    const cacheHitRate = cachePackage?.statusReport.metrics['hitRatePercent'];
    /** Tạo đối tượng mô tả runtime item cho System Console */
    const runtimeItem = (id: 'worker' | 'scheduler'): HealthMapItemDto => {
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
      };
    };

    return [
      this.apiItem(ctx),
      this.trafficItem(ctx),
      this.performanceItem(ctx),
      runtimeItem('worker'),
      runtimeItem('scheduler'),
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
      },
      {
        id: 'infra-storage',
        name: this.i18n.t('overview.map.storage.name'),
        category: 'infrastructure',
        status: toHealthMapStatus(storagePackage?.statusReport.status),
        subtext: storagePackage?.statusReport.summary ?? UNAVAILABLE,
        secondarySubtext: this.i18n.t('overview.map.storage.subtext', {
          driver: String(storagePackage?.statusReport.metrics['product'] ?? UNAVAILABLE),
        }),
        metric:
          typeof storageObjects === 'number' && typeof storageBytes === 'number'
            ? this.i18n.t('overview.map.storage.metric', {
                objects: storageObjects,
                size: `${(storageBytes / 1024 ** 2).toFixed(1)} MB`,
              })
            : this.i18n.t('overview.map.storage.secondary'),
        targetSection: 'storage',
      },
      {
        id: 'infra-messaging',
        name: this.i18n.t('overview.map.messaging.name'),
        category: 'infrastructure',
        status: toHealthMapStatus(messagingPackage?.statusReport.status),
        subtext: messagingPackage?.statusReport.summary ?? UNAVAILABLE,
        secondarySubtext: this.i18n.t('overview.map.messaging.subtext'),
        metric:
          typeof messagingBacklog === 'number' && typeof messagingDeadLetter === 'number'
            ? this.i18n.t('overview.map.messaging.metric', {
                backlog: messagingBacklog,
                deadLetter: messagingDeadLetter,
              })
            : this.i18n.t('overview.map.messaging.secondary'),
        targetSection: 'messaging',
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
      },
    ];
  }

  /** Tổng hợp danh sách các sự cố đang diễn ra cần chú ý */
  private buildIncidents(ctx: OverviewContext): ActiveIncidentItemDto[] {
    return ctx.problems.map((p) => ({
      id: `incident-${p.key}`,
      severity: p.severity === 'error' ? 'critical' : 'warning',
      title: this.i18n.t('overview.incident.title', { name: p.name }),
      description: p.description,
      ...(p.since ? { startedAt: p.since.toISOString() } : {}),
      targetSection: p.section,
    }));
  }
}

/** Ánh xạ trạng thái hoạt động sang trạng thái hiển thị trên bản đồ sức khỏe */
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
