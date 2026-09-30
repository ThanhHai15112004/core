import { CronTime, validateCronExpression } from 'cron';
import type { ScheduleSpec } from '../contracts/scheduler.types.js';

/** Chu kỳ tối thiểu của task interval. */
export const MIN_INTERVAL_MS = 1000;
/** Giới hạn số mốc khi đếm / liệt kê lịch (task chạy mỗi giây trong nhiều ngày). */
const MAX_OCCURRENCES = 10_000;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Lịch không hợp lệ → mô tả lỗi; hợp lệ → null. */
export function validateSchedule(spec: ScheduleSpec): string | null {
  if (!isValidTimezone(spec.timezone)) return `Invalid timezone: ${spec.timezone}`;
  switch (spec.type) {
    case 'cron': {
      if (!spec.cron) return 'Missing cron expression';
      const r = validateCronExpression(spec.cron);
      return r.valid ? null : (r.error?.message ?? 'Invalid cron expression');
    }
    case 'interval':
      return spec.intervalMs && spec.intervalMs >= MIN_INTERVAL_MS
        ? null
        : `Interval must be at least ${MIN_INTERVAL_MS}ms`;
    case 'one_time':
      return spec.runAt !== null && Number.isFinite(spec.runAt) ? null : 'Missing run time';
  }
}

/**
 * Các mốc chạy sau `from` (không tính đúng `from`), tối đa `count` mốc và không quá `until`.
 * Interval căn theo bội số chu kỳ tính từ epoch — mọi instance cùng ra một mốc (để khoá theo mốc).
 */
export function nextRuns(
  spec: ScheduleSpec,
  from: number,
  count: number,
  until = Infinity,
): number[] {
  const out: number[] = [];
  const limit = Math.min(count, MAX_OCCURRENCES);
  if (validateSchedule(spec)) return out;
  switch (spec.type) {
    case 'cron': {
      const ct = new CronTime(spec.cron!, spec.timezone);
      let cursor = from;
      while (out.length < limit) {
        const next = ct.getNextDateFrom(new Date(cursor), spec.timezone).toMillis();
        if (!Number.isFinite(next) || next > until || next <= cursor) break;
        out.push(next);
        cursor = next;
      }
      return out;
    }
    case 'interval': {
      const every = spec.intervalMs!;
      let next = Math.floor(from / every) * every + every;
      while (out.length < limit && next <= until) {
        out.push(next);
        next += every;
      }
      return out;
    }
    case 'one_time':
      return spec.runAt! > from && spec.runAt! <= until && limit > 0 ? [spec.runAt!] : [];
  }
}

export const nextRun = (spec: ScheduleSpec, from: number): number | null =>
  nextRuns(spec, from, 1)[0] ?? null;

/** Các mốc lịch trong khoảng `(from, to]` (tối đa MAX_OCCURRENCES) — dùng đếm lịch bị lỡ. */
export const runsBetween = (spec: ScheduleSpec, from: number, to: number): number[] =>
  nextRuns(spec, from, MAX_OCCURRENCES, to);

/** Độ lệch múi giờ tại thời điểm `at`, vd. `UTC+7`, `UTC-4`, `UTC+5:30`. */
export function utcOffsetLabel(tz: string, at = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part || part === 'GMT') return 'UTC';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    if (!m) return part.replace('GMT', 'UTC');
    const h = Number(m[2]);
    return `UTC${m[1]}${h}${m[3] === '00' ? '' : `:${m[3]}`}`;
  } catch {
    return tz;
  }
}

/** Múi giờ có đổi giờ mùa hè không (độ lệch tháng 1 khác tháng 7). */
export function hasDst(tz: string, year = new Date().getUTCFullYear()): boolean {
  return utcOffsetLabel(tz, Date.UTC(year, 0, 15)) !== utcOffsetLabel(tz, Date.UTC(year, 6, 15));
}

// ─── Mô tả lịch cho người đọc ──────────────────────────────────────────────

/**
 * Mô tả lịch theo dạng có cấu trúc: `key` (i18n `scheduler.schedule.<key>`) + tham số. `days` là thứ trong tuần
 * (0 = Chủ nhật) để tầng trên dịch tên ngày. Biểu thức không nhận dạng được → `custom`.
 */
