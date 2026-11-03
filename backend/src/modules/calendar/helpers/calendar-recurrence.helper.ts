import {
  BadRequestAppException,
  safeJsonParse,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import { getCalendarEventStatusName } from '../contracts/index.js';
import type { CalendarEventEntity } from '../entities/calendar-event.entity.js';
import {
  CALENDAR_RECURRENCE_FREQUENCY,
  type CalendarRecurrenceFrequency,
} from '../enum/calendar.enum.js';
import type { CreateCalendarReminderInput } from '../repositories/calendar-event-reminder.repository.js';
import type {
  CalendarEventOccurrenceView,
  CalendarRecurrenceRule,
  CalendarReminderRule,
} from '../types/calendar.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRecurrenceRule(raw: string | null | undefined): CalendarRecurrenceRule | null {
  if (!raw || !raw.trim()) return null;
  const parsed = safeJsonParseObject<Partial<CalendarRecurrenceRule>>(raw, {});
  const freq = String(parsed.frequency ?? '')
    .trim()
    .toUpperCase() as CalendarRecurrenceFrequency;
  if (
    freq !== CALENDAR_RECURRENCE_FREQUENCY.DAILY &&
    freq !== CALENDAR_RECURRENCE_FREQUENCY.WEEKLY &&
    freq !== CALENDAR_RECURRENCE_FREQUENCY.MONTHLY
  ) {
    return null;
  }
  const interval = Math.max(1, Number(parsed.interval ?? 1) || 1);
  const byWeekDays = Array.isArray(parsed.byWeekDays)
    ? [...new Set(parsed.byWeekDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))].sort(
        (a, b) => a - b,
      )
    : undefined;
  const byMonthDay =
    parsed.byMonthDay !== undefined && parsed.byMonthDay !== null
      ? Number(parsed.byMonthDay)
      : null;
  const count =
    parsed.count !== undefined && parsed.count !== null && Number(parsed.count) > 0
      ? Number(parsed.count)
      : null;
  const until =
    typeof parsed.until === 'string' && parsed.until.trim() ? parsed.until.trim() : null;
  const exceptionDates = Array.isArray(parsed.exceptionDates)
    ? parsed.exceptionDates.map((d) => String(d).trim().slice(0, 10)).filter(Boolean)
    : undefined;

  return {
    frequency: freq,
    interval,
    ...(byWeekDays && byWeekDays.length > 0 ? { byWeekDays } : {}),
    ...(byMonthDay ? { byMonthDay } : {}),
    ...(count ? { count } : {}),
    ...(until ? { until } : {}),
    ...(exceptionDates && exceptionDates.length > 0 ? { exceptionDates } : {}),
  };
}

export function validateRecurrenceRule(
  rule: CalendarRecurrenceRule | null | undefined,
  eventStartAt: Date,
  maxAllowedOccurrences = 180,
): CalendarRecurrenceRule | null {
  if (!rule || rule.frequency === CALENDAR_RECURRENCE_FREQUENCY.NONE) {
    return null;
  }
  const freq = rule.frequency;
  if (
    freq !== CALENDAR_RECURRENCE_FREQUENCY.DAILY &&
    freq !== CALENDAR_RECURRENCE_FREQUENCY.WEEKLY &&
    freq !== CALENDAR_RECURRENCE_FREQUENCY.MONTHLY
  ) {
    throw new BadRequestAppException('calendar.invalidRecurrenceRule', [], {
      reason: `Unsupported frequency: ${String(freq)}`,
    });
  }
  const interval = Number(rule.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new BadRequestAppException('calendar.invalidRecurrenceRule', [], {
      reason: 'interval must be between 1 and 365',
    });
  }
  if (rule.count !== undefined && rule.count !== null) {
    const countVal = Number(rule.count);
    if (!Number.isInteger(countVal) || countVal < 1 || countVal > maxAllowedOccurrences) {
      throw new BadRequestAppException('calendar.invalidRecurrenceRule', [], {
        reason: `count must be between 1 and ${maxAllowedOccurrences}`,
      });
    }
  }
  if (rule.until) {
    const untilDate = new Date(rule.until);
    if (Number.isNaN(untilDate.getTime()) || untilDate.getTime() < eventStartAt.getTime()) {
      throw new BadRequestAppException('calendar.invalidRecurrenceRule', [], {
        reason: 'until must be a valid date after startAt',
      });
    }
  }
  if (rule.byMonthDay !== undefined && rule.byMonthDay !== null) {
    const md = Number(rule.byMonthDay);
    if (!Number.isInteger(md) || md < 1 || md > 31) {
      throw new BadRequestAppException('calendar.invalidRecurrenceRule', [], {
        reason: 'byMonthDay must be between 1 and 31',
      });
    }
  }
  return parseRecurrenceRule(JSON.stringify(rule));
}

