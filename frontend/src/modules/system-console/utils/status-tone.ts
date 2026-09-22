export type StatusTone = 'ok' | 'warn' | 'crit' | 'unknown';

/** Gom các giá trị status khác nhau (package, health map, KPI, overall) về 4 tông màu hiển thị. */
export function toneOf(status: string | undefined): StatusTone {
  switch (status) {
    case 'healthy':
    case 'ok':
    case 'normal':
    case 'success':
      return 'ok';
    case 'warning':
    case 'warn':
    case 'degraded':
    case 'starting':
    case 'restarting':
    case 'stopping':
      return 'warn';
    case 'error':
    case 'critical':
    case 'down':
    case 'crashed':
      return 'crit';
    default:
      return 'unknown';
  }
}

const TONE_RANK: Record<StatusTone, number> = { unknown: 0, ok: 1, warn: 2, crit: 3 };

/** Tông "tệ nhất" trong danh sách — dùng cho chấm trạng thái trên sidebar. */
export function worstTone(statuses: string[]): StatusTone | undefined {
  if (statuses.length === 0) return undefined;
  return statuses.map(toneOf).reduce((a, b) => (TONE_RANK[b] > TONE_RANK[a] ? b : a));
}
