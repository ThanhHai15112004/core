import { Injectable } from '@nestjs/common';
import type { Gauge } from 'prom-client';
import type { KeyspaceSnapshot, ServerInfo } from '@packages/cache/index.js';
import { MetricsRegistryService, PrometheusQueryClient } from '@packages/metrics/index.js';
import { round } from '@modules/performance/index.js';

/**
 * Số đo cache trong một khoảng, đọc lại từ Prometheus. Nguồn là Redis `INFO` (toàn server, không theo namespace)
 * và snapshot keyspace — `null` khi Prometheus chưa có dữ liệu, không bao giờ là 0 giả.
 */
export interface CacheWindowStats {
  hits: number | null;
  misses: number | null;
  reads: number | null;
  hitRatePercent: number | null;
  missRatePercent: number | null;
  opsPerSec: number | null;
  evicted: number | null;
  expired: number | null;
  peakServerMemory: number | null;
  peakKeys: number | null;
}

export interface CacheSeriesDef {
  id: string;
  unit: string;
  /** PromQL; `$w` được thay bằng cửa sổ rate theo độ phân giải. */
  expr: string;
}

/** Gauge Prometheus của cache (chỉ instance giữ lock của monitor ghi mỗi chu kỳ). */
export const CACHE_GAUGES = {
  hits: 'core_redis_keyspace_hits',
  misses: 'core_redis_keyspace_misses',
  evicted: 'core_redis_evicted_keys',
  expired: 'core_redis_expired_keys',
  usedMemory: 'core_redis_used_memory_bytes',
  clients: 'core_redis_connected_clients',
  opsPerSec: 'core_redis_ops_per_sec',
  keys: 'core_cache_keys',
  bytes: 'core_cache_bytes',
} as const;

const MAX_POINTS = 120;

export const hitRate = (hits: number | null, reads: number | null) =>
  hits !== null && reads ? round((hits / reads) * 100, 2) : null;

@Injectable()
export class CacheMetricsService {
  private readonly gauges: Record<keyof typeof CACHE_GAUGES, Gauge>;

  constructor(
    registry: MetricsRegistryService,
    private readonly prom: PrometheusQueryClient,
  ) {
    const help: Record<keyof typeof CACHE_GAUGES, string> = {
      hits: 'Redis INFO keyspace_hits (cumulative, server-wide)',
      misses: 'Redis INFO keyspace_misses (cumulative, server-wide)',
      evicted: 'Redis INFO evicted_keys (cumulative)',
      expired: 'Redis INFO expired_keys (cumulative)',
      usedMemory: 'Redis INFO used_memory',
      clients: 'Redis INFO connected_clients',
      opsPerSec: 'Redis INFO instantaneous_ops_per_sec',
      keys: 'Keys in the cache keyspace (SCAN)',
      bytes: 'Approximate bytes of the cache keyspace (MEMORY USAGE)',
    };
    this.gauges = Object.fromEntries(
      Object.entries(CACHE_GAUGES).map(([k, name]) => [
        k,
        registry.gauge(name, help[k as keyof typeof CACHE_GAUGES]),
      ]),
    ) as Record<keyof typeof CACHE_GAUGES, Gauge>;
  }

  /** Ghi gauge từ snapshot của monitor (giá trị null → không ghi, Prometheus giữ khoảng trống). */
  public record(server: ServerInfo | null, keyspace: KeyspaceSnapshot | null): void {
    const set = (k: keyof typeof CACHE_GAUGES, v: number | null | undefined) => {
      if (v !== null && v !== undefined && Number.isFinite(v)) this.gauges[k].set(v);
    };
    set('hits', server?.keyspaceHits);
    set('misses', server?.keyspaceMisses);
    set('evicted', server?.evictedKeys);
    set('expired', server?.expiredKeys);
    set('usedMemory', server?.usedMemory);
    set('clients', server?.connectedClients);
    set('opsPerSec', server?.opsPerSec);
    set('keys', keyspace?.totalKeys);
    set('bytes', keyspace?.totalBytes);
  }

  /** Thống kê `minutes` phút, kết thúc trước hiện tại `offsetMin` phút. */
  public async stats(minutes: number, offsetMin = 0): Promise<CacheWindowStats> {
    const w = `${Math.max(1, Math.round(minutes))}m`;
    const off = offsetMin > 0 ? ` offset ${Math.round(offsetMin)}m` : '';
    const g = CACHE_GAUGES;
    const v = (expr: string) => this.prom.value(expr);
    const [hits, misses, opsPerSec, evicted, expired, peakMem, peakKeys] = await Promise.all([
      v(`max(increase(${g.hits}[${w}]${off}))`),
      v(`max(increase(${g.misses}[${w}]${off}))`),
      v(`max(avg_over_time(${g.opsPerSec}[${w}]${off}))`),
      v(`max(increase(${g.evicted}[${w}]${off}))`),
      v(`max(increase(${g.expired}[${w}]${off}))`),
      v(`max(max_over_time(${g.usedMemory}[${w}]${off}))`),
      v(`max(max_over_time(${g.keys}[${w}]${off}))`),
    ]);
    const r = (n: number | null) => (n === null ? null : Math.round(n));
    const reads = hits !== null && misses !== null ? r(hits + misses) : null;
    return {
      hits: r(hits),
      misses: r(misses),
      reads,
      hitRatePercent: hitRate(hits, reads),
      missRatePercent: misses !== null && reads ? round((misses / reads) * 100, 2) : null,
      opsPerSec: opsPerSec === null ? null : round(opsPerSec, 2),
      evicted: r(evicted),
      expired: r(expired),
      peakServerMemory: r(peakMem),
      peakKeys: r(peakKeys),
    };
  }

  /** Chuỗi thời gian `minutes` phút gần nhất; `resolutionSec` null khi không có điểm nào. */
  public async series(
    minutes: number,
    defs: CacheSeriesDef[],
  ): Promise<{
    resolutionSec: number | null;
    series: (CacheSeriesDef & { points: { t: number; value: number }[] })[];
  }> {
    const stepSec = Math.max(15, Math.ceil((minutes * 60) / MAX_POINTS));
    const rateWindow = `${Math.max(60, stepSec * 2)}s`;
    const series = await Promise.all(
      defs.map(async (d) => {
        const res = await this.prom.safeRange(
          d.expr.replaceAll('$w', rateWindow),
          minutes,
          stepSec,
        );
        return {
          ...d,
          points: (res[0]?.points ?? []).map((p) => ({ t: p.t, value: round(p.v, 3) })),
        };
      }),
    );
    return {
      resolutionSec: series.some((s) => s.points.length > 0) ? stepSec : null,
      series,
    };
  }
}