export function expandEventOccurrences(params: {
  event: CalendarEventEntity;
  rangeStart?: Date | undefined;
  rangeEnd?: Date | undefined;
  maxOccurrences?: number | undefined;
}): CalendarEventOccurrenceView[] {
  const { event, rangeStart, rangeEnd, maxOccurrences = 60 } = params;
  const baseStart = new Date(event.startAt);
  const baseEnd = new Date(event.endAt);
  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const rule = parseRecurrenceRule(event.recurrenceRuleJson);
  const statusName = getCalendarEventStatusName(event.status);

  const makeView = (
    idx: number,
    startMs: number,
    isRecurring: boolean,
  ): CalendarEventOccurrenceView => ({
    occurrenceIndex: idx,
    eventId: Number(event.id),
    eventCode: event.code,
    title: event.title,
    eventType: event.eventType,
    status: event.status,
    statusName,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + durationMs).toISOString(),
    isAllDay: Boolean(event.isAllDay),
    isRecurringInstance: isRecurring,
    location: event.location ?? null,
    resourceCode: event.resourceCode ?? null,
    resourceName: event.resourceName ?? null,
    ownerUserId: Number(event.ownerUserId),
    organizationUnitId: event.organizationUnitId ?? null,
  });

  const withinRange = (occStartMs: number): boolean => {
    const occEndMs = occStartMs + durationMs;
    if (rangeStart && occEndMs <= rangeStart.getTime()) return false;
    if (rangeEnd && occStartMs >= rangeEnd.getTime()) return false;
    return true;
  };

  if (!rule) {
    if (!withinRange(baseStart.getTime())) return [];
    return [makeView(1, baseStart.getTime(), false)];
  }

  const limitCount = Math.min(rule.count ?? maxOccurrences, maxOccurrences);
  const untilMs = rule.until ? new Date(rule.until).getTime() : null;
  const exceptionSet = new Set(rule.exceptionDates ?? []);
  const occurrences: CalendarEventOccurrenceView[] = [];

  const candidateStarts: number[] = [];

  if (rule.frequency === CALENDAR_RECURRENCE_FREQUENCY.DAILY) {
    for (let step = 0; candidateStarts.length < limitCount && step < limitCount * 3; step++) {
      const startMs = baseStart.getTime() + step * rule.interval * DAY_MS;
      if (untilMs !== null && startMs > untilMs) break;
      if (rangeEnd && startMs >= rangeEnd.getTime()) break;
      const dateStr = new Date(startMs).toISOString().slice(0, 10);
      if (!exceptionSet.has(dateStr)) {
        candidateStarts.push(startMs);
      }
    }
  } else if (rule.frequency === CALENDAR_RECURRENCE_FREQUENCY.WEEKLY) {
    const weekDays =
      rule.byWeekDays && rule.byWeekDays.length > 0 ? rule.byWeekDays : [baseStart.getUTCDay()];
    const baseHours = baseStart.getUTCHours();
    const baseMinutes = baseStart.getUTCMinutes();
    const baseSeconds = baseStart.getUTCSeconds();
    const baseMillis = baseStart.getUTCMilliseconds();

    const startOfBaseWeek = new Date(
      Date.UTC(
        baseStart.getUTCFullYear(),
        baseStart.getUTCMonth(),
        baseStart.getUTCDate() - baseStart.getUTCDay(),
        baseHours,
        baseMinutes,
        baseSeconds,
        baseMillis,
      ),
    );

    for (
      let weekIdx = 0;
      candidateStarts.length < limitCount && weekIdx < limitCount * 2;
      weekIdx++
    ) {
      const weekBaseMs = startOfBaseWeek.getTime() + weekIdx * rule.interval * 7 * DAY_MS;
      if (untilMs !== null && weekBaseMs > untilMs + 7 * DAY_MS) break;
      if (rangeEnd && weekBaseMs >= rangeEnd.getTime()) break;

      for (const dow of weekDays) {
        if (candidateStarts.length >= limitCount) break;
        const occMs = weekBaseMs + dow * DAY_MS;
        if (occMs < baseStart.getTime()) continue;
        if (untilMs !== null && occMs > untilMs) continue;
        if (rangeEnd && occMs >= rangeEnd.getTime()) continue;
        const dateStr = new Date(occMs).toISOString().slice(0, 10);
        if (!exceptionSet.has(dateStr)) {
          candidateStarts.push(occMs);
        }
      }
    }
  } else if (rule.frequency === CALENDAR_RECURRENCE_FREQUENCY.MONTHLY) {
    const targetDay = rule.byMonthDay ?? baseStart.getUTCDate();
    for (let mStep = 0; candidateStarts.length < limitCount && mStep < limitCount * 2; mStep++) {
      const totalMonths = baseStart.getUTCMonth() + mStep * rule.interval;
      const year = baseStart.getUTCFullYear() + Math.floor(totalMonths / 12);
      const month = totalMonths % 12;
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const clampedDay = Math.min(targetDay, daysInMonth);
      const occDate = new Date(
        Date.UTC(
          year,
          month,
          clampedDay,
          baseStart.getUTCHours(),
          baseStart.getUTCMinutes(),
          baseStart.getUTCSeconds(),
          baseStart.getUTCMilliseconds(),
        ),
      );
      const occMs = occDate.getTime();
      if (occMs < baseStart.getTime()) continue;
      if (untilMs !== null && occMs > untilMs) break;
      if (rangeEnd && occMs >= rangeEnd.getTime()) break;
      const dateStr = occDate.toISOString().slice(0, 10);
      if (!exceptionSet.has(dateStr)) {
        candidateStarts.push(occMs);
      }
    }
  }

  let idx = 1;
  for (const startMs of candidateStarts) {
    if (withinRange(startMs)) {
      occurrences.push(makeView(idx, startMs, true));
    }
    idx++;
  }

  return occurrences;
}

