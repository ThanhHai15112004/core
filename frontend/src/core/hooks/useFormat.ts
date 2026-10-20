import { useMemo } from 'react';
import { useLocale } from '../i18n/index';
import * as f from '../lib/format';

/** Các hàm format gắn sẵn locale và timezone hiện tại (Mục 5.3). */
export function useFormat() {
  const { locale, timezone } = useLocale();
  return useMemo(
    () => ({
      locale,
      timezone,
      number: (n: f.Nullable<number>, digits?: number) => f.formatNumber(n, locale, digits),
      currency: (amount: f.Nullable<number>, currencyCode?: string) =>
        f.formatCurrency(amount, locale, currencyCode),
      date: (value: f.Nullable<Date | string | number>, tz?: string) =>
        f.formatDate(value, locale, tz ?? timezone),
      dateTime: (value: f.Nullable<Date | string | number>, withSeconds?: boolean, tz?: string) =>
        f.formatDateTime(value, locale, tz ?? timezone, withSeconds),
      compact: (n: f.Nullable<number>) => f.formatCompact(n, locale),
      rate: (n: f.Nullable<number>, per?: 'sec' | 'min') => f.formatRate(n, locale, per),
      withUnit: (n: f.Nullable<number>, unit: string, digits?: number) =>
        f.formatWithUnit(n, unit, locale, digits),
      metric: (n: f.Nullable<number>, unit: string) => f.formatMetric(n, unit, locale),
      bytes: f.formatBytes,
      signedBytes: f.formatSignedBytes,
      mb: f.formatMb,
      duration: f.formatDuration,
      uptime: f.formatUptime,
      percent: f.formatPercent,
      delta: f.formatDelta,
      shortId: f.shortId,
    }),
    [locale, timezone],
  );
}
