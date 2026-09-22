import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  AGE_BUCKETS,
  OBJECT_KINDS,
  StorageConnectionService,
  StorageMonitoringService,
  StorageOperationError,
  StorageOperationsService,
  containerMetric,
  growthSince,
  isTextual,
  isValidKey,
  kindOf,
  pointAtOrBefore,
  type ObjectFilter,
  type OperationContext,
  type StorageErrorKind,
  type StorageErrorRecord,
  type StorageEventRecord,
  type StorageOp,
  type StorageOperationRecord,
  type UsagePoint,
  type UsageSnapshot,
} from '@packages/storage/index.js';
import { TELEMETRY_TIERS, type MetricBucket } from '@packages/telemetry/index.js';
import {
  changePercent,
  counterOf,
  gaugeWindow,
  mergedOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import { TrafficStoreService, statsOf, totalOf } from '@modules/traffic/index.js';
import { redactPayload } from '@packages/traffic/utils/capture.js';
import {
  STORAGE_OPS,
  StorageMetricsService,
  opsOf,
  type MetricWindow,
} from './storage-metrics.service.js';
import { StorageStoreService } from './storage-store.service.js';
import { RULE_TAB, type StorageRule, type StoredStorageAlert } from './storage-rules.js';
import { capacityPercent, staleOf } from './storage-monitor.service.js';
import {
  StorageActionRejectedException,
  StorageNotConnectedException,
  StorageNotFoundException,
} from '../exceptions/storage-ops.exceptions.js';
import type {
  CapacityDto,
  ContainerDetailDto,
  ContainerRowDto,
  GrowthDto,
  ObjectDetailDto,
  SectionDto,
  StorageAlertDto,
  StorageConfigDto,
  StorageContainersDto,
  StorageErrorDto,
  StorageErrorsDto,
  StorageEventDto,
  StorageHealthDto,
  StorageLifecycleDto,
  StorageMetric,
  StorageMetricsDto,
  StorageObjectsDto,
  StorageOperationDto,
  StorageOverviewDto,
  StorageRange,
  StorageReportDto,
  StorageSeriesDto,
  StorageSettingsDto,
  StorageTestDto,
  StorageTrafficDto,
  StorageUploadsDto,
  StorageUsageDto,
} from '../responses/storage-ops.response.js';

export const STORAGE_RANGES: Record<StorageRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};
export const STORAGE_METRICS: StorageMetric[] = [
  'upload',
  'download',
  'latency',
  'operations',
  'errors',
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_POINTS = 120;
const OVERVIEW_EVENTS = 8;
const OVERVIEW_CONTAINERS = 6;
const ERROR_LIST_LIMIT = 200;
const LIFECYCLE_ESTIMATE_LIMIT = 1000;
const IMPACT_WINDOW_MIN = 5;
const IMPACT_BASELINE_MIN = 60;
const ERROR_KINDS: StorageErrorKind[] = [
  'not_found',
  'permission',
  'timeout',
  'connection',
  'no_space',
  'throttled',
  'other',
];

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

type Group = { t: number; b: MetricBucket[]; seconds: number };

/**
 * Storage Monitor: health, capacity & tăng trưởng, traffic upload/download, container, object explorer,
 * upload/multipart, lifecycle, lỗi & sự kiện, thao tác có kiểm soát. Phần provider không hỗ trợ trả lý do.
 */
@Injectable()
export class StorageOpsService {
  constructor(
    private readonly connection: StorageConnectionService,
    private readonly monitoring: StorageMonitoringService,
    private readonly operations: StorageOperationsService,
    private readonly metrics: StorageMetricsService,
    private readonly store: StorageStoreService,
    private readonly traffic: TrafficStoreService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.storage;
  }

  private get largeBytes() {
    return this.cfg.largeObjectMb * 1024 * 1024;
  }

  private settings(): StorageSettingsDto {
    const c = this.cfg;
    return {
      delete: c.delete,
      download: c.download && this.monitoring.supports('download'),
      signedUrl: c.signedUrl && this.monitoring.supports('signedUrl'),
      preview: c.preview && this.monitoring.supports('preview'),
      abortUpload: c.abortUpload && this.monitoring.supports('multipart'),
      signedUrlMaxSec: c.signedUrlMaxSec,
      largeObjectBytes: this.largeBytes,
      staleUploadMin: c.staleUploadMin,
    };
  }

  // ─── Nguồn dùng chung ─────────────────────────────────────────────────────

  private async capacity(usage: UsageSnapshot | null): Promise<SectionDto<CapacityDto>> {
    const cap = await this.monitoring.section('capacity', () =>
      this.monitoring.provider.capacity(),
    );
    if (!cap.available) return cap;
    const c = cap.data;
    // Filesystem: dung lượng đã dùng của cả ổ (thật); provider khác: tổng object của storage.
    const used =
      c.source === 'filesystem' && c.totalBytes !== null && c.freeBytes !== null
        ? c.totalBytes - c.freeBytes
        : (usage?.totalBytes ?? null);
    return {
      available: true,
      data: { ...c, usedBytes: used, percent: capacityPercent(used, c.totalBytes) },
    };
  }

  private growth(usage: UsageSnapshot | null, points: UsagePoint[], now: number): GrowthDto {
    const current = usage ? { bytes: usage.totalBytes, objects: usage.totalObjects } : null;
    const since = (t: number) => (current ? growthSince(points, current, t) : null);
    const today = since(startOfDay(now));
    const dayStart = pointAtOrBefore(points, startOfDay(now));
    return {
      todayBytes: today?.bytes ?? null,
      d7Bytes: since(now - 7 * DAY)?.bytes ?? null,
      d30Bytes: since(now - 30 * DAY)?.bytes ?? null,
      todayObjects: today?.objects ?? null,
      createdToday: usage?.createdToday ?? null,
      deletedTodayEstimate:
        usage && dayStart && !usage.truncated
          ? Math.max(0, dayStart.objects + usage.createdToday - usage.totalObjects)
          : null,
    };
  }

  private containerRows(
    usage: UsageSnapshot | null,
    points: UsagePoint[],
    win: MetricWindow | null,
    now: number,
  ): ContainerRowDto[] {
    const dayAgo = points.find((p) => p.at <= now - DAY);
    return (usage?.containers ?? []).map((c) => {
      const m = this.metrics.container(win, c.name);
      const before = dayAgo?.containers[c.name];
      return {
        name: c.name,
        objects: c.objects,
        bytes: c.bytes,
        growth24hBytes: dayAgo ? c.bytes - (before?.bytes ?? 0) : null,
        createdToday: c.createdToday,
        uploadBytes: m.uploadBytes,
        downloadBytes: m.downloadBytes,
        ops: m.ops,
        errors: m.errors,
        newest: iso(c.newest),
      };
    });
  }

  private report(
    w: MetricWindow | null,
    points: UsagePoint[],
    from: number,
    to: number,
  ): StorageReportDto {
    const b = w?.buckets ?? [];
    const end = pointAtOrBefore(points, to);
    const start = pointAtOrBefore(points, from);
    return {
      usedBytes: end?.bytes ?? null,
      growthBytes: end && start && end.at > start.at ? end.bytes - start.bytes : null,
      objects: end?.objects ?? null,
      uploads: opsOf(b, 'put'),
      downloads: opsOf(b, 'get'),
      uploadedBytes: counterOf(b, 'storage.bytes.up'),
      downloadedBytes: counterOf(b, 'storage.bytes.down'),
      failedOps: counterOf(b, 'storage.errors'),
    };
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: StorageRange): Promise<StorageOverviewDto> {
    const now = Date.now();
    const len = STORAGE_RANGES[range] * MINUTE;
    const today = startOfDay(now);
    const [win, todayWin, yesterdayWin, usage, points, alerts, events, active, multipart, impact] =
      await Promise.all([
        this.metrics.window(now - len, now, now),
        this.metrics.window(today, now, now),
        this.metrics.window(today - DAY, today, now),
        this.monitoring.usage(),
        this.monitoring.points().catch(() => [] as UsagePoint[]),
        this.alerts(),
        this.eventsSince(now - DAY),
        this.monitoring.activeUploads().catch(() => []),
        this.monitoring.section('multipart', () => this.monitoring.provider.multipart()),
        this.relatedImpact(now),
      ]);
    const capacity = await this.capacity(usage);
    const up = this.metrics.transfer(win, 'up');
    const down = this.metrics.transfer(win, 'down');
    const totals = this.metrics.totals(win);
    const growth = this.growth(usage, points, now);
    const rows = this.containerRows(usage, points, win, now);
    return {
      generatedAt: new Date(now).toISOString(),
      range,
      provider: this.monitoring.provider.info(),
      environment: this.config.app.env,
      capabilities: [...this.monitoring.provider.capabilities],
      health: this.health(alerts),
      kpis: {
        usedBytes: usage?.totalBytes ?? null,
        objects: usage?.totalObjects ?? null,
        objectsTruncated: usage?.truncated ?? false,
        uploadBytesPerSec: up.bytesPerSec,
        downloadBytesPerSec: down.bytesPerSec,
        opsPerSec: totals.opsPerSec,
        errorRatePercent: totals.errorRatePercent,
        failedOps: totals.errors,
        growthTodayBytes: growth.todayBytes,
        containers: usage ? usage.containers.length : null,
      },
      capacity,
      growth,
      upload: up,
      download: down,
      operations: this.metrics.operations(win),
      topContainers: rows.slice(0, OVERVIEW_CONTAINERS),
      uploads: {
        active: active.length,
        completedPerMin: win ? round((up.ops - up.failures) / (win.seconds / 60), 2) : null,
        failed: up.failures,
        stale: multipart.available
          ? staleOf(multipart.data, this.cfg.staleUploadMin, now).length
          : null,
        multipart: multipart.available ? multipart.data.length : null,
      },
      alerts,
      relatedImpact: impact,
      report: {
        today: this.report(todayWin, points, today, now),
        yesterday: this.report(yesterdayWin, points, today - DAY, today),
      },
      events: events.slice(0, OVERVIEW_EVENTS).map((e) => this.eventDto(e)),
      usageAt: iso(usage?.at),
      usageTruncated: usage?.truncated ?? false,
      settings: this.settings(),
    };
  }

  private health(alerts: StorageAlertDto[]): StorageHealthDto {
    const s = this.connection.getStatus();
    const problems = alerts.filter((a) => a.severity !== 'info');
    const status =
      s.state === 'connected'
        ? problems.length
          ? 'degraded'
          : 'healthy'
        : s.state === 'unavailable'
          ? 'unavailable'
          : s.state === 'reconnecting'
            ? 'reconnecting'
            : 'unknown';
    const reasons =
      s.state !== 'connected'
        ? [
            {
              code: s.state,
              message: this.i18n.t(`storage.health.${s.state}`, {
                product: this.monitoring.provider.info().product,
              }),
            },
            ...(s.lastError ? [{ code: 'ERROR', message: s.lastError }] : []),
          ]
        : problems.map((a) => ({ code: a.rule, message: `${a.title}: ${a.message}` }));
    return {
      status,
      reasons,
      state: s.state,
      since: s.since,
      lastSuccessAt: s.lastSuccessAt,
      pingMs: s.lastPingMs,
      lastError: s.lastError,
    };
  }

  private async alerts(): Promise<StorageAlertDto[]> {
    const active = await this.store
      .activeAlerts()
      .catch(() => new Map<string, StoredStorageAlert>());
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...active.entries()]
      .map(([id, s]) => ({
        id,
        rule: id,
        severity: s.severity,
        title: this.i18n.t(`storage.alert.${id}.title`),
        message: this.alertMessage(id, { ...s.extra, value: s.value, threshold: s.threshold }),
        value: s.value,
        threshold: s.threshold,
        unit: s.unit,
        since: new Date(s.since).toISOString(),
        tab: RULE_TAB[id as StorageRule] ?? 'overview',
        container:
          typeof s.extra['container'] === 'string' && s.extra['container']
            ? s.extra['container']
            : null,
      }))
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private alertMessage(rule: string, p: Record<string, unknown>): string {
    const value = Number(p['value'] ?? 0);
    const threshold = Number(p['threshold'] ?? 0);
    const bytesRule = rule === 'RAPID_GROWTH' || rule === 'LARGE_OBJECT';
    return this.i18n.t(`storage.alert.${rule}.message`, {
      value: bytesRule ? formatBytes(value) : value,
      threshold: bytesRule ? formatBytes(threshold) : threshold,
      key: String(p['key'] ?? ''),
      container: String(p['container'] ?? ''),
      containerBytes: formatBytes(Number(p['containerBytes'] ?? 0)),
      bytes: formatBytes(Number(p['bytes'] ?? 0)),
    });
  }

  private async relatedImpact(now: number): Promise<StorageOverviewDto['relatedImpact']> {
    const winFrom = now - IMPACT_WINDOW_MIN * MINUTE;
    const baseFrom = winFrom - IMPACT_BASELINE_MIN * MINUTE;
    const [perf, instances] = await Promise.all([
      this.metrics.window(winFrom, now, now, 's10'),
      this.traffic.instances(baseFrom).catch(() => [] as string[]),
    ]);
    const [cur, base] = await Promise.all([
      this.traffic.buckets('s10', winFrom, now, instances).catch(() => []),
      this.traffic.buckets('s10', baseFrom, winFrom, instances).catch(() => []),
    ]);
    const p95 = (b: typeof cur, seconds: number) => {
      const agg = totalOf(b, () => true);
      return agg.n > 0 ? statsOf(agg, seconds).p95LatencyMs : null;
    };
    const current = p95(cur, IMPACT_WINDOW_MIN * 60);
    const baseline = p95(base, IMPACT_BASELINE_MIN * 60);
    return {
      apiP95Ms: { current, baseline, changePercent: changePercent(current, baseline) },
      queueWaiting: gaugeWindow(perf?.buckets ?? [], 'queue.waiting').current,
    };
  }

  // ─── Chart / Traffic ──────────────────────────────────────────────────────

  private async series(
    range: StorageRange,
    defs: { id: string; unit: string; value: (g: Group) => number | null }[],
  ): Promise<{ series: StorageSeriesDto[]; resolutionSec: number | null }> {
    const now = Date.now();
    const win = await this.metrics.window(now - STORAGE_RANGES[range] * MINUTE, now, now);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const size = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));
    const groups: Group[] = [];
    for (let i = 0; i < buckets.length; i += size) {
      const b = buckets.slice(i, i + size);
      groups.push({
        t: b[0]!.start,
        b,
        seconds: Math.max(1, Math.min(b.length * tierSec, (now - b[0]!.start) / 1000)),
      });
    }
    return {
      resolutionSec: win ? tierSec : null,
      series: defs.map((d) => ({
        id: d.id,
        label: this.i18n.t(`storage.series.${d.id}`),
        unit: d.unit,
        points: groups
          .map((g) => ({ t: g.t, value: d.value(g) }))
          .filter(
            (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
          )
          .map((p) => ({ t: p.t, value: round(p.value, 3) })),
      })),
    };
  }

  public async getMetrics(range: StorageRange, metric: StorageMetric): Promise<StorageMetricsDto> {
    const perSec = (name: string) => (g: Group) => counterOf(g.b, name) / g.seconds;
    const perMin = (fn: (b: MetricBucket[]) => number) => (g: Group) => fn(g.b) / (g.seconds / 60);
    const p95 = (name: string) => (g: Group) => percentileOf(mergedOf(g.b, name), 95);
    const defs: Record<
      StorageMetric,
      { id: string; unit: string; value: (g: Group) => number | null }[]
    > = {
      upload: [
        { id: 'uploadBytes', unit: 'B/s', value: perSec('storage.bytes.up') },
        { id: 'uploadsPerMin', unit: '/min', value: perMin((b) => opsOf(b, 'put')) },
      ],
      download: [
        { id: 'downloadBytes', unit: 'B/s', value: perSec('storage.bytes.down') },
        { id: 'downloadsPerMin', unit: '/min', value: perMin((b) => opsOf(b, 'get')) },
      ],
      latency: [
        { id: 'putP95', unit: 'ms', value: p95('storage.put') },
        { id: 'getP95', unit: 'ms', value: p95('storage.get') },
        { id: 'deleteP95', unit: 'ms', value: p95('storage.delete') },
      ],
      operations: STORAGE_OPS.map((op) => ({
        id: `${op}PerMin`,
        unit: '/min',
        value: perMin((b) => opsOf(b, op)),
      })),
      errors: [
        { id: 'errorsPerMin', unit: '/min', value: perMin((b) => counterOf(b, 'storage.errors')) },
        {
          id: 'uploadErrorsPerMin',
          unit: '/min',
          value: perMin((b) => counterOf(b, 'storage.errors.put')),
        },
        {
          id: 'downloadErrorsPerMin',
          unit: '/min',
          value: perMin((b) => counterOf(b, 'storage.errors.get')),
        },
      ],
    };
    const { series, resolutionSec } = await this.series(range, defs[metric]);
    const list = series.filter((s, i) => i === 0 || s.points.length > 0);
    return { metric, range, resolutionSec, unit: list[0]?.unit ?? '', series: list };
  }

  public async getTraffic(range: StorageRange): Promise<StorageTrafficDto> {
    const now = Date.now();
    const from = now - STORAGE_RANGES[range] * MINUTE;
    const [win, errors] = await Promise.all([
      this.metrics.window(from, now, now),
      this.store.errors().catch(() => [] as StorageErrorRecord[]),
    ]);
    const b = win?.buckets ?? [];
    let http: StorageTrafficDto['http'];
    if (!this.monitoring.supports('httpStatus'))
      http = {
        available: false,
        reason: 'unsupported',
        message: this.monitoring.provider.info().product,
      };
    else {
      const counts = ['2xx', '4xx', '5xx'].map((cls) => ({
        cls,
        count: counterOf(b, `storage.http.${cls}`),
      }));
      const total = counts.reduce((s, c) => s + c.count, 0);
      const top = new Map<string, number>();
      for (const e of errors)
        if (e.at >= from && e.code) top.set(e.code, (top.get(e.code) ?? 0) + 1);
      http = {
        available: true,
        data: {
          classes: counts.map((c) => ({
            ...c,
            percent: total ? round((c.count / total) * 100, 2) : null,
          })),
          topErrors: [...top.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((a, c) => c.count - a.count)
            .slice(0, 8),
        },
      };
    }
    return {
      range,
      upload: this.metrics.transfer(win, 'up'),
      download: this.metrics.transfer(win, 'down'),
      operations: this.metrics.operations(win),
      http,
      errorsByKind: Object.fromEntries(
        ERROR_KINDS.map((k) => [k, counterOf(b, `storage.err.${k}`)]),
      ) as Record<StorageErrorKind, number>,
    };
  }

  // ─── Usage / Containers ───────────────────────────────────────────────────

  public async getUsage(): Promise<StorageUsageDto> {
    const now = Date.now();
    const [usage, points] = await Promise.all([
      this.monitoring.usage(),
      this.monitoring.points().catch(() => [] as UsagePoint[]),
    ]);
    return {
      usageAt: iso(usage?.at),
      truncated: usage?.truncated ?? false,
      scannedObjects: usage?.scannedObjects ?? null,
      totalObjects: usage?.totalObjects ?? null,
      usedBytes: usage?.totalBytes ?? null,
      capacity: await this.capacity(usage),
      growth: this.growth(usage, points, now),
      history: [...points].reverse().map((p) => ({ t: p.at, bytes: p.bytes, objects: p.objects })),
      byKind: OBJECT_KINDS.map((kind) => ({
        kind,
        ...(usage?.byKind[kind] ?? { objects: 0, bytes: 0 }),
      })),
      byAge: AGE_BUCKETS.map((bucket) => ({
        bucket,
        ...(usage?.byAge[bucket] ?? { objects: 0, bytes: 0 }),
      })),
      largest: (usage?.largest ?? []).map((o) => ({ ...o, large: o.size >= this.largeBytes })),
      largeObjectBytes: this.largeBytes,
    };
  }

  public async getContainers(range: StorageRange): Promise<StorageContainersDto> {
    const now = Date.now();
    const [usage, points, win] = await Promise.all([
      this.monitoring.usage(),
      this.monitoring.points(26).catch(() => [] as UsagePoint[]),
      this.metrics.window(now - STORAGE_RANGES[range] * MINUTE, now, now),
    ]);
    return {
      containers: this.containerRows(usage, points, win, now),
      range,
      usageAt: iso(usage?.at),
      truncated: usage?.truncated ?? false,
      location: this.monitoring.provider.info().location,
    };
  }

  public async getContainerDetail(name: string, range: StorageRange): Promise<ContainerDetailDto> {
    const now = Date.now();
    const [usage, points, win, errors] = await Promise.all([
      this.monitoring.usage(),
      this.monitoring.points().catch(() => [] as UsagePoint[]),
      this.metrics.window(now - STORAGE_RANGES[range] * MINUTE, now, now),
      this.store.errors().catch(() => [] as StorageErrorRecord[]),
    ]);
    const row = this.containerRows(usage, points, win, now).find((c) => c.name === name);
    if (!row) throw new StorageNotFoundException('storage.error.containerNotFound', { name });
    const { series } = await this.series(range, [
      {
        id: 'uploadBytes',
        unit: 'B/s',
        value: (g) => counterOf(g.b, containerMetric(name, 'bytes.up')) / g.seconds,
      },
      {
        id: 'downloadBytes',
        unit: 'B/s',
        value: (g) => counterOf(g.b, containerMetric(name, 'bytes.down')) / g.seconds,
      },
    ]);
    const usageRow = usage?.containers.find((c) => c.name === name);
    return {
      container: row,
      range,
      history: [...points]
        .reverse()
        .filter((p) => p.containers[name])
        .map((p) => ({
          t: p.at,
          bytes: p.containers[name]!.bytes,
          objects: p.containers[name]!.objects,
        })),
      byKind: OBJECT_KINDS.map((kind) => ({
        kind,
        ...(usageRow?.byKind[kind] ?? { objects: 0, bytes: 0 }),
      })).filter((k) => k.objects > 0),
      largest: (usage?.largest ?? [])
        .filter((o) => o.container === name)
        .map((o) => ({ ...o, large: o.size >= this.largeBytes })),
      recentErrors: errors
        .filter((e) => e.container === name)
        .slice(0, 20)
        .map((e) => this.errorDto(e)),
      traffic: { upload: series[0]!, download: series[1]! },
    };
  }

  // ─── Objects ──────────────────────────────────────────────────────────────

  public async getObjects(
    filter: ObjectFilter,
    cursor: string,
    count: number,
  ): Promise<StorageObjectsDto> {
    const page = await this.monitoring.section('listObjects', () =>
      this.monitoring.provider.listPage(filter, cursor, count),
    );
    return {
      objects: page.available
        ? {
            available: true,
            data: page.data.objects.map((o) => ({
              key: o.key,
              container: o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/')) : '(root)',
              kind: kindOf(o.key, o.contentType),
              size: o.size,
              lastModified: iso(o.lastModified),
            })),
          }
        : page,
      cursor: page.available ? page.data.cursor : '',
      done: page.available ? page.data.cursor === '' : true,
      examined: page.available ? page.data.examined : 0,
    };
  }

  public async getObjectDetail(key: string): Promise<ObjectDetailDto> {
    if (!isValidKey(key))
      throw new StorageActionRejectedException(
        'INVALID_KEY',
        'storage.error.INVALID_KEY',
        { key },
        400,
      );
    const res = await this.monitoring.section('listObjects', () =>
      this.monitoring.provider.detail(key),
    );
    if (!res.available) throw this.sectionError(res);
    if (!res.data) throw new StorageNotFoundException('storage.error.objectNotFound', { key });
    const d = res.data;
    const sensitive = this.cfg.sensitivePrefixes.some((p) => key.startsWith(p));
    const ct = d.contentType ?? '';
    return {
      ...d,
      lastModified: iso(d.lastModified),
      createdAt: iso(d.createdAt),
      versions: d.versions?.map((v) => ({ ...v, lastModified: iso(v.lastModified) })) ?? null,
      retention: d.retention
        ? {
            mode: d.retention.mode,
            retainUntil: iso(d.retention.retainUntil),
            legalHold: d.retention.legalHold,
            active: d.retention.legalHold || (d.retention.retainUntil ?? 0) > Date.now(),
          }
        : null,
      large: d.size >= this.largeBytes,
      sensitive,
      previewable:
        !sensitive &&
        ((d.kind === 'image' &&
          /^image\/(png|jpe?g|gif|webp|avif)$/.test(ct) &&
          d.size <= 2 * 1024 * 1024) ||
          isTextual(key, ct)),
      settings: this.settings(),
      capabilities: [...this.monitoring.provider.capabilities],
    };
  }

  // ─── Uploads / Lifecycle ──────────────────────────────────────────────────

  public async getUploads(range: StorageRange): Promise<StorageUploadsDto> {
    const now = Date.now();
    const from = now - STORAGE_RANGES[range] * MINUTE;
    const [active, multipart, errors, win] = await Promise.all([
      this.monitoring.activeUploads().catch(() => []),
      this.monitoring.section('multipart', () => this.monitoring.provider.multipart()),
      this.store.errors().catch(() => [] as StorageErrorRecord[]),
      this.metrics.window(from, now, now),
    ]);
    const up = this.metrics.transfer(win, 'up');
    const staleMs = this.cfg.staleUploadMin * MINUTE;
    const recent = errors.filter((e) => e.at >= from);
    return {
      active: active
        .map((a) => ({
          ...a,
          startedAtIso: new Date(a.startedAt).toISOString(),
          ageSec: Math.max(0, Math.round((now - a.startedAt) / 1000)),
          percent: a.size ? round((a.sentBytes / a.size) * 100, 1) : null,
        }))
        .sort((a, b) => a.startedAt - b.startedAt),
      multipart: multipart.available
        ? {
            available: true,
            data: multipart.data
              .map((u) => ({
                ...u,
                initiated: iso(u.initiated),
                ageMin: u.initiated === null ? null : Math.round((now - u.initiated) / MINUTE),
                stale: u.initiated !== null && now - u.initiated >= staleMs,
              }))
              .sort((a, b) => (b.ageMin ?? 0) - (a.ageMin ?? 0)),
          }
        : multipart,
      failedUploads: recent
        .filter((e) => e.op === 'put')
        .slice(0, 50)
        .map((e) => this.errorDto(e)),
      failedDownloads: recent
        .filter((e) => e.op === 'get')
        .slice(0, 50)
        .map((e) => this.errorDto(e)),
      completedPerMin:
        up.opsPerMin === null || !win
          ? null
          : round(Math.max(0, (up.ops - up.failures) / (win.seconds / 60)), 2),
      avgUploadMs: up.avgMs,
      staleUploadMin: this.cfg.staleUploadMin,
      abortEnabled: this.settings().abortUpload,
    };
  }

  public async getLifecycle(): Promise<StorageLifecycleDto> {
    const lifecycle = await this.monitoring.section('lifecycle', () =>
      this.monitoring.provider.lifecycle(),
    );
    let estimate: StorageLifecycleDto['estimate'] = null;
    if (lifecycle.available) {
      // Ước tính: quét (có giới hạn) prefix của từng rule expire, đếm object đã quá số ngày của rule.
      estimate = [];
      for (const r of lifecycle.data.rules.filter((x) => x.status === 'enabled'))
        for (const a of r.actions.filter((x) => x.type === 'expire' && x.days !== null)) {
          const page = await this.monitoring.provider
            .listPage(
              {
                container: null,
                prefix: r.prefix,
                kind: null,
                minSize: null,
                maxSize: null,
                minAgeMs: a.days! * DAY,
                maxAgeMs: null,
              },
              '',
              LIFECYCLE_ESTIMATE_LIMIT,
            )
            .catch(() => null);
          if (page)
            estimate.push({
              rule: r.id,
              prefix: r.prefix,
              days: a.days!,
              objects: page.objects.length,
              bytes: page.objects.reduce((sum, o) => sum + o.size, 0),
              capped: page.cursor !== '',
            });
        }
    }
    return { lifecycle, estimate };
  }

  // ─── Errors / Events / Operations / Config ────────────────────────────────

  public async getErrors(range: StorageRange): Promise<StorageErrorsDto> {
    const now = Date.now();
    const from = now - STORAGE_RANGES[range] * MINUTE;
    const [errors, win] = await Promise.all([
      this.store.errors().catch(() => [] as StorageErrorRecord[]),
      this.metrics.window(from, now, now),
    ]);
    const b = win?.buckets ?? [];
    const recent = errors.filter((e) => e.at >= from);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [
        k,
        win ? counterOf(b, `storage.err.${k}`) : recent.filter((e) => e.kind === k).length,
      ]),
    ) as Record<StorageErrorKind, number>;
    const byOp = Object.fromEntries(
      STORAGE_OPS.map((op) => [op, counterOf(b, `storage.errors.${op}`)]),
    ) as Record<StorageOp, number>;
    return {
      counts,
      byOp,
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      items: recent.slice(0, ERROR_LIST_LIMIT).map((e) => this.errorDto(e)),
      range,
    };
  }

  public async getEvents(range: StorageRange): Promise<StorageEventDto[]> {
    return (await this.eventsSince(Date.now() - STORAGE_RANGES[range] * MINUTE)).map((e) =>
      this.eventDto(e),
    );
  }

  public async getOperations(): Promise<StorageOperationDto[]> {
    const ops = await this.store.operations().catch(() => [] as StorageOperationRecord[]);
    return ops.map((o) => ({ ...o, at: new Date(o.at).toISOString() }));
  }

  public getConfig(): StorageConfigDto {
    const c = this.cfg;
    const info = this.monitoring.provider.info();
    const s3 = info.driver === 's3';
    const hasCreds = Boolean(
      process.env[c.s3.accessKeySecret] || process.env[c.s3.secretKeySecret],
    );
    return {
      items: [
        { group: 'provider', key: 'driver', value: info.driver },
        { group: 'provider', key: 'product', value: info.product },
        ...(s3
          ? [
              { group: 'connection', key: 'endpoint', value: c.s3.endpoint ?? 'AWS' },
              { group: 'connection', key: 'region', value: c.s3.region },
              { group: 'connection', key: 'bucket', value: c.s3.bucket },
              { group: 'connection', key: 'forcePathStyle', value: c.s3.forcePathStyle },
              { group: 'connection', key: 'timeoutMs', value: c.s3.timeoutMs },
              { group: 'connection', key: 'credentials', value: hasCreds, sensitive: true },
              {
                group: 'connection',
                key: 'credentialsSource',
                value: process.env['SECRET_DRIVER'] || 'env',
              },
            ]
          : [{ group: 'connection', key: 'root', value: info.location }]),
        { group: 'behavior', key: 'capacityGb', value: c.capacityGb || null },
        { group: 'behavior', key: 'scanMaxObjects', value: c.scanMaxObjects },
        { group: 'behavior', key: 'staleUploadMin', value: c.staleUploadMin },
        { group: 'behavior', key: 'largeObjectMb', value: c.largeObjectMb },
        { group: 'behavior', key: 'sensitivePrefixes', value: c.sensitivePrefixes.join(', ') },
        { group: 'behavior', key: 'signedUrlMaxSec', value: c.signedUrlMaxSec },
        { group: 'thresholds', key: 'capacityWarnPercent', value: c.rules.capacityWarnPercent },
        { group: 'thresholds', key: 'capacityCritPercent', value: c.rules.capacityCritPercent },
        { group: 'thresholds', key: 'growthFactor', value: c.rules.growthFactor },
        { group: 'thresholds', key: 'failureRatePercent', value: c.rules.failureRatePercent },
        { group: 'thresholds', key: 'putP95Ms', value: c.rules.putP95Ms },
        { group: 'thresholds', key: 'staleUploads', value: c.rules.staleUploads },
        { group: 'actions', key: 'delete', value: c.delete },
        { group: 'actions', key: 'download', value: c.download },
        { group: 'actions', key: 'signedUrl', value: c.signedUrl },
        { group: 'actions', key: 'preview', value: c.preview },
        { group: 'actions', key: 'abortUpload', value: c.abortUpload },
      ],
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public async test(ctx: OperationContext): Promise<StorageTestDto> {
    return { ...(await this.operations.test(ctx)), at: new Date().toISOString() };
  }

  public async deleteObject(key: string, versionId: string | null, ctx: OperationContext) {
    return this.act(() => this.operations.deleteObject(key, versionId, ctx));
  }

  public async signedUrl(key: string, ttlSec: number, ctx: OperationContext) {
    return this.act(() => this.operations.signedUrl(key, ttlSec, ctx));
  }

  public async preview(key: string, ctx: OperationContext) {
    const res = await this.act(() => this.operations.preview(key, ctx));
    if (res.kind !== 'text') return res;
    // JSON được redact theo tên field + che email; text thường giữ nguyên (đã giới hạn 4 KB).
    if (res.contentType.includes('json') && !res.truncated) {
      try {
        return {
          ...res,
          text: JSON.stringify(redactPayload(JSON.parse(res.text)), null, 2),
          redacted: true,
        };
      } catch {
        /* JSON hỏng → giữ text */
      }
    }
    return { ...res, redacted: false };
  }

  public download(key: string, ctx: OperationContext) {
    return this.act(() => this.operations.download(key, ctx));
  }

  public async abortUpload(key: string, uploadId: string, ctx: OperationContext) {
    return this.act(() => this.operations.abortUpload(key, uploadId, ctx));
  }

  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  private async eventsSince(from: number): Promise<StorageEventRecord[]> {
    return (await this.store.events().catch(() => [] as StorageEventRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  private eventDto(e: StorageEventRecord): StorageEventDto {
    const rule = typeof e.params['rule'] === 'string' ? e.params['rule'] : null;
    const title = rule ? this.i18n.t(`storage.alert.${rule}.title`) : '';
    const message =
      e.type === 'alert_started' && rule
        ? `${title}: ${this.alertMessage(rule, e.params)}`
        : this.i18n.t(`storage.event.${e.type}`, {
            ...e.params,
            size: typeof e.params['size'] === 'number' ? formatBytes(e.params['size']) : '',
            alert: title,
          });
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      runtime: e.runtime,
      tab: rule
        ? (RULE_TAB[rule as StorageRule] ?? null)
        : e.type.startsWith('connection')
          ? 'overview'
          : e.type === 'upload_aborted'
            ? 'uploads'
            : 'operations',
    };
  }

  private errorDto(e: StorageErrorRecord): StorageErrorDto {
    return { ...e, at: new Date(e.at).toISOString() };
  }

  private sectionError(s: Extract<SectionDto<unknown>, { available: false }>): Error {
    if (s.reason === 'disconnected')
      return new StorageNotConnectedException(s.message ?? 'unknown');
    if (s.reason === 'unsupported')
      return new StorageActionRejectedException(
        'UNSUPPORTED',
        'storage.error.UNSUPPORTED',
        { product: s.message ?? '' },
        422,
      );
    return new StorageActionRejectedException(
      'READ_FAILED',
      'storage.error.readFailed',
      { message: s.message ?? '' },
      502,
    );
  }

  private operationError(err: unknown): Error {
    if (!(err instanceof StorageOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new StorageNotConnectedException(this.connection.getStatus().state);
      case 'NOT_FOUND':
        return new StorageNotFoundException('storage.error.objectNotFound', {
          key: err.params['key'] ?? err.message,
        });
      case 'INVALID_KEY':
      case 'INVALID_TTL':
        return new StorageActionRejectedException(
          err.code,
          `storage.error.${err.code}`,
          { ...err.params, key: err.message },
          400,
        );
      case 'UNSUPPORTED':
        return new StorageActionRejectedException(
          err.code,
          'storage.error.UNSUPPORTED',
          { product: this.monitoring.provider.info().product },
          422,
        );
      case 'FAILED':
        return new StorageActionRejectedException(
          'ACTION_FAILED',
          'storage.error.FAILED',
          { message: err.message },
          502,
        );
      default:
        return new StorageActionRejectedException(err.code, `storage.error.${err.code}`, {
          ...err.params,
        });
    }
  }
}
