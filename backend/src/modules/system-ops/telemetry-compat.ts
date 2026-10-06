import { Injectable, Optional } from '@nestjs/common';
import type { RedisService } from '@packages/redis/index.js';
import type { SlowQueryRecord } from '@packages/database/index.js';

export type { SlowQueryRecord };

export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const HISTOGRAM_SIZE = LATENCY_BUCKETS_MS.length + 1;

export const TELEMETRY_TIERS = {
  s10: { seconds: 10, ttlSec: 2 * 3600 },
  m1: { seconds: 60, ttlSec: 25 * 3600 },
  h1: { seconds: 3600, ttlSec: 8 * 24 * 3600 },
} as const;
export type TelemetryTier = keyof typeof TELEMETRY_TIERS;
export const TIER_ORDER: TelemetryTier[] = ['s10', 'm1', 'h1'];

export function tierCovering(fromMs: number, now: number): TelemetryTier | null {
  return TIER_ORDER.find((t) => now - fromMs <= TELEMETRY_TIERS[t].ttlSec * 1000) ?? null;
}

export type MetricAgg = 'c' | 'n' | 's' | 'x' | `h${number}`;
export const METRIC_FIELD_SEPARATOR = '|';

export interface MetricValueAgg {
  c: number;
  n: number;
  s: number;
  x: number | null;
  hist: number[] | null;
}

export interface MetricBucket {
  start: number;
  metrics: Map<string, MetricValueAgg>;
  byInstance: Map<string, Map<string, MetricValueAgg>>;
}

export const emptyMetric = (): MetricValueAgg => ({ c: 0, n: 0, s: 0, x: null, hist: null });

export const mergeMetric = (into: MetricValueAgg, from: MetricValueAgg): void => {
  into.c += from.c;
  into.n += from.n;
  into.s += from.s;
  if (from.x !== null) into.x = into.x === null ? from.x : Math.max(into.x, from.x);
};

export const emptyHistogram = (): number[] => new Array(HISTOGRAM_SIZE).fill(0);
export const mergeHistogram = (into: number[], from: number[]): void => {
  for (let i = 0; i < into.length; i++) into[i] = (into[i] ?? 0) + (from[i] ?? 0);
};
export const histogramPercentile = (_hist: number[], _p: number): number | null => null;

export function parseMetricHash(
  _hash: Record<string, string>,
  _instance: string,
  _into: MetricBucket,
): void {}

export const telemetryKeys = (redis: RedisService) => ({
  bucket: (tier: TelemetryTier, bucketStartSec: number, instance: string) =>
    redis.key('perf', 'b', tier, String(bucketStartSec), instance),
  instances: () => redis.key('perf', 'instances'),
  slowQueries: () => redis.key('perf', 'db', 'slow'),
  dbPool: () => redis.key('perf', 'db', 'pool'),
  events: () => redis.key('perf', 'events'),
  activeRules: () => redis.key('perf', 'active'),
  evaluateLock: () => redis.key('perf', 'lock', 'evaluate'),
});

@Injectable()
export class MetricRecorder {
  public readonly instance: string = `${process.pid}`;
  public readonly enabled: boolean = false;

  constructor(@Optional() private readonly redis?: RedisService) {}

  public count(_name: string, _value = 1, ..._rest: unknown[]): void {}
  public gauge(_name: string, _value: number, ..._rest: unknown[]): void {}
  public timing(_name: string, _ms: number, ..._rest: unknown[]): void {}
  public increment(_name: string, _value = 1, ..._rest: unknown[]): void {}
  public sample(_name: string, _value: number, ..._rest: unknown[]): void {}
  public flush(): Promise<void> {
    return Promise.resolve();
  }
}