export function parseReminderRules(
  raw: string | null | undefined,
  defaultMinutesBefore = 15,
): CalendarReminderRule[] {
  if (!raw || !raw.trim()) {
    return [{ minutesBefore: defaultMinutesBefore, channels: ['IN_APP'] }];
  }
  const list = safeJsonParse<Partial<CalendarReminderRule>[]>(raw, []) ?? [];
  if (!Array.isArray(list) || list.length === 0) return [];
  const normalized: CalendarReminderRule[] = [];
  const seenMinutes = new Set<number>();

  for (const item of list) {
    const mins = Math.max(0, Number(item.minutesBefore ?? defaultMinutesBefore));
    if (seenMinutes.has(mins)) continue;
    seenMinutes.add(mins);
    const channels =
      Array.isArray(item.channels) && item.channels.length > 0
        ? [...new Set(item.channels.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
        : ['IN_APP'];
    normalized.push({ minutesBefore: mins, channels });
  }
  return normalized.sort((a, b) => b.minutesBefore - a.minutesBefore);
}

export function buildScheduledReminderInputs(params: {
  event: CalendarEventEntity;
  reminderRules: readonly CalendarReminderRule[];
  maxOccurrencesToSchedule?: number | undefined;
}): CreateCalendarReminderInput[] {
  const { event, reminderRules, maxOccurrencesToSchedule = 12 } = params;
  if (reminderRules.length === 0) return [];

  const occurrences = expandEventOccurrences({
    event,
    maxOccurrences: maxOccurrencesToSchedule,
  });

  const inputs: CreateCalendarReminderInput[] = [];
  for (const occ of occurrences) {
    const occStart = new Date(occ.startAt);
    for (const rule of reminderRules) {
      const remindAt = new Date(occStart.getTime() - rule.minutesBefore * 60_000);
      inputs.push({
        calendarEventId: Number(event.id),
        occurrenceStartAt: occStart,
        minutesBefore: rule.minutesBefore,
        remindAt,
        channels: rule.channels,
      });
    }
  }
  return inputs;
}