export interface ScheduleDescription {
  key: string;
  params: Record<string, string | number>;
  days?: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const isNum = (f: string) => /^\d+$/.test(f);
const isAny = (f: string) => f === '*' || f === '?';
const stepOf = (f: string) => {
  const m = /^(?:\*|0)\/(\d+)$/.exec(f);
  return m ? Number(m[1]) : null;
};

/** `1,3,5` / `1-5` / `3` → danh sách số; null nếu có ký hiệu khác. */
function listOf(f: string, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of f.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b || b > max) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (isNum(part) && Number(part) <= max) out.add(Number(part));
    else return null;
  }
  return [...out].sort((a, b) => a - b);
}

function describeInterval(ms: number): ScheduleDescription {
  if (ms % 3_600_000 === 0)
    return ms === 3_600_000
      ? { key: 'hourly', params: {} }
      : { key: 'everyNHours', params: { n: ms / 3_600_000, minute: '00' } };
  if (ms % 60_000 === 0)
    return ms === 60_000
      ? { key: 'everyMinute', params: {} }
      : { key: 'everyNMinutes', params: { n: ms / 60_000 } };
  if (ms % 1000 === 0)
    return ms === 1000
      ? { key: 'everySecond', params: {} }
      : { key: 'everyNSeconds', params: { n: ms / 1000 } };
  return { key: 'everyNMs', params: { n: ms } };
}

export function describeCron(expression: string): ScheduleDescription {
  const custom = { key: 'custom', params: { expression } };
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return custom;
  const [sec, min, hour, dom, mon, dow] = (parts.length === 6 ? parts : ['0', ...parts]) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const everyDay = isAny(dom) && isAny(mon) && isAny(dow);

  if (sec !== '0') {
    if (!everyDay || !isAny(min) || !isAny(hour)) return custom;
    if (sec === '*') return { key: 'everySecond', params: {} };
    const s = stepOf(sec);
    return s ? { key: 'everyNSeconds', params: { n: s } } : custom;
  }

  if (everyDay) {
    if (isAny(min) && isAny(hour)) return { key: 'everyMinute', params: {} };
    const m = stepOf(min);
    if (m && isAny(hour)) return { key: 'everyNMinutes', params: { n: m } };
    if (isNum(min) && isAny(hour))
      return Number(min) === 0
        ? { key: 'hourly', params: {} }
        : { key: 'hourlyAt', params: { minute: pad(Number(min)) } };
    const h = stepOf(hour);
    if (isNum(min) && h) return { key: 'everyNHours', params: { n: h, minute: pad(Number(min)) } };
  }

  const hours = listOf(hour, 23);
  if (!isNum(min) || !hours || hours.length === 0 || hours.length > 6) return custom;
  const time = hours.map((h) => `${pad(h)}:${pad(Number(min))}`).join(', ');
  if (everyDay) return { key: 'daily', params: { time } };
  if (isAny(dom) && isAny(mon)) {
    const days = listOf(dow.replace(/\b7\b/g, '0'), 6);
    if (!days) return custom;
    if (days.join(',') === '1,2,3,4,5') return { key: 'weekdays', params: { time } };
    if (days.join(',') === '0,6') return { key: 'weekends', params: { time } };
    return { key: 'weekly', params: { time }, days };
  }
  if (isNum(dom) && isAny(dow)) {
    if (isAny(mon)) return { key: 'monthly', params: { day: Number(dom), time } };
    if (isNum(mon))
      return { key: 'yearly', params: { day: Number(dom), month: Number(mon), time } };
  }
  return custom;
}

export function describeSchedule(spec: ScheduleSpec): ScheduleDescription {
  switch (spec.type) {
    case 'cron':
      return spec.cron ? describeCron(spec.cron) : { key: 'custom', params: { expression: '' } };
    case 'interval':
      return describeInterval(spec.intervalMs ?? 0);
    case 'one_time':
      return { key: 'once', params: { at: spec.runAt ?? 0 } };
  }
}
