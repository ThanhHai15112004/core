/**
 * Tông trạng thái — bảng map DUY NHẤT từ trạng thái nghiệp vụ sang màu theme.
 * Component nhận `Tone` và dùng các class bên dưới; không tự chọn màu.
 */
export const TONES = ['ok', 'warn', 'crit', 'info', 'unknown'] as const;
export type Tone = (typeof TONES)[number];

/** Gom các giá trị status khác nhau của backend (package, health map, KPI, runtime…) về tông hiển thị. */
export function toneOf(status: string | null | undefined): Tone {
  switch (status) {
    case 'healthy':
    case 'ok':
    case 'up':
    case 'normal':
    case 'success':
    case 'completed':
    case 'running':
    case 'online':
      return 'ok';
    case 'warning':
    case 'warn':
    case 'degraded':
    case 'starting':
    case 'restarting':
    case 'stopping':
    case 'slow':
    case 'low_traffic':
      return 'warn';
    case 'error':
    case 'critical':
    case 'crit':
    case 'down':
    case 'crashed':
    case 'failed':
    case 'fatal':
    case 'offline':
      return 'crit';
    case 'info':
      return 'info';
    default:
      return 'unknown';
  }
}

const TONE_RANK: Record<Tone, number> = { unknown: 0, info: 1, ok: 2, warn: 3, crit: 4 };

/** Tông "tệ nhất" trong danh sách (chấm trạng thái của nhóm, banner tổng). */
export function worstTone(tones: Tone[]): Tone | undefined {
  if (tones.length === 0) return undefined;
  return tones.reduce((a, b) => (TONE_RANK[b] > TONE_RANK[a] ? b : a));
}

/** Class Tailwind theo tông — chuỗi đầy đủ để Tailwind quét được. */
export const TONE_CLASS: Record<Tone, { text: string; fg: string; bg: string; border: string; dot: string; soft: string }> = {
  ok: { text: 'text-ok', fg: 'text-ok-fg', bg: 'bg-ok', border: 'border-ok-border', dot: 'bg-ok', soft: 'bg-ok-bg text-ok-fg border-ok-border' },
  warn: { text: 'text-warn', fg: 'text-warn-fg', bg: 'bg-warn', border: 'border-warn-border', dot: 'bg-warn', soft: 'bg-warn-bg text-warn-fg border-warn-border' },
  crit: { text: 'text-crit', fg: 'text-crit-fg', bg: 'bg-crit', border: 'border-crit-border', dot: 'bg-crit', soft: 'bg-crit-bg text-crit-fg border-crit-border' },
  info: { text: 'text-info', fg: 'text-info-fg', bg: 'bg-info', border: 'border-info-border', dot: 'bg-info', soft: 'bg-info-bg text-info-fg border-info-border' },
  unknown: {
    text: 'text-unknown',
    fg: 'text-unknown-fg',
    bg: 'bg-unknown',
    border: 'border-unknown-border',
    dot: 'bg-unknown',
    soft: 'bg-unknown-bg text-unknown-fg border-unknown-border',
  },
};

/** Tên biến CSS của tông — cho nơi cần giá trị màu thật (biểu đồ). */
export const toneVar = (tone: Tone): string => `--ui-${tone}`;
