import { describe, it, expect } from '@jest/globals';
import {
  classifyTaskError,
  describeCron,
  describeSchedule,
  hasDst,
  nextRuns,
  runsBetween,
  TaskError,
  utcOffsetLabel,
  validateSchedule,
  type ScheduleSpec,
} from '@packages/scheduler/index.js';

const cron = (expr: string, timezone = 'Asia/Ho_Chi_Minh'): ScheduleSpec => ({
  type: 'cron',
  cron: expr,
  intervalMs: null,
  runAt: null,
  timezone,
});

describe('Scheduler — mô tả lịch cho người đọc', () => {
  it.each([
    ['*/5 * * * *', 'everyNMinutes', { n: 5 }],
    ['* * * * *', 'everyMinute', {}],
    ['0 * * * *', 'hourly', {}],
    ['15 * * * *', 'hourlyAt', { minute: '15' }],
    ['0 */6 * * *', 'everyNHours', { n: 6, minute: '00' }],
    ['0 2 * * *', 'daily', { time: '02:00' }],
    ['30 1,13 * * *', 'daily', { time: '01:30, 13:30' }],
    ['0 9 * * 1-5', 'weekdays', { time: '09:00' }],
    ['0 10 * * 0,6', 'weekends', { time: '10:00' }],
    ['0 3 1 * *', 'monthly', { day: 1, time: '03:00' }],
    ['0 0 25 12 *', 'yearly', { day: 25, month: 12, time: '00:00' }],
    ['*/10 * * * * *', 'everyNSeconds', { n: 10 }],
  ])('%s → %s', (expr, key, params) => {
    expect(describeCron(expr)).toMatchObject({ key, params });
  });

  it('thứ trong tuần trả về dạng số (tầng trên dịch tên ngày); 7 = Chủ nhật', () => {
    expect(describeCron('0 8 * * 1,3,7')).toEqual({
      key: 'weekly',
      params: { time: '08:00' },
      days: [0, 1, 3],
    });
  });

  it('biểu thức không nhận dạng được → custom, vẫn giữ biểu thức gốc', () => {
    expect(describeCron('5-10 2 * * *')).toEqual({
      key: 'custom',
      params: { expression: '5-10 2 * * *' },
    });
    expect(describeCron('0 0 L * *').key).toBe('custom');
  });

  it('interval / one-time không ép thành cron', () => {
    const base = { cron: null, runAt: null, timezone: 'UTC' };
    expect(describeSchedule({ ...base, type: 'interval', intervalMs: 30_000 })).toEqual({
      key: 'everyNSeconds',
      params: { n: 30 },
    });
    expect(describeSchedule({ ...base, type: 'interval', intervalMs: 3600_000 })).toEqual({
      key: 'hourly',
      params: {},
    });
    expect(describeSchedule({ ...base, type: 'one_time', intervalMs: null, runAt: 1000 })).toEqual({
      key: 'once',
      params: { at: 1000 },
    });
  });
});

describe('Scheduler — tính lịch chạy', () => {
  it('cron theo múi giờ của task (02:00 Asia/Ho_Chi_Minh = 19:00 UTC hôm trước)', () => {
    const from = Date.parse('2026-09-30T12:00:00Z');
    const runs = nextRuns(cron('0 2 * * *'), from, 2).map((t) => new Date(t).toISOString());
    expect(runs).toEqual(['2026-09-30T19:00:00.000Z', '2026-10-01T19:00:00.000Z']);
  });

  it('không tính đúng mốc `from`, dừng ở `until`', () => {
    const from = Date.parse('2026-09-30T10:05:00Z');
    expect(
      nextRuns(cron('*/5 * * * *', 'UTC'), from, 10, from + 12 * 60_000).map((t) =>
        new Date(t).toISOString(),
      ),
    ).toEqual(['2026-09-30T10:10:00.000Z', '2026-09-30T10:15:00.000Z']);
  });

  it('interval căn theo bội số chu kỳ — mọi instance cùng ra một mốc', () => {
    const spec: ScheduleSpec = {
      type: 'interval',
      cron: null,
      intervalMs: 60_000,
      runAt: null,
      timezone: 'UTC',
    };
    expect(nextRuns(spec, 125_000, 3)).toEqual([180_000, 240_000, 300_000]);
  });

  it('one-time: chỉ một mốc nếu còn ở tương lai', () => {
    const spec: ScheduleSpec = {
      type: 'one_time',
      cron: null,
      intervalMs: null,
      runAt: 5000,
      timezone: 'UTC',
    };
    expect(nextRuns(spec, 1000, 5)).toEqual([5000]);
    expect(nextRuns(spec, 6000, 5)).toEqual([]);
  });

  it('đếm số mốc bị lỡ trong một khoảng (scheduler ngừng 2 giờ, task 5 phút → 24)', () => {
    const from = Date.parse('2026-09-30T08:00:00Z');
    expect(runsBetween(cron('*/5 * * * *', 'UTC'), from, from + 2 * 3600_000)).toHaveLength(24);
  });

  it('lịch không hợp lệ bị phát hiện và không sinh mốc', () => {
    expect(validateSchedule(cron('61 * * * *'))).toMatch(/out of range/);
    expect(validateSchedule(cron('0 1 * * *', 'Mars/Base'))).toMatch(/timezone/i);
    expect(
      validateSchedule({
        type: 'interval',
        cron: null,
        intervalMs: 10,
        runAt: null,
        timezone: 'UTC',
      }),
    ).toMatch(/at least/);
    expect(nextRuns(cron('61 * * * *'), 0, 3)).toEqual([]);
  });

  it('nhãn UTC offset và DST', () => {
    expect(utcOffsetLabel('Asia/Ho_Chi_Minh')).toBe('UTC+7');
    expect(utcOffsetLabel('UTC')).toBe('UTC');
    expect(utcOffsetLabel('Asia/Kolkata')).toBe('UTC+5:30');
    expect(hasDst('America/New_York', 2026)).toBe(true);
    expect(hasDst('Asia/Ho_Chi_Minh', 2026)).toBe(false);
  });
});

describe('Scheduler — phân loại lỗi', () => {
  it('TaskError giữ loại; lỗi kết nối → DependencyUnavailable; message bị che mật khẩu', () => {
    expect(classifyTaskError(new TaskError('StorageTimeout', 'Unable to upload'))).toEqual({
      type: 'StorageTimeout',
      message: 'Unable to upload',
    });
    const conn = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    expect(classifyTaskError(conn).type).toBe('DependencyUnavailable');
    expect(classifyTaskError(new Error('boom')).type).toBe('UnhandledException');
    expect(classifyTaskError(new Error('redis://user:secret@host failed')).message).toBe(
      'redis://***@host failed',
    );
    class QueryFailedError extends Error {
      override name = 'QueryFailedError';
    }
    expect(classifyTaskError(new QueryFailedError('x')).type).toBe('QueryFailedError');
  });
});
