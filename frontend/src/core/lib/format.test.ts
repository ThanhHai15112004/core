import { describe, expect, it } from 'vitest';
import {
  NO_VALUE,
  changePercent,
  formatBytes,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDelta,
  formatDuration,
  formatMb,
  formatPercent,
  formatRate,
  formatUptime,
  formatWithUnit,
  shortId,
} from './format';

describe('format', () => {
  it('never turns null into 0', () => {
    for (const fn of [formatBytes, formatDuration, formatPercent, formatUptime, formatMb]) {
      expect(fn(null)).toBe(NO_VALUE);
      expect(fn(undefined)).toBe(NO_VALUE);
    }
    expect(formatCompact(null, 'en')).toBe(NO_VALUE);
    expect(formatRate(undefined, 'en')).toBe(NO_VALUE);
    expect(formatDelta(null)).toBeNull();
    expect(changePercent(5, 0)).toBeNull();
  });

  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(3_506_176)).toBe('3.34 MB');
    expect(formatBytes(-2048)).toBe('-2.00 KB');
    expect(formatMb(1536)).toBe('1.50 GB');
  });

  it('formats durations', () => {
    expect(formatDuration(840)).toBe('840 ms');
    expect(formatDuration(2.345)).toBe('2.3 ms');
    expect(formatDuration(8400)).toBe('8.4 s');
    expect(formatDuration(134_000)).toBe('2m 14s');
    expect(formatUptime(582_920)).toBe('6d 17h');
  });

  it('formats numbers, percent and deltas', () => {
    expect(formatCompact(4722, 'en')).toBe('4,722');
    expect(formatCompact(12_345, 'en')).toBe('12.3K');
    expect(formatPercent(57.6699)).toBe('57.7%');
    expect(formatPercent(0.87, 2)).toBe('0.87%');
    expect(formatDelta(12.34)).toBe('+12.3%');
    expect(formatDelta(-3)).toBe('-3%');
    expect(formatRate(0.4234, 'en')).toBe('0.42/s');
    expect(formatWithUnit(1500, 'ms', 'en')).toBe('1.5 s');
    expect(changePercent(150, 100)).toBe(50);
  });

  it('shortens ids', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId('0123456789abcdefXYZ')).toBe('01234567…fXYZ');
  });

  it('formats currency, date and datetime by locale and user timezone (5.3.4, 5.3.5, 5.3.6)', () => {
    expect(formatCurrency(null, 'vi')).toBe(NO_VALUE);
    expect(formatCurrency(1_250_000, 'vi', 'VND')).toContain('1.250.000');
    expect(formatCurrency(1250.5, 'en', 'USD')).toContain('$1,250.50');

    const utcIso = '2026-10-20T18:30:00.000Z';
    expect(formatDate(utcIso, 'vi', 'UTC')).toBe('20/10/2026');
    expect(formatDate(utcIso, 'vi', 'Asia/Ho_Chi_Minh')).toBe('21/10/2026');
    expect(formatDateTime(utcIso, 'vi', 'Asia/Ho_Chi_Minh', true)).toContain('01:30:00');
  });
});
