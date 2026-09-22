import type { StorageConfig } from '@packages/config/index.js';
import type { StorageConnectionState } from '@packages/storage/index.js';
import type { StorageSeverity } from '../responses/storage-ops.response.js';

export type StorageRule =
  | 'STORAGE_UNAVAILABLE'
  | 'CAPACITY'
  | 'RAPID_GROWTH'
  | 'UPLOAD_FAILURE_RATE'
  | 'DOWNLOAD_FAILURE_RATE'
  | 'UPLOAD_LATENCY'
  | 'STALE_MULTIPART'
  | 'LARGE_OBJECT';

export const RULE_TAB: Record<StorageRule, string> = {
  STORAGE_UNAVAILABLE: 'overview',
  CAPACITY: 'usage',
  RAPID_GROWTH: 'containers',
  UPLOAD_FAILURE_RATE: 'errors',
  DOWNLOAD_FAILURE_RATE: 'errors',
  UPLOAD_LATENCY: 'traffic',
  STALE_MULTIPART: 'uploads',
  LARGE_OBJECT: 'usage',
};

export interface StorageRuleInput {
  connection: StorageConnectionState;
  capacityPercent: number | null;
  /** Tăng 24h và mức tăng trung bình/ngày của 7 ngày trước (bytes). */
  growth: {
    last24h: number | null;
    avgDaily7d: number | null;
    topContainer: string | null;
    topContainerBytes: number | null;
  };
  upload: { ops: number; failureRatePercent: number | null; p95Ms: number | null };
  download: { ops: number; failureRatePercent: number | null };
  staleMultipart: { count: number; bytes: number } | null;
  largestObject: { key: string; size: number } | null;
}

export type StorageRuleConfig = StorageConfig['rules'] & { largeObjectBytes: number };

export interface StorageViolation {
  id: StorageRule;
  severity: StorageSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

const MB = 1024 * 1024;

/** Rule cảnh báo storage theo ngưỡng cấu hình. Không đủ dữ liệu → không kết luận. */
export function evaluateStorageRules(
  input: StorageRuleInput,
  cfg: StorageRuleConfig,
): StorageViolation[] {
  const out: StorageViolation[] = [];
  const add = (
    id: StorageRule,
    severity: StorageSeverity,
    value: number,
    threshold: number,
    unit: string,
    extra: Record<string, string | number> = {},
  ) => out.push({ id, severity, value: Number(value.toFixed(2)), threshold, unit, extra });

  if (input.connection === 'unavailable' || input.connection === 'reconnecting') {
    add('STORAGE_UNAVAILABLE', 'critical', 0, 0, '');
    return out;
  }

  const cap = input.capacityPercent;
  if (cap !== null && cap >= cfg.capacityWarnPercent)
    add(
      'CAPACITY',
      cap >= cfg.capacityCritPercent ? 'critical' : 'warning',
      cap,
      cap >= cfg.capacityCritPercent ? cfg.capacityCritPercent : cfg.capacityWarnPercent,
      '%',
    );

  const g = input.growth;
  if (g.last24h !== null && g.last24h >= cfg.growthMinMb * MB) {
    const normal = g.avgDaily7d !== null && g.avgDaily7d > 0 ? g.avgDaily7d : null;
    if (normal !== null && g.last24h >= normal * cfg.growthFactor)
      add('RAPID_GROWTH', 'warning', g.last24h, Math.round(normal), 'B', {
        container: g.topContainer ?? '',
        containerBytes: g.topContainerBytes ?? 0,
      });
  }

  if (
    input.upload.ops >= cfg.minOps &&
    (input.upload.failureRatePercent ?? 0) >= cfg.failureRatePercent
  )
    add(
      'UPLOAD_FAILURE_RATE',
      input.upload.failureRatePercent! >= cfg.failureRatePercent * 4 ? 'critical' : 'warning',
      input.upload.failureRatePercent!,
      cfg.failureRatePercent,
      '%',
    );
  if (
    input.download.ops >= cfg.minOps &&
    (input.download.failureRatePercent ?? 0) >= cfg.failureRatePercent
  )
    add(
      'DOWNLOAD_FAILURE_RATE',
      'warning',
      input.download.failureRatePercent!,
      cfg.failureRatePercent,
      '%',
    );
  if (input.upload.ops >= cfg.minOps && (input.upload.p95Ms ?? 0) >= cfg.putP95Ms)
    add('UPLOAD_LATENCY', 'warning', input.upload.p95Ms!, cfg.putP95Ms, 'ms');

  if (input.staleMultipart && input.staleMultipart.count >= cfg.staleUploads)
    add('STALE_MULTIPART', 'warning', input.staleMultipart.count, cfg.staleUploads, '', {
      bytes: input.staleMultipart.bytes,
    });

  if (input.largestObject && input.largestObject.size >= cfg.largeObjectBytes)
    add('LARGE_OBJECT', 'info', input.largestObject.size, cfg.largeObjectBytes, 'B', {
      key: input.largestObject.key,
    });

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface StoredStorageAlert {
  since: number;
  severity: StorageSeverity;
  value: number;
  threshold: number;
  unit: string;
  extra: Record<string, string | number>;
}

export function diffStorageAlerts(
  violations: readonly StorageViolation[],
  active: ReadonlyMap<string, StoredStorageAlert>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredStorageAlert>(
    violations.map((v) => [
      v.id,
      {
        since: active.get(v.id)?.since ?? now,
        severity: v.severity,
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
        extra: v.extra,
      },
    ]),
  );
  const recovered = [...active.entries()]
    .filter(([id]) => !violations.some((v) => v.id === id))
    .map(([id, s]) => ({ id: id as StorageRule, alert: s, durationMs: now - s.since }));
  return { started, set, recovered };
}
