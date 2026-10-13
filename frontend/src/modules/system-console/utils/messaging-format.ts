import { NO_VALUE, UNIT, formatCompact, formatDuration, formatRate, isNil, type Nullable } from '@core/lib/format';
import type { TimeSeries } from '@core/ui/charts';
import type { MessageRow, MessagingSeries } from '../types/messaging.types';
import { MESSAGING_SERIES_COLOR } from '../constants/messaging';

/** Đơn vị series của backend messaging. */
const SERIES_UNIT = { perSec: '/s', perMin: '/min', ms: 'ms', count: 'msgs' } as const;

/** Giây → `2d 8h`, `18m`, `42s` (tuổi message chờ lâu nhất). Worker & Queue cũng dùng. */
export function formatAge(sec: Nullable<number>): string {
  if (isNil(sec)) return NO_VALUE;
  if (sec < 60) return `${sec}${UNIT.s}`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}${UNIT.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${UNIT.h} ${m % 60}${UNIT.m}`;
  return `${Math.floor(h / 24)}${UNIT.d} ${h % 24}${UNIT.h}`;
}

/** Tốc độ message: `842/s`; nhỏ hơn 1/s thì theo phút cho dễ đọc (`12/min`). */
export function formatMsgRate(perSec: Nullable<number>, locale: string): string {
  if (isNil(perSec)) return NO_VALUE;
  if (perSec > 0 && perSec < 1) return formatRate(perSec * 60, locale, 'min');
  return formatRate(perSec, locale, 'sec');
}

/** Chênh lệch có dấu (`+2.1/s`). */
export function formatSignedRate(perSec: Nullable<number>, locale: string): string {
  if (isNil(perSec)) return NO_VALUE;
  return `${perSec > 0 ? '+' : ''}${formatMsgRate(perSec, locale)}`;
}

/** Hàm định dạng giá trị theo đơn vị series. */
export function seriesFormatter(unit: string, locale: string): (v: number | null) => string {
  switch (unit) {
    case SERIES_UNIT.perSec:
      return (v) => formatRate(v, locale, 'sec');
    case SERIES_UNIT.perMin:
      return (v) => formatRate(v, locale, 'min');
    case SERIES_UNIT.ms:
      return (v) => formatDuration(v);
    default:
      return (v) => formatCompact(v, locale);
  }
}

/** Series backend → series biểu đồ (màu theo id, series khác đơn vị đặt trục phải). */
export function toTimeSeries(list: MessagingSeries[]): { series: TimeSeries[]; unit: string; rightUnit: string | null } {
  const unit = list[0]?.unit ?? '';
  const right = list.find((s) => s.unit !== unit)?.unit ?? null;
  return {
    unit,
    rightUnit: right,
    series: list.map((s) => ({
      id: s.id,
      label: s.label,
      ...(MESSAGING_SERIES_COLOR[s.id] ? { color: MESSAGING_SERIES_COLOR[s.id] } : {}),
      ...(s.unit !== unit ? { axis: 'right' as const } : {}),
      points: s.points.map((p) => ({ t: p.t, v: p.value })),
    })),
  };
}

/** Khoá i18n của trạng thái idempotent (`messaging.idempotent.<key>`). */
export const idemKey = (v: boolean | null | undefined): 'yes' | 'no' | 'unknown' => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

/** Id hàng của một message (cùng ID có thể nằm ở nhiều queue). */
export const messageRowId = (m: Pick<MessageRow, 'id' | 'queue'>): string => `${m.queue}:${m.id}`;
