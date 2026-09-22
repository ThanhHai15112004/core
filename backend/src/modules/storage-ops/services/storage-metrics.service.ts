import { Injectable } from '@nestjs/common';
import {
  TELEMETRY_TIERS,
  tierCovering,
  type MetricBucket,
  type TelemetryTier,
} from '@packages/telemetry/index.js';
import { containerMetric, type StorageOp } from '@packages/storage/index.js';
import {
  PerformanceStoreService,
  counterOf,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import type { OperationRowDto, TransferPerfDto } from '../responses/storage-ops.response.js';

export interface MetricWindow {
  tier: TelemetryTier;
  buckets: MetricBucket[];
  seconds: number;
}

export const STORAGE_OPS: StorageOp[] = ['put', 'get', 'delete', 'head', 'list'];

/** Số thao tác (thành công + lỗi) của một loại. */
export const opsOf = (b: readonly MetricBucket[], op: StorageOp) =>
  mergedOf(b, `storage.${op}`).n + mergedOf(b, `storage.${op}.failed`).n;

/** Đọc số đo storage đã ghi trong Redis (dùng chung bucket với trang Performance). */
@Injectable()
export class StorageMetricsService {
  constructor(private readonly perf: PerformanceStoreService) {}

  public async window(
    fromMs: number,
    toMs: number,
    now: number,
    forceTier?: TelemetryTier,
  ): Promise<MetricWindow | null> {
    const tier = forceTier ?? tierCovering(fromMs, now);
    if (!tier) return null;
    const instances = await this.perf
      .instances(fromMs - TELEMETRY_TIERS[tier].seconds * 1000)
      .catch(() => [] as string[]);
    const buckets = await this.perf.buckets(tier, fromMs, toMs, instances);
    return { tier, buckets, seconds: Math.max(1, (Math.min(toMs, now) - fromMs) / 1000) };
  }

  public transfer(w: MetricWindow | null, dir: 'up' | 'down'): TransferPerfDto {
    const b = w?.buckets ?? [];
    const op: StorageOp = dir === 'up' ? 'put' : 'get';
    const ok = mergedOf(b, `storage.${op}`);
    const failures = mergedOf(b, `storage.${op}.failed`).n;
    const ops = ok.n + failures;
    const bytes = counterOf(b, `storage.bytes.${dir}`);
    const r = (n: number | null, d = 2) => (n === null ? null : round(n, d));
    return {
      bytes,
      bytesPerSec: w ? round(bytes / w.seconds, 1) : null,
      ops,
      opsPerMin: w ? round(ops / (w.seconds / 60), 2) : null,
      avgMs: r(meanOf(ok)),
      p95Ms: r(percentileOf(ok, 95)),
      failures,
      failureRatePercent: ops > 0 ? round((failures / ops) * 100, 2) : null,
    };
  }

  public operations(w: MetricWindow | null): OperationRowDto[] {
    const b = w?.buckets ?? [];
    return STORAGE_OPS.map((op) => {
      const ok = mergedOf(b, `storage.${op}`);
      const failures = mergedOf(b, `storage.${op}.failed`).n;
      const ops = ok.n + failures;
      return {
        op,
        ops,
        perMin: w ? round(ops / (w.seconds / 60), 2) : null,
        avgMs: meanOf(ok) === null ? null : round(meanOf(ok)!, 2),
        p95Ms: percentileOf(ok, 95) === null ? null : round(percentileOf(ok, 95)!, 2),
        failures,
      };
    });
  }

  public totals(w: MetricWindow | null) {
    const b = w?.buckets ?? [];
    const ops = STORAGE_OPS.reduce((s, op) => s + opsOf(b, op), 0);
    const errors = counterOf(b, 'storage.errors');
    return {
      ops,
      errors,
      opsPerSec: w ? round(ops / w.seconds, 3) : null,
      errorRatePercent: ops > 0 ? round((errors / ops) * 100, 2) : null,
    };
  }

  /** Số đo theo container trong cửa sổ (từ metric `storage.c.<container>.*`). */
  public container(w: MetricWindow | null, name: string) {
    const b = w?.buckets ?? [];
    const c = (k: string) => counterOf(b, containerMetric(name, k));
    return {
      uploadBytes: c('bytes.up'),
      downloadBytes: c('bytes.down'),
      ops: STORAGE_OPS.reduce((s, op) => s + c(op), 0) + c('errors'),
      errors: c('errors'),
    };
  }
}
