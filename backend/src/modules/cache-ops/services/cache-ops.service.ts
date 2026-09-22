import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  CacheConnectionService,
  CacheMonitoringService,
  CacheOperationError,
  CacheOperationsService,
  cacheKeys,
  matchesNamespace,
  namespaceMetric,
  namespaceOf,
  type CacheErrorKind,
  type CacheErrorRecord,
  type CacheEventRecord,
  type CacheOperationRecord,
  type KeyFilter,
  type KeyspaceSnapshot,
  type LargeKey,
  type OperationContext,
  type ServerInfo,
  type ValueSample,
} from '@packages/cache/index.js';
import { TELEMETRY_TIERS, type MetricBucket } from '@packages/telemetry/index.js';
import { changePercent, counterOf, gaugeOf, mergedOf, round } from '@modules/performance/index.js';
import { TrafficStoreService, statsOf, totalOf } from '@modules/traffic/index.js';
import { redactPayload } from '@packages/traffic/utils/capture.js';
import {
  CacheMetricsService,
  hitRate,
  type CacheWindowStats,
  type MetricWindow,
} from './cache-metrics.service.js';
import { CacheStoreService } from './cache-store.service.js';
import { RULE_TAB, type CacheRule, type StoredCacheAlert } from './cache-rules.js';
import { memoryUsage } from './cache-monitor.service.js';
import {
  CacheActionRejectedException,
  CacheNotConnectedException,
  CacheNotFoundException,
} from '../exceptions/cache-ops.exceptions.js';
import type {
  CacheAlertDto,
  CacheClientsDto,
  CacheConfigDto,
  CacheErrorsDto,
  CacheEventDto,
  CacheHealthDto,
  CacheHealthStatus,
  CacheKeysDto,
  CacheMemoryDto,
  CacheMetric,
  CacheMetricsDto,
  CacheNamespacesDto,
  CacheOperationDto,
  CacheOverviewDto,
  CacheRange,
  CacheReportDto,
  CacheSeriesDto,
  CacheTtlDto,
  FlushImpactDto,
  ImpactItemDto,
  KeyDetailDto,
  KeyspaceSummaryDto,
  LargeKeyDto,
  NamespaceDetailDto,
  NamespaceRowDto,
  PingResultDto,
  RelatedImpactDto,
  SectionDto,
  ServerMemoryDto,
} from '../responses/cache-ops.response.js';

