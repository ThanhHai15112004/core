import type { ProviderHealthStatusCode } from '@packages/kernel/index.js';
import { PROVIDER_HEALTH_STATUS } from '../enum/provider-registry.enum.js';
import type { ProviderRegistryRuntimeConfig } from '../types/provider-registry.types.js';

export const METRIC_BUCKET_MINUTES = 15;
export const MAX_BUCKET_SAMPLES = 200;

export function alignToMetricBucketStart(date: Date = new Date()): Date {
  const bucketMs = METRIC_BUCKET_MINUTES * 60_000;
  const aligned = Math.floor(date.getTime() / bucketMs) * bucketMs;
  return new Date(aligned);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeP95FromSamples(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return Math.round(sorted[idx] ?? 0);
}

export function appendLatencySample(
  existing: readonly number[],
  latencyMs: number,
  maxSamples = MAX_BUCKET_SAMPLES,
): number[] {
  const clean = Math.max(0, Math.round(latencyMs));
  const next = [...existing, clean];
  if (next.length <= maxSamples) return next;
  return next.slice(next.length - maxSamples);
}

export function classifyHealthFromTelemetry(params: {
  readonly totalCount: number;
  readonly errorCount: number;
  readonly avgLatencyMs: number | null;
  readonly config: ProviderRegistryRuntimeConfig;
}): ProviderHealthStatusCode {
  if (params.totalCount <= 0) {
    return PROVIDER_HEALTH_STATUS.UNKNOWN;
  }

  const errorRatePct = (params.errorCount / params.totalCount) * 100;
  if (errorRatePct >= params.config.downErrorRatePct) {
    return PROVIDER_HEALTH_STATUS.DOWN;
  }

  if (
    errorRatePct >= params.config.degradedErrorRatePct ||
    (params.avgLatencyMs !== null && params.avgLatencyMs >= params.config.degradedLatencyMs)
  ) {
    return PROVIDER_HEALTH_STATUS.DEGRADED;
  }

  return PROVIDER_HEALTH_STATUS.HEALTHY;
}
