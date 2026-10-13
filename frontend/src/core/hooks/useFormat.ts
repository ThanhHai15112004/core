import { useMemo } from 'react';
import { useLocale } from '../i18n/index';
import * as f from '../lib/format';

/** Các hàm format gắn sẵn locale hiện tại. */
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      locale,
      number: (n: f.Nullable<number>, digits?: number) => f.formatNumber(n, locale, digits),
      compact: (n: f.Nullable<number>) => f.formatCompact(n, locale),
      rate: (n: f.Nullable<number>, per?: 'sec' | 'min') => f.formatRate(n, locale, per),
      withUnit: (n: f.Nullable<number>, unit: string, digits?: number) => f.formatWithUnit(n, unit, locale, digits),
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
    [locale],
  );
}