export const CACHE_RANGES: Record<CacheRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};
export const CACHE_METRICS: CacheMetric[] = [
  'hitRate',
  'reads',
  'operations',
  'memory',
  'keys',
  'evictions',
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_POINTS = 120;
const OVERVIEW_EVENTS = 8;
const OVERVIEW_NAMESPACES = 6;
const ERROR_LIST_LIMIT = 200;
/** Snapshot keyspace cũ hơn mức này thì quét lại khi đọc. */
const KEYSPACE_MAX_AGE_MS = 90_000;
const IMPACT_WINDOW_MIN = 5;
const IMPACT_BASELINE_MIN = 60;
/** Baseline hit rate = 60 phút trước cửa sổ hiện tại (bucket 1 phút, không chồng lên 5 phút gần nhất). */
const BASELINE_MIN = 60;
const PREVIEW_MAX_BYTES = 2048;
const PREVIEW_MAX_ITEMS = 50;
const ERROR_KINDS: CacheErrorKind[] = ['connection', 'timeout', 'command', 'oom', 'serialization'];

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

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

/**
 * Cache Monitor: hiệu quả (hit/miss có baseline), keyspace/namespace/TTL, bộ nhớ, eviction, kết nối,
 * lỗi & sự kiện, và thao tác đúng phạm vi (xoá key → clear namespace → flush).
 * Mỗi phần có thể không có (driver không hỗ trợ / mất kết nối) mà không làm hỏng các phần khác.
 */
@Injectable()
export class CacheOpsService {
  constructor(
    private readonly connection: CacheConnectionService,
    private readonly monitoring: CacheMonitoringService,
    private readonly operations: CacheOperationsService,
    private readonly metrics: CacheMetricsService,
    private readonly store: CacheStoreService,
    private readonly traffic: TrafficStoreService,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.cache;
  }

  // ─── Nguồn dùng chung ─────────────────────────────────────────────────────

  /** Snapshot keyspace: bản collector lưu (nếu còn mới) hoặc quét lại. */
  private async keyspace(): Promise<KeyspaceSnapshot | null> {
    const stored = await this.monitoring.storedKeyspace().catch(() => null);
    if (stored && Date.now() - stored.at <= KEYSPACE_MAX_AGE_MS) return stored;
    if (!this.monitoring.usable()) return stored;
    return this.monitoring.refreshKeyspace().catch(() => stored);
  }

  private summary(k: KeyspaceSnapshot | null): KeyspaceSummaryDto | null {
    if (!k) return null;
    return {
      at: new Date(k.at).toISOString(),
      totalKeys: k.totalKeys,
      scannedKeys: k.scannedKeys,
      truncated: k.truncated,
      totalBytes: k.totalBytes,
      bytesPartial: k.bytesPartial,
      persistent: k.persistent,
      expiring: k.expiring,
      avgTtlMs: k.avgTtlMs,
      expiringNext60s: k.expiringNext60s,
      ttlDistribution: k.ttlDistribution,
      durationMs: k.durationMs,
    };
  }

  private serverSection(): Promise<SectionDto<ServerInfo>> {
    return this.monitoring.section('serverStats', () => this.monitoring.provider.serverInfo());
  }

  private serverMemory(s: ServerInfo): ServerMemoryDto {
    return {
      usedBytes: s.usedMemory,
      peakBytes: s.peakMemory,
      maxBytes: s.maxMemory,
      percent:
        s.maxMemory && s.usedMemory !== null ? round((s.usedMemory / s.maxMemory) * 100, 1) : null,
      policy: s.maxMemoryPolicy,
      fragmentationRatio: s.fragmentationRatio,
      rssBytes: s.rssMemory,
    };
  }

  private isSession(ns: string) {
    return matchesNamespace(ns, this.cfg.sessionNamespaces);
  }

  private isSensitive(ns: string) {
    return this.isSession(ns) || matchesNamespace(ns, this.cfg.sensitiveNamespaces);
  }

  private namespaceRows(k: KeyspaceSnapshot | null, win: MetricWindow | null): NamespaceRowDto[] {
    const counters = this.metrics.namespaces(win);
    const names = new Set([...(k?.namespaces.map((n) => n.name) ?? []), ...counters.keys()]);
    return [...names]
      .map((name) => {
        const s = k?.namespaces.find((n) => n.name === name);
        const c = counters.get(name) ?? { hits: 0, misses: 0, sets: 0, deletes: 0 };
        const reads = c.hits + c.misses;
        const rate = hitRate(c.hits, reads);
        const low =
          reads >= this.cfg.rules.minReads &&
          rate !== null &&
          rate < this.cfg.rules.hitRateWarnPercent;
        return {
          name,
          keys: s?.keys ?? 0,
          bytes: s?.bytes ?? 0,
          persistent: s?.persistent ?? 0,
          avgTtlMs: s?.avgTtlMs ?? null,
          expiringSoon: s?.expiringSoon ?? 0,
          hits: c.hits,
          misses: c.misses,
          hitRatePercent: rate,
          sets: c.sets,
          session: this.isSession(name),
          sensitive: this.isSensitive(name),
          alert: low ? 'lowHitRate' : null,
        };
      })
      .sort((a, b) => b.keys - a.keys || b.hits + b.misses - (a.hits + a.misses));
  }

  private largeKeyDto(k: LargeKey): LargeKeyDto {
    return { ...k, large: k.bytes >= this.cfg.rules.largeKeyBytes };
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: CacheRange): Promise<CacheOverviewDto> {
    const now = Date.now();
    const len = CACHE_RANGES[range] * MINUTE;
    const today = startOfDay(now);
    const [
      win,
      hrNow,
      hrBase,
      todayWin,
      yesterdayWin,
      keyspace,
      server,
      clients,
      alerts,
      events,
      impact,
    ] = await Promise.all([
      this.metrics.window(now - len, now, now),
      this.metrics.window(now - IMPACT_WINDOW_MIN * MINUTE, now, now, 's10'),
      this.metrics.window(
        now - (IMPACT_WINDOW_MIN + BASELINE_MIN) * MINUTE,
        now - IMPACT_WINDOW_MIN * MINUTE,
        now,
        'm1',
      ),
      this.metrics.window(today, now, now),
      this.metrics.window(today - DAY, today, now),
      this.keyspace(),
      this.serverSection(),
      this.monitoring.section('clients', () => this.monitoring.provider.clients()),
      this.alerts(),
      this.eventsSince(now - DAY),
      this.relatedImpact(now),
    ]);
    const stats = this.metrics.stats(win);
    const cur = this.metrics.stats(hrNow);
    const base = this.metrics.stats(hrBase);
    const serverData = server.available ? server.data : null;
    const mem = memoryUsage(serverData, keyspace?.totalBytes ?? null, this.cfg.memoryLimitMb);
    const rows = this.namespaceRows(keyspace, win);
    const largestNs = [...(keyspace?.namespaces ?? [])].sort((a, b) => b.bytes - a.bytes)[0];
    const minutes = win ? win.seconds / 60 : null;
    const enough = cur.reads >= this.cfg.rules.minReads;
    const baseline = base.reads >= this.cfg.rules.minReads ? base.hitRatePercent : null;

    return {
      generatedAt: new Date(now).toISOString(),
      range,
      driver: this.monitoring.driver,
      environment: this.config.app.env,
      capabilities: [...this.monitoring.provider.capabilities],
      health: await this.health(alerts),
      kpis: {
        hitRatePercent: stats.hitRatePercent,
        missRatePercent: stats.missRatePercent,
        hits: stats.hits,
        misses: stats.misses,
        opsPerSec: stats.opsPerSec,
        getsPerSec: stats.getsPerSec,
        setsPerSec: stats.setsPerSec,
        deletesPerSec: stats.deletesPerSec,
        avgOpMs: stats.avgOpMs,
        p95OpMs: stats.p95OpMs,
        errors: stats.errors,
        keys: keyspace?.totalKeys ?? null,
        keysTruncated: keyspace?.truncated ?? false,
        memory: {
          cacheBytes: keyspace ? keyspace.totalBytes : null,
          limitBytes: mem.limitBytes,
          limitSource: mem.source,
          percent: mem.percent,
        },
        evictionsPerMin:
          stats.evicted !== null && minutes ? round(stats.evicted / minutes, 2) : null,
        evictedInRange: stats.evicted,
        expiredPerMin: stats.expired !== null && minutes ? round(stats.expired / minutes, 2) : null,
        connections: clients.available ? clients.data.length : null,
        serverOpsPerSec: serverData?.opsPerSec ?? null,
      },
      hitRate: {
        currentPercent: cur.hitRatePercent,
        baselinePercent: baseline,
        changePoints:
          cur.hitRatePercent !== null && baseline !== null
            ? round(cur.hitRatePercent - baseline, 1)
            : null,
        reads: cur.reads,
        status: !enough
          ? 'insufficient'
          : (cur.hitRatePercent ?? 100) < this.cfg.rules.hitRateWarnPercent ||
              (baseline !== null &&
                baseline - (cur.hitRatePercent ?? 100) >= this.cfg.rules.hitRateDropPoints)
            ? 'low'
            : 'normal',
      },
      alerts,
      keyspace: this.summary(keyspace),
      topNamespaces: rows.slice(0, OVERVIEW_NAMESPACES),
      server: server.available ? { available: true, data: this.serverMemory(server.data) } : server,
      largestNamespace: largestNs ? { name: largestNs.name, bytes: largestNs.bytes } : null,
      relatedImpact: impact,
      report: {
        today: this.report(this.metrics.stats(todayWin)),
        yesterday: this.report(this.metrics.stats(yesterdayWin)),
      },
      events: events.slice(0, OVERVIEW_EVENTS).map((e) => this.eventDto(e)),
      settings: {
        actionsEnabled: this.cfg.actionsEnabled,
        flushEnabled: this.cfg.flushEnabled,
        valuePreview: this.cfg.valuePreview,
        largeKeyBytes: this.cfg.rules.largeKeyBytes,
        expirySpikeKeys: this.cfg.rules.expirySpikeKeys,
        hitRateWarnPercent: this.cfg.rules.hitRateWarnPercent,
      },
    };
  }

  private async health(alerts: CacheAlertDto[]): Promise<CacheHealthDto> {
    const status = this.connection.getStatus();
    let pingMs: number | null = null;
    if (status.state === 'connected') {
      pingMs = await this.monitoring.provider.ping().catch(() => null);
      if (pingMs !== null) this.connection.markSuccess();
    }
    const fresh = this.connection.getStatus();
    const problems = alerts.filter((a) => a.severity !== 'info');
    const state: CacheHealthStatus =
      fresh.state === 'connected'
        ? problems.length
          ? 'degraded'
          : 'healthy'
        : fresh.state === 'unavailable'
          ? 'unavailable'
          : fresh.state === 'reconnecting'
            ? 'reconnecting'
            : 'unknown';
    const reasons =
      fresh.state !== 'connected'
        ? [
            { code: fresh.state, message: this.i18n.t(`cache.health.${fresh.state}`) },
            ...(fresh.lastError ? [{ code: 'ERROR', message: fresh.lastError }] : []),
          ]
        : problems.map((a) => ({ code: a.rule, message: `${a.title}: ${a.message}` }));
    return {
      status: state,
      reasons,
      state: fresh.state,
      since: fresh.since,
      lastSuccessAt: fresh.lastSuccessAt,
      pingMs,
      lastError: fresh.lastError,
    };
  }

  private async alerts(): Promise<CacheAlertDto[]> {
    const active = await this.store.activeAlerts().catch(() => new Map<string, StoredCacheAlert>());
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...active.entries()]
      .map(([id, s]) => ({
        id,
        rule: s.rule,
        severity: s.severity,
        title: this.i18n.t(`cache.alert.${s.rule}.title`),
        message: this.alertMessage(s.rule, {
          ...s.extra,
          value: s.value,
          threshold: s.threshold,
          namespace: s.namespace ?? s.extra['namespace'] ?? '',
        }),
        value: s.value,
        threshold: s.threshold,
        unit: s.unit,
        since: new Date(s.since).toISOString(),
        tab: RULE_TAB[s.rule] ?? 'overview',
        namespace: s.namespace,
      }))
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  /** Câu mô tả cảnh báo; `p` gồm value/threshold/namespace và tham số thêm của rule (key, dbChange…). */
  private alertMessage(rule: string, p: Record<string, unknown>): string {
    const value = Number(p['value'] ?? 0);
    const threshold = Number(p['threshold'] ?? 0);
    const dbChange = p['dbChange'];
    return this.i18n.t(`cache.alert.${rule}.message`, {
      value,
      threshold,
      namespace: String(p['namespace'] ?? ''),
      key: String(p['key'] ?? ''),
      size: rule === 'LARGE_KEY' ? formatBytes(value) : '',
      limit: rule === 'LARGE_KEY' ? formatBytes(threshold) : '',
      dbChange:
        dbChange !== undefined && dbChange !== ''
          ? this.i18n.t('cache.alert.MISS_STORM.dbImpact', { change: Number(dbChange) })
          : '',
    });
  }

  private async relatedImpact(now: number): Promise<RelatedImpactDto> {
    const winFrom = now - IMPACT_WINDOW_MIN * MINUTE;
    const baseFrom = winFrom - IMPACT_BASELINE_MIN * MINUTE;
    const [cur, base, httpInstances] = await Promise.all([
      this.metrics.window(winFrom, now, now, 's10'),
      this.metrics.window(baseFrom, winFrom, now, 's10'),
      this.traffic.instances(baseFrom).catch(() => [] as string[]),
    ]);
    const [httpCur, httpBase] = await Promise.all([
      this.traffic.buckets('s10', winFrom, now, httpInstances).catch(() => []),
      this.traffic.buckets('s10', baseFrom, winFrom, httpInstances).catch(() => []),
    ]);
    const qps = (w: MetricWindow | null) => {
      const n = mergedOf(w?.buckets ?? [], 'db.query').n;
      return w && n > 0 ? round(n / w.seconds, 3) : null;
    };
    const p95 = (b: typeof httpCur, seconds: number) => {
      const agg = totalOf(b, () => true);
      return agg.n > 0 ? statsOf(agg, seconds).p95LatencyMs : null;
    };
    const item = (
      current: number | null,
      baseline: number | null,
      unit: string,
    ): ImpactItemDto => ({
      current,
      baseline,
      changePercent: changePercent(current, baseline),
      unit,
    });
    const statsCur = this.metrics.stats(cur);
    const statsBase = this.metrics.stats(base);
    return {
      dbQueriesPerSec: item(qps(cur), qps(base), '/s'),
      apiP95Ms: item(
        p95(httpCur, IMPACT_WINDOW_MIN * 60),
        p95(httpBase, IMPACT_BASELINE_MIN * 60),
        'ms',
      ),
      missRatePercent: item(statsCur.missRatePercent, statsBase.missRatePercent, '%'),
      windowMin: IMPACT_WINDOW_MIN,
      baselineMin: IMPACT_BASELINE_MIN,
    };
  }

  private report(s: CacheWindowStats): CacheReportDto {
    return {
      hits: s.hits,
      misses: s.misses,
      hitRatePercent: s.hitRatePercent,
      sets: s.sets,
      deletes: s.deletes,
      errors: s.errors,
      peakMemoryBytes: s.peakServerMemory,
      evictions: s.evicted,
      expired: s.expired,
      peakKeys: s.peakKeys,
    };
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  private async series(
    range: CacheRange,
    defs: { id: string; unit: string; value: (g: Group) => number | null }[],
    labelPrefix = 'cache.series',
  ): Promise<{ series: CacheSeriesDto[]; resolutionSec: number | null }> {
    const now = Date.now();
    const win = await this.metrics.window(now - CACHE_RANGES[range] * MINUTE, now, now);
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
        label: this.i18n.t(`${labelPrefix}.${d.id}`),
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

  public async getMetrics(range: CacheRange, metric: CacheMetric): Promise<CacheMetricsDto> {
    const perSec = (name: string) => (g: Group) => counterOf(g.b, name) / g.seconds;
    const perMin = (name: string) => (g: Group) => counterOf(g.b, name) / (g.seconds / 60);
    const serverPerMin = (name: string) => (g: Group) =>
      g.b.some((b) => b.metrics.has('redis.used')) ? counterOf(g.b, name) / (g.seconds / 60) : null;
    const gauge = (name: string) => (g: Group) => groupGauge(g.b, name);
    const defs: Record<
      CacheMetric,
      { id: string; unit: string; value: (g: Group) => number | null }[]
    > = {
      hitRate: [
        {
          id: 'hitRate',
          unit: '%',
          value: (g) => {
            const hits = counterOf(g.b, 'cache.hit');
            return hitRate(hits, hits + counterOf(g.b, 'cache.miss'));
          },
        },
      ],
      reads: [
        { id: 'hitsPerMin', unit: '/min', value: perMin('cache.hit') },
        { id: 'missesPerMin', unit: '/min', value: perMin('cache.miss') },
      ],
      operations: [
        {
          id: 'getsPerSec',
          unit: '/s',
          value: (g) => (counterOf(g.b, 'cache.hit') + counterOf(g.b, 'cache.miss')) / g.seconds,
        },
        { id: 'setsPerSec', unit: '/s', value: perSec('cache.set') },
        { id: 'deletesPerSec', unit: '/s', value: perSec('cache.del') },
        { id: 'errorsPerSec', unit: '/s', value: perSec('cache.errors') },
      ],
      memory: [
        { id: 'cacheBytes', unit: 'B', value: gauge('cache.bytes') },
        { id: 'serverUsed', unit: 'B', value: gauge('redis.used') },
      ],
      keys: [
        { id: 'keys', unit: '', value: gauge('cache.keys') },
        { id: 'expiring', unit: '', value: gauge('cache.expiring') },
      ],
      evictions: [
        { id: 'evictedPerMin', unit: '/min', value: serverPerMin('redis.evicted') },
        { id: 'expiredPerMin', unit: '/min', value: serverPerMin('redis.expired') },
      ],
    };
    const { series, resolutionSec } = await this.series(range, defs[metric]);
    const list = series.filter((s, i) => i === 0 || s.points.length > 0);
    return {
      metric,
      range,
      resolutionSec,
      unit: list[0]?.unit ?? '',
      series: list,
      serverWide: metric === 'evictions',
    };
  }

  // ─── Namespaces ───────────────────────────────────────────────────────────

  public async getNamespaces(range: CacheRange): Promise<CacheNamespacesDto> {
    const now = Date.now();
    const [keyspace, win] = await Promise.all([
      this.keyspace(),
      this.metrics.window(now - CACHE_RANGES[range] * MINUTE, now, now),
    ]);
    return {
      keyspace: this.summary(keyspace),
      namespaces: this.namespaceRows(keyspace, win),
      range,
      depth: this.cfg.namespaceDepth,
    };
  }

  public async getNamespaceDetail(name: string, range: CacheRange): Promise<NamespaceDetailDto> {
    const now = Date.now();
    const [keyspace, win] = await Promise.all([
      this.keyspace(),
      this.metrics.window(now - CACHE_RANGES[range] * MINUTE, now, now),
    ]);
    const row = this.namespaceRows(keyspace, win).find((n) => n.name === name);
    if (!row) throw new CacheNotFoundException('cache.error.namespaceNotFound', { name });
    const { series } = await this.series(range, [
      { id: 'keys', unit: '', value: (g) => groupGauge(g.b, namespaceMetric(name, 'keys')) },
      { id: 'bytes', unit: 'B', value: (g) => groupGauge(g.b, namespaceMetric(name, 'bytes')) },
      {
        id: 'hitsPerMin',
        unit: '/min',
        value: (g) => counterOf(g.b, namespaceMetric(name, 'hit')) / (g.seconds / 60),
      },
      {
        id: 'missesPerMin',
        unit: '/min',
        value: (g) => counterOf(g.b, namespaceMetric(name, 'miss')) / (g.seconds / 60),
      },
    ]);
    return {
      namespace: row,
      range,
      history: { keys: series[0]!, bytes: series[1]!, hits: series[2]!, misses: series[3]! },
      largestKeys: (keyspace?.largestKeys ?? [])
        .filter((k) => k.namespace === name)
        .map((k) => this.largeKeyDto(k)),
      actionsEnabled: this.cfg.actionsEnabled,
    };
  }

  // ─── Keys ─────────────────────────────────────────────────────────────────

  public async getKeys(filter: KeyFilter, cursor: string, count: number): Promise<CacheKeysDto> {
    const page = await this.monitoring.section('keyExplorer', () =>
      this.monitoring.provider.scanPage(filter, cursor, count),
    );
    const depth = this.cfg.namespaceDepth;
    return {
      keys: page.available
        ? {
            available: true,
            data: page.data.keys.map((k) => ({
              key: k.key,
              namespace: namespaceOf(k.key, depth),
              type: k.type,
              bytes: k.bytes,
              ttlMs: k.ttlMs,
            })),
          }
        : page,
      cursor: page.available ? page.data.cursor : '0',
      done: page.available ? page.data.cursor === '0' : true,
      examined: page.available ? page.data.examined : 0,
      prefix: this.monitoring.driver === 'redis' ? cacheKeys(this.redis).dataPrefix() : '',
    };
  }

  public async getKeyDetail(key: string): Promise<KeyDetailDto> {
    const info = await this.monitoring.section('keyExplorer', () =>
      this.monitoring.provider.keyInfo(key),
    );
    if (!info.available) throw this.sectionError(info);
    if (!info.data) throw new CacheNotFoundException('cache.error.keyNotFound', { key });
    const d = info.data;
    let value: KeyDetailDto['value'];
    if (!this.cfg.valuePreview) value = { state: 'hidden', reason: 'disabled' };
    else if (this.isSensitive(d.namespace) || this.isSensitive(key))
      value = { state: 'hidden', reason: 'sensitive' };
    else {
      const sample = await this.monitoring.provider
        .sample(key, PREVIEW_MAX_BYTES, PREVIEW_MAX_ITEMS)
        .catch(() => null);
      if (!sample) value = { state: 'hidden', reason: 'unsupported' };
      else {
        const redacted = redactSample(sample);
        value = {
          state: 'shown',
          sample: redacted,
          redacted: JSON.stringify(redacted.value) !== JSON.stringify(sample.value),
        };
      }
    }
    return {
      key: d.key,
      fullKey: this.monitoring.driver === 'redis' ? cacheKeys(this.redis).data(d.key) : d.key,
      namespace: d.namespace,
      type: d.type,
      ttlMs: d.ttlMs,
      bytes: d.bytes,
      encoding: d.encoding,
      length: d.length,
      large: d.bytes !== null && d.bytes >= this.cfg.rules.largeKeyBytes,
      value,
      actionsEnabled: this.cfg.actionsEnabled,
    };
  }

  // ─── Memory / TTL / Clients ───────────────────────────────────────────────

  public async getMemory(range: CacheRange): Promise<CacheMemoryDto> {
    const now = Date.now();
    const [keyspace, server, win] = await Promise.all([
      this.keyspace(),
      this.serverSection(),
      this.metrics.window(now - CACHE_RANGES[range] * MINUTE, now, now),
    ]);
    const stats = this.metrics.stats(win);
    const serverData = server.available ? server.data : null;
    const mem = memoryUsage(serverData, keyspace?.totalBytes ?? null, this.cfg.memoryLimitMb);
    const total = keyspace?.totalBytes ?? 0;
    const minutes = win ? win.seconds / 60 : null;
    return {
      cacheBytes: keyspace ? keyspace.totalBytes : null,
      bytesPartial: keyspace?.bytesPartial ?? false,
      limit: {
        cacheBytes: keyspace ? keyspace.totalBytes : null,
        limitBytes: mem.limitBytes,
        limitSource: mem.source,
        percent: mem.percent,
      },
      server: server.available ? { available: true, data: this.serverMemory(server.data) } : server,
      byNamespace: [...(keyspace?.namespaces ?? [])]
        .sort((a, b) => b.bytes - a.bytes)
        .map((n) => ({
          name: n.name,
          bytes: n.bytes,
          keys: n.keys,
          percent: total > 0 ? round((n.bytes / total) * 100, 1) : null,
        })),
      largestKeys: (keyspace?.largestKeys ?? []).map((k) => this.largeKeyDto(k)),
      evictions: server.available
        ? {
            available: true,
            data: {
              perMin: stats.evicted !== null && minutes ? round(stats.evicted / minutes, 2) : null,
              inRange: stats.evicted,
              total: server.data.evictedKeys,
              policy: server.data.maxMemoryPolicy,
            },
          }
        : server,
      scannedAt: keyspace ? new Date(keyspace.at).toISOString() : null,
      largeKeyBytes: this.cfg.rules.largeKeyBytes,
    };
  }

  public async getTtl(): Promise<CacheTtlDto> {
    const now = Date.now();
    const [keyspace, win] = await Promise.all([
      this.keyspace(),
      this.metrics.window(now - 15 * MINUTE, now, now),
    ]);
    const stats = this.metrics.stats(win);
    const ns = keyspace?.namespaces ?? [];
    return {
      keyspace: this.summary(keyspace),
      persistentByNamespace: ns
        .filter((n) => n.persistent > 0)
        .sort((a, b) => b.persistent - a.persistent)
        .map((n) => ({ name: n.name, persistent: n.persistent, keys: n.keys })),
      expiringSoonByNamespace: ns
        .filter((n) => n.expiringSoon > 0)
        .sort((a, b) => b.expiringSoon - a.expiringSoon)
        .map((n) => ({ name: n.name, count: n.expiringSoon })),
      expiredPerMin:
        stats.expired !== null && win ? round(stats.expired / (win.seconds / 60), 2) : null,
      expirySpikeKeys: this.cfg.rules.expirySpikeKeys,
    };
  }

  public async getClients(): Promise<CacheClientsDto> {
    const [clients, server] = await Promise.all([
      this.monitoring.section('clients', () => this.monitoring.provider.clients()),
      this.serverSection(),
    ]);
    const byRuntime = new Map<string, { connections: number; blocked: number; bull: number }>();
    if (clients.available)
      for (const c of clients.data) {
        const r = c.runtime ?? 'unknown';
        const acc = byRuntime.get(r) ?? { connections: 0, blocked: 0, bull: 0 };
        acc.connections++;
        if (c.blocked) acc.blocked++;
        if (c.bull) acc.bull++;
        byRuntime.set(r, acc);
      }
    return {
      clients: clients.available
        ? {
            available: true,
            data: clients.data.map(({ db: _db, ...c }) => c),
          }
        : clients,
      byRuntime: [...byRuntime.entries()]
        .map(([runtime, v]) => ({ runtime, ...v }))
        .sort((a, b) => b.connections - a.connections),
      server: server.available
        ? {
            available: true,
            data: {
              connectedClients: server.data.connectedClients,
              maxClients: server.data.maxClients,
              percent:
                server.data.connectedClients !== null && server.data.maxClients
                  ? round((server.data.connectedClients / server.data.maxClients) * 100, 2)
                  : null,
              blockedClients: server.data.blockedClients,
              rejectedConnections: server.data.rejectedConnections,
            },
          }
        : server,
    };
  }

  // ─── Events / Errors / Operations / Config ────────────────────────────────

  public async getEvents(range: CacheRange): Promise<CacheEventDto[]> {
    return (await this.eventsSince(Date.now() - CACHE_RANGES[range] * MINUTE)).map((e) =>
      this.eventDto(e),
    );
  }

  public async getErrors(range: CacheRange): Promise<CacheErrorsDto> {
    const now = Date.now();
    const from = now - CACHE_RANGES[range] * MINUTE;
    const [errors, win] = await Promise.all([
      this.store.errors().catch(() => [] as CacheErrorRecord[]),
      this.metrics.window(from, now, now),
    ]);
    const recent = errors.filter((e) => e.at >= from);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [
        k,
        win ? counterOf(win.buckets, `cache.err.${k}`) : recent.filter((e) => e.kind === k).length,
      ]),
    ) as Record<CacheErrorKind, number>;
    return {
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      items: recent.slice(0, ERROR_LIST_LIMIT).map((e) => ({
        at: new Date(e.at).toISOString(),
        kind: e.kind,
        operation: e.operation,
        namespace: e.namespace,
        message: e.message,
        runtime: e.runtime,
        correlationId: e.correlationId,
      })),
      range,
    };
  }

  public async getOperations(): Promise<CacheOperationDto[]> {
    const ops = await this.store.operations().catch(() => [] as CacheOperationRecord[]);
    return ops.map((o) => ({ ...o, at: new Date(o.at).toISOString() }));
  }

  public async getConfig(): Promise<CacheConfigDto> {
    const r = this.cfg.redis;
    const redis = this.monitoring.driver === 'redis';
    const server = redis ? await this.serverSection() : null;
    const s = server?.available ? server.data : null;
    const items: CacheConfigDto['items'] = [
      { group: 'driver', key: 'driver', value: this.monitoring.driver },
      { group: 'driver', key: 'provider', value: redis ? 'RedisCacheDriver' : 'MemoryCacheDriver' },
      ...(redis
        ? [
            { group: 'connection', key: 'host', value: r.host },
            { group: 'connection', key: 'port', value: r.port },
            { group: 'connection', key: 'database', value: r.db ?? 0 },
            { group: 'connection', key: 'prefix', value: r.prefix },
            { group: 'connection', key: 'dataPrefix', value: cacheKeys(this.redis).dataPrefix() },
            { group: 'connection', key: 'password', value: Boolean(r.password), sensitive: true },
            { group: 'server', key: 'version', value: s?.version ?? null },
            { group: 'server', key: 'maxMemory', value: s ? (s.maxMemory ?? 0) : null },
            { group: 'server', key: 'evictionPolicy', value: s?.maxMemoryPolicy ?? null },
            { group: 'server', key: 'maxClients', value: s?.maxClients ?? null },
          ]
        : []),
      { group: 'behavior', key: 'defaultTtlSec', value: this.cfg.defaultTtlSec },
      { group: 'behavior', key: 'namespaceDepth', value: this.cfg.namespaceDepth },
      { group: 'behavior', key: 'scanMaxKeys', value: this.cfg.scanMaxKeys },
      { group: 'behavior', key: 'memoryLimitMb', value: this.cfg.memoryLimitMb || null },
      { group: 'behavior', key: 'sessionNamespaces', value: this.cfg.sessionNamespaces.join(', ') },
      {
        group: 'behavior',
        key: 'sensitiveNamespaces',
        value: this.cfg.sensitiveNamespaces.join(', '),
      },
      { group: 'thresholds', key: 'hitRateWarnPercent', value: this.cfg.rules.hitRateWarnPercent },
      { group: 'thresholds', key: 'hitRateDropPoints', value: this.cfg.rules.hitRateDropPoints },
      { group: 'thresholds', key: 'minReads', value: this.cfg.rules.minReads },
      { group: 'thresholds', key: 'memoryWarnPercent', value: this.cfg.rules.memoryWarnPercent },
      { group: 'thresholds', key: 'memoryCritPercent', value: this.cfg.rules.memoryCritPercent },
      { group: 'thresholds', key: 'expirySpikeKeys', value: this.cfg.rules.expirySpikeKeys },
      { group: 'thresholds', key: 'largeKeyBytes', value: this.cfg.rules.largeKeyBytes },
      {
        group: 'thresholds',
        key: 'connectionWarnPercent',
        value: this.cfg.rules.connectionWarnPercent,
      },
      { group: 'actions', key: 'actionsEnabled', value: this.cfg.actionsEnabled },
      { group: 'actions', key: 'flushEnabled', value: this.cfg.flushEnabled },
      { group: 'actions', key: 'valuePreview', value: this.cfg.valuePreview },
    ];
    return { items };
  }

  public async getFlushImpact(): Promise<FlushImpactDto> {
    const keyspace = this.monitoring.usable()
      ? await this.monitoring.refreshKeyspace().catch(() => null)
      : null;
    const sessions = (keyspace?.namespaces ?? []).filter((n) => this.isSession(n.name));
    return {
      environment: this.config.app.env,
      keys: keyspace?.totalKeys ?? null,
      bytes: keyspace?.totalBytes ?? null,
      truncated: keyspace?.truncated ?? false,
      sessionKeys: sessions.reduce((a, n) => a + n.keys, 0),
      sessionNamespaces: sessions.map((n) => n.name),
      flushEnabled: this.cfg.flushEnabled,
      scannedAt: keyspace ? new Date(keyspace.at).toISOString() : null,
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public async testConnection(): Promise<PingResultDto> {
    const res = await this.operations.testConnection();
    return { ...res, at: new Date().toISOString() };
  }

  public async deleteKey(key: string, ctx: OperationContext) {
    return this.act(() => this.operations.deleteKey(key, ctx), { key });
  }

  public async clearNamespace(name: string, ctx: OperationContext) {
    return this.act(() => this.operations.clearNamespace(name, ctx), { name });
  }

  public async flush(ctx: OperationContext) {
    return this.act(() => this.operations.flushAll(ctx), {});
  }

  private async act(
    fn: () => Promise<{ record: CacheOperationRecord }>,
    params: Record<string, string>,
  ): Promise<CacheOperationDto> {
    try {
      const { record } = await fn();
      return { ...record, at: new Date(record.at).toISOString() };
    } catch (err) {
      throw this.operationError(err, params);
    }
  }

  private async eventsSince(from: number): Promise<CacheEventRecord[]> {
    return (await this.store.events().catch(() => [] as CacheEventRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  private eventDto(e: CacheEventRecord): CacheEventDto {
    const rule = typeof e.params['rule'] === 'string' ? (e.params['rule'] as CacheRule) : null;
    const title = rule ? this.i18n.t(`cache.alert.${rule}.title`) : '';
    const ns = String(e.params['namespace'] ?? '');
    const message =
      e.type === 'alert_started' && rule
        ? `${title}: ${this.alertMessage(rule, e.params)}`
        : this.i18n.t(`cache.event.${e.type}`, {
            ...e.params,
            alert: ns ? `${title} (${ns})` : title,
            runtime: e.runtime ? this.i18n.t(`runtime.name.${e.runtime}`) : '',
          });
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      runtime: e.runtime,
      tab: rule
        ? (RULE_TAB[rule] ?? null)
        : e.type.startsWith('connection')
          ? 'overview'
          : e.type === 'key_deleted' || e.type === 'namespace_cleared' || e.type === 'cache_flushed'
            ? 'operations'
            : null,
    };
  }

  private sectionError(s: Extract<SectionDto<unknown>, { available: false }>): Error {
    if (s.reason === 'disconnected') return new CacheNotConnectedException(s.message ?? 'unknown');
    if (s.reason === 'unsupported')
      return new CacheActionRejectedException(
        'UNSUPPORTED',
        'cache.error.unsupported',
        { driver: this.monitoring.driver },
        422,
      );
    return new CacheActionRejectedException(
      'READ_FAILED',
      'cache.error.readFailed',
      { message: s.message ?? '' },
      502,
    );
  }

  private operationError(err: unknown, params: Record<string, string>): Error {
    if (!(err instanceof CacheOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new CacheNotConnectedException(this.connection.getStatus().state);
      case 'KEY_NOT_FOUND':
        return new CacheNotFoundException('cache.error.keyNotFound', { key: params['key'] ?? '' });
      case 'NAMESPACE_EMPTY':
        return new CacheNotFoundException('cache.error.namespaceNotFound', {
          name: params['name'] ?? '',
        });
      case 'FAILED':
        return new CacheActionRejectedException(
          'ACTION_FAILED',
          'cache.error.FAILED',
          { message: err.message },
          502,
        );
      default:
        return new CacheActionRejectedException(err.code, `cache.error.${err.code}`);
    }
  }
}

type Group = { t: number; b: MetricBucket[]; seconds: number };

/** Trung bình gauge của collector trong một nhóm bucket (đọc theo max giữa instance). */
function groupGauge(buckets: readonly MetricBucket[], name: string): number | null {
  const values = buckets
    .map((b) => gaugeOf(b, name, { mode: 'max' }))
    .filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, v) => a + v, 0) / values.length : null;
}

/** Che field nhạy cảm (password, token…) và email trong mẫu value. */
function redactSample(sample: ValueSample): ValueSample {
  if (sample.kind === 'text') return { ...sample, value: redactPayload(sample.value) };
  return { ...sample, value: redactPayload(sample.value) };
}
