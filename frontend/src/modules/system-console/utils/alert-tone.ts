import type { Tone } from '@core/theme';

interface RuleAlert {
  rule: string;
  severity: string;
}

/** Tông của một ô số liệu theo cảnh báo backend đang mở cho các rule tương ứng; không có → `null`. */
export function alertTone(alerts: readonly RuleAlert[], rules: readonly string[]): Tone | null {
  const hits = alerts.filter((a) => rules.includes(a.rule));
  return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
}
