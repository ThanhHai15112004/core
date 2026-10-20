/**
 * Định dạng số liệu dùng chung. Hàm thuần, nhận `locale` từ `useLocale()` (hoặc dùng `useFormat()`).
 * Quy ước: null/undefined → `NO_VALUE` (không bao giờ tự biến thành 0).
 */

/** Ký hiệu "không có dữ liệu". */
export const NO_VALUE = '—';

/** Ký hiệu thay cho giá trị bí mật (không bao giờ hiển thị giá trị thật). */
export const MASKED_VALUE = '••••••••';

/** Ký hiệu đơn vị kỹ thuật (không dịch). */
export const UNIT = {
  ms: 'ms',
  s: 's',
  m: 'm',
  h: 'h',
  d: 'd',
  percent: '%',
  perSec: '/s',
  perMin: '/min',
  bytes: ['B', 'KB', 'MB', 'GB', 'TB', 'PB'],
} as const;

const BYTE_BASE = 1024;
const COMPACT_FROM = 10_000;

export type Nullable<T> = T | null | undefined;
export const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;

/** Làm tròn tối đa `digits` chữ số thập phân, bỏ số 0 thừa. */
export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function formatNumber(n: Nullable<number>, locale: string, digits = 0): string {
  if (isNil(n) || Number.isNaN(n)) return NO_VALUE;
  return n.toLocaleString(locale, { maximumFractionDigits: digits });
}

/** < 10.000 hiện đầy đủ (12.345 → 12,3K chỉ khi lớn). */
export function formatCompact(n: Nullable<number>, locale: string): string {
  if (isNil(n) || Number.isNaN(n)) return NO_VALUE;
  if (Math.abs(n) < COMPACT_FROM) return n.toLocaleString(locale, { maximumFractionDigits: 1 });
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** 3506176 → "3.34 MB". */
export function formatBytes(bytes: Nullable<number>): string {
  if (isNil(bytes) || Number.isNaN(bytes)) return NO_VALUE;
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= BYTE_BASE && i < UNIT.bytes.length - 1) {
    v /= BYTE_BASE;
    i++;
  }
  const digits = i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${bytes < 0 ? '-' : ''}${v.toFixed(digits)} ${UNIT.bytes[i]}`;
}

export const formatSignedBytes = (bytes: Nullable<number>): string =>
  isNil(bytes) ? NO_VALUE : `${bytes > 0 ? '+' : ''}${formatBytes(bytes)}`;

/** MB → "512 MB" / "1.50 GB". */
export function formatMb(mb: Nullable<number>): string {
  if (isNil(mb)) return NO_VALUE;
  return formatBytes(mb * BYTE_BASE * BYTE_BASE);
}

/** Giây → "6d 17h", "2h 5m", "45s". */
export function formatUptime(seconds: Nullable<number>): string {
  if (isNil(seconds) || Number.isNaN(seconds)) return NO_VALUE;
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}${UNIT.d} ${h}${UNIT.h}`;
  if (h > 0) return `${h}${UNIT.h} ${m}${UNIT.m}`;
  if (m > 0) return `${m}${UNIT.m} ${Math.floor(seconds % 60)}${UNIT.s}`;
  return `${Math.floor(seconds)}${UNIT.s}`;
}

/** Mili-giây → "840 ms", "8.4 s", "2m 14s", "3h 5m". */
export function formatDuration(ms: Nullable<number>): string {
  if (isNil(ms) || Number.isNaN(ms)) return NO_VALUE;
  if (Math.abs(ms) < 1000) return `${round(ms, ms < 10 ? 1 : 0)} ${UNIT.ms}`;
  if (Math.abs(ms) < 60_000) return `${round(ms / 1000, 1)} ${UNIT.s}`;
  return formatUptime(ms / 1000);
}

export function formatPercent(v: Nullable<number>, digits = 1): string {
  if (isNil(v) || Number.isNaN(v)) return NO_VALUE;
  return `${round(v, digits)}${UNIT.percent}`;
}

/** Tốc độ: 0.42 → "0.42/s"; lớn thì gọn. */
export function formatRate(v: Nullable<number>, locale: string, per: 'sec' | 'min' = 'sec'): string {
  if (isNil(v) || Number.isNaN(v)) return NO_VALUE;
  const unit = per === 'sec' ? UNIT.perSec : UNIT.perMin;
  const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
  return `${formatCompactDigits(v, locale, digits)}${unit}`;
}

function formatCompactDigits(n: number, locale: string, digits: number): string {
  if (Math.abs(n) < COMPACT_FROM) return n.toLocaleString(locale, { maximumFractionDigits: digits });
  return formatCompact(n, locale);
}

