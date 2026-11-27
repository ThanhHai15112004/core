/**
 * Bộ khớp biểu thức Cron 5 trường chuẩn (`minute hour dayOfMonth month dayOfWeek`)
 * phục vụ kiểm tra chính sách backup đến hạn không phụ thuộc thư viện ngoài.
 */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const trimmed = field.trim();
  if (!trimmed) return null;
  const values = new Set<number>();

  for (const part of trimmed.split(',')) {
    const seg = part.trim();
    if (!seg) return null;

    const [rangePart, stepStr] = seg.split('/');
    const step = stepStr !== undefined ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;

    if (rangePart === '*') {
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }

    if (rangePart?.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      const start = Number(startStr);
      const end = Number(endStr);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < min ||
        end > max ||
        start > end
      ) {
        return null;
      }
      for (let v = start; v <= end; v += step) values.add(v);
      continue;
    }

    const exact = Number(rangePart);
    if (!Number.isInteger(exact) || exact < min || exact > max) return null;
    values.add(exact);
  }

  return values.size > 0 ? values : null;
}

export interface ParsedCron {
  readonly minutes: Set<number>;
  readonly hours: Set<number>;
  readonly daysOfMonth: Set<number>;
  readonly months: Set<number>;
  readonly daysOfWeek: Set<number>;
}

/** Phân tích chuỗi cron 5 trường; trả null nếu không hợp lệ. */
export function parseCronExpression(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseCronField(parts[0]!, 0, 59);
  const hours = parseCronField(parts[1]!, 0, 23);
  const daysOfMonth = parseCronField(parts[2]!, 1, 31);
  const months = parseCronField(parts[3]!, 1, 12);
  const rawDow = parseCronField(parts[4]!, 0, 7);
  if (!minutes || !hours || !daysOfMonth || !months || !rawDow) return null;

  const daysOfWeek = new Set<number>();
  for (const d of rawDow) {
    daysOfWeek.add(d === 7 ? 0 : d);
  }
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

/** Kiểm tra thời điểm `date` (làm tròn xuống phút) có khớp biểu thức cron không. */
export function matchesCronMinute(parsed: ParsedCron, date: Date): boolean {
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.daysOfMonth.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.daysOfWeek.has(date.getDay())
  );
}

/** Tính mốc chạy kế tiếp trong vòng 40 ngày tới. */
export function computeNextRunAt(expression: string, fromDate: Date = new Date()): Date | null {
  const parsed = parseCronExpression(expression);
  if (!parsed) return null;

  const cursor = new Date(fromDate.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxMinutes = 40 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    if (matchesCronMinute(parsed, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Kiểm tra chính sách backup đã đến hạn chạy tại `now` chưa:
 * - Nếu chưa từng chạy (`lastRunAt === null`), chỉ kích hoạt nếu phút hiện tại khớp cron hoặc đã tạo quá 1 chu kỳ.
 * - Nếu đã có `lastRunAt`, kiểm tra xem có ít nhất 1 tick cron nằm trong `(lastRunAt, now]` (tối đa quét lùi 48h).
 */
export function isCronDue(
  expression: string,
  lastRunAt: Date | null,
  now: Date = new Date(),
): boolean {
  const parsed = parseCronExpression(expression);
  if (!parsed) return false;

  const nowMinute = new Date(now.getTime());
  nowMinute.setSeconds(0, 0);

  if (!lastRunAt) {
    return matchesCronMinute(parsed, nowMinute);
  }

  const lastMinute = new Date(lastRunAt.getTime());
  lastMinute.setSeconds(0, 0);
  if (nowMinute.getTime() <= lastMinute.getTime()) {
    return false;
  }

  const lookbackLimitMs = 48 * 60 * 60 * 1000;
  const startMs = Math.max(lastMinute.getTime() + 60_000, nowMinute.getTime() - lookbackLimitMs);

  for (let t = nowMinute.getTime(); t >= startMs; t -= 60_000) {
    if (matchesCronMinute(parsed, new Date(t))) {
      return true;
    }
  }
  return false;
}
