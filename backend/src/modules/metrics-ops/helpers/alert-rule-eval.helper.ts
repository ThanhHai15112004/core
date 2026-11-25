import {
  ALERT_CHANNEL,
  ALERT_METRIC_KEY,
  ALERT_OPERATOR,
  ALERT_SEVERITY,
  type AlertChannel,
  type AlertMetricKey,
  type AlertOperator,
  type AlertSeverity,
} from '../enum/metrics-ops.enum.js';
import type { AlertRuleScope } from '../types/metrics-ops.types.js';

const METRIC_UNITS: Record<AlertMetricKey, string> = {
  [ALERT_METRIC_KEY.HTTP_REQUEST_RATE]: 'req/s',
  [ALERT_METRIC_KEY.HTTP_ERROR_RATE]: '%',
  [ALERT_METRIC_KEY.HTTP_LATENCY_P50]: 'ms',
  [ALERT_METRIC_KEY.HTTP_LATENCY_P95]: 'ms',
  [ALERT_METRIC_KEY.HTTP_LATENCY_P99]: 'ms',
  [ALERT_METRIC_KEY.RUNTIME_CPU_PERCENT]: '%',
  [ALERT_METRIC_KEY.RUNTIME_MEMORY_PERCENT]: '%',
  [ALERT_METRIC_KEY.RUNTIME_EVENT_LOOP_P99_MS]: 'ms',
  [ALERT_METRIC_KEY.DB_POOL_UTILIZATION_PERCENT]: '%',
  [ALERT_METRIC_KEY.DB_POOL_WAITING]: 'conn',
  [ALERT_METRIC_KEY.QUEUE_BACKLOG]: 'jobs',
  [ALERT_METRIC_KEY.QUEUE_OLDEST_JOB_AGE_SEC]: 's',
  [ALERT_METRIC_KEY.REDIS_LATENCY_P95_MS]: 'ms',
  [ALERT_METRIC_KEY.PROVIDER_LATENCY_P95_MS]: 'ms',
};

const OPERATOR_SYMBOLS: Record<AlertOperator, string> = {
  [ALERT_OPERATOR.GT]: '>',
  [ALERT_OPERATOR.GTE]: '>=',
  [ALERT_OPERATOR.LT]: '<',
  [ALERT_OPERATOR.LTE]: '<=',
};

/** Đơn vị hiển thị chuẩn của một metricKey. */
export function unitOfMetricKey(metricKey: AlertMetricKey): string {
  return METRIC_UNITS[metricKey] ?? '';
}

/** So sánh giá trị đo với ngưỡng theo toán tử của rule. */
export function compareMetric(value: number, operator: AlertOperator, threshold: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return false;
  switch (operator) {
    case ALERT_OPERATOR.GT:
      return value > threshold;
    case ALERT_OPERATOR.GTE:
      return value >= threshold;
    case ALERT_OPERATOR.LT:
      return value < threshold;
    case ALERT_OPERATOR.LTE:
      return value <= threshold;
    default:
      return false;
  }
}

/** Sinh fingerprint cố định (dedup theo ruleCode + nhãn đối tượng) và cắt ngắn vừa cột VARCHAR(191). */
export function buildAlertFingerprint(ruleCode: string, labels: Record<string, string>): string {
  const sorted = Object.entries(labels)
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const raw = sorted ? `${ruleCode}|${sorted}` : ruleCode;
  return raw.slice(0, 191);
}

/** Kiểm tra mẫu đo có khớp bộ lọc scope cấu hình trong rule hay không. */
export function matchesRuleScope(
  labels: Record<string, string>,
  scope: AlertRuleScope | null,
): boolean {
  if (!scope) return true;
  const checks: Array<[keyof AlertRuleScope, string]> = [
    ['module', 'module'],
    ['version', 'version'],
    ['route', 'route'],
    ['instance', 'instance'],
    ['runtime', 'runtime'],
    ['queue', 'queue'],
    ['provider', 'provider'],
  ];
  for (const [scopeKey, labelKey] of checks) {
    const expected = scope[scopeKey]?.trim();
    if (!expected) continue;
    if ((labels[labelKey] ?? '') !== expected) return false;
  }
  return true;
}

/** Xác định danh sách kênh gửi mặc định theo mức độ nghiêm trọng khi rule không ghi đè riêng. */
export function resolveAlertChannels(
  severity: AlertSeverity,
  configured: readonly AlertChannel[] | null | undefined,
): AlertChannel[] {
  if (configured && configured.length > 0) {
    return [...new Set(configured)];
  }
  switch (severity) {
    case ALERT_SEVERITY.CRITICAL:
      return [
        ALERT_CHANNEL.LOG,
        ALERT_CHANNEL.WEBHOOK,
        ALERT_CHANNEL.NOTIFICATION,
        ALERT_CHANNEL.DOMAIN_EVENT,
      ];
    case ALERT_SEVERITY.WARNING:
      return [ALERT_CHANNEL.LOG, ALERT_CHANNEL.WEBHOOK, ALERT_CHANNEL.DOMAIN_EVENT];
    default:
      return [ALERT_CHANNEL.LOG, ALERT_CHANNEL.DOMAIN_EVENT];
  }
}

/** Kiểm tra tính hợp lệ của URL webhook (chỉ nhận http/https). */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Tạo tóm tắt ngắn gọn cho sự kiện cảnh báo (tối đa 500 ký tự). */
export function buildAlertSummary(input: {
  severity: AlertSeverity;
  ruleName: string;
  metricKey: AlertMetricKey;
  value: number;
  operator: AlertOperator;
  threshold: number;
  labels: Record<string, string>;
}): string {
  const unit = unitOfMetricKey(input.metricKey);
  const op = OPERATOR_SYMBOLS[input.operator] ?? input.operator;
  const labelText = Object.entries(input.labels)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const scopePart = labelText ? ` (${labelText})` : '';
  const text = `[${input.severity}] ${input.ruleName}${scopePart}: ${input.metricKey} = ${input.value}${unit} (${op} ${input.threshold}${unit})`;
  return text.slice(0, 500);
}

/** Tính phân vị p50/p95/p99 từ danh sách giá trị thô (ms). */
export function computeQuantileMs(samples: readonly number[], q: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  const val = sorted[idx];
  return val === undefined ? null : Math.round(val * 100) / 100;
}