/** Thay đổi có dấu: 12.34 → "+12.3%", null → null (để ẩn hẳn). */
export function formatDelta(v: Nullable<number>, digits = 1, suffix: string = UNIT.percent): string | null {
  if (isNil(v) || Number.isNaN(v)) return null;
  const r = round(v, digits);
  return `${r > 0 ? '+' : ''}${r}${suffix}`;
}

/** Giá trị kèm đơn vị tuỳ ý (đã có sẵn từ API). */
export function formatWithUnit(v: Nullable<number>, unit: string, locale: string, digits = 2): string {
  if (isNil(v) || Number.isNaN(v)) return NO_VALUE;
  switch (unit) {
    case 'ms':
      return formatDuration(v);
    case 'bytes':
      return formatBytes(v);
    case '%':
    case 'percent':
      return formatPercent(v, digits);
    default:
      return unit ? `${formatNumber(v, locale, digits)} ${unit}` : formatNumber(v, locale, digits);
  }
}

/** Rút gọn id dài: giữ đầu + cuối. */
export function shortId(id: string, head = 8, tail = 4): string {
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${tail > 0 ? id.slice(-tail) : ''}` : id;
}

/** Thay đổi phần trăm giữa hai giá trị; null khi không so được. */
export function changePercent(current: Nullable<number>, previous: Nullable<number>): number | null {
  if (isNil(current) || isNil(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Giá trị theo ký hiệu đơn vị backend gửi kèm series: `B` / `B/s` (byte), `%`, `/s`, `/min`, `ms`, `s`;
 * đơn vị khác → số kèm đơn vị, rỗng → số gọn.
 */
export function formatMetric(v: Nullable<number>, unit: string, locale: string): string {
  if (isNil(v) || Number.isNaN(v)) return NO_VALUE;
  switch (unit) {
    case 'B':
    case 'bytes':
      return formatBytes(v);
    case 'B/s':
      return `${formatBytes(v)}${UNIT.perSec}`;
    case '%':
    case 'percent':
      return formatPercent(v);
    case '/s':
      return formatRate(v, locale, 'sec');
    case '/min':
      return formatRate(v, locale, 'min');
    case 'ms':
      return formatDuration(v);
    case 's':
      return formatDuration(v * 1000);
    case '':
      return formatCompact(v, locale);
    default:
      return `${formatCompact(v, locale)} ${unit}`;
  }
}

/** Chu kỳ ngắn: 5000 → "5s", 60000 → "1m", 5400000 → "1.5h". */
export function formatInterval(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${round(s, 1)}${UNIT.s}`;
  if (s < 3600) return `${round(s / 60, 1)}${UNIT.m}`;
  return `${round(s / 3600, 1)}${UNIT.h}`;
}

/** 5.3.6: Định dạng tiền tệ chuẩn theo locale & mã tiền tệ ISO 4217 (mặc định VND cho vi, USD cho en). */
export function formatCurrency(
  amount: Nullable<number>,
  locale: string,
  currencyCode?: string,
): string {
  if (isNil(amount) || Number.isNaN(amount)) return NO_VALUE;
  const isVi = locale.toLowerCase().startsWith('vi');
  const bcp47 = isVi ? 'vi-VN' : 'en-US';
  const currency = currencyCode?.trim().toUpperCase() || (isVi ? 'VND' : 'USD');
  return new Intl.NumberFormat(bcp47, {
    style: 'currency',
    currency,
  }).format(amount);
}

/** 5.3.4 & 5.3.6: Định dạng ngày (dd/MM/yyyy cho vi, MM/dd/yyyy cho en) theo múi giờ người dùng. */
export function formatDate(
  value: Nullable<Date | string | number>,
  locale: string,
  timeZone = 'Asia/Ho_Chi_Minh',
): string {
  if (isNil(value) || value === '') return NO_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_VALUE;
  const bcp47 = locale.toLowerCase().startsWith('vi') ? 'vi-VN' : 'en-US';
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

/** 5.3.4, 5.3.5 & 5.3.6: Định dạng ngày giờ đầy đủ theo locale và múi giờ người dùng. */
export function formatDateTime(
  value: Nullable<Date | string | number>,
  locale: string,
  timeZone = 'Asia/Ho_Chi_Minh',
  withSeconds = false,
): string {
  if (isNil(value) || value === '') return NO_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_VALUE;
  const bcp47 = locale.toLowerCase().startsWith('vi') ? 'vi-VN' : 'en-US';
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
    timeZone,
  }).format(date);
}
