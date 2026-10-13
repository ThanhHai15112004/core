import { useMemo } from 'react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { formatLatency, formatRps } from '../../utils/traffic-format';

/** Số chữ số thập phân của tỷ lệ lỗi (0.05% vẫn phải thấy được). */
const ERROR_RATE_DIGITS = 2;

/** Định dạng số liệu traffic (req/s, latency, tỷ lệ lỗi, số đếm) theo locale. */
export function useTrafficFormat() {
  const { t } = useLocale();
  const f = useFormat();
  return useMemo(
    () => ({
      rps: (v: number | null | undefined) => (v === null || v === undefined ? NO_VALUE : `${formatRps(v)} ${t('tr.unit.rps')}`),
      latency: formatLatency,
      rate: (v: number | null | undefined) => f.percent(v, ERROR_RATE_DIGITS),
      count: f.compact,
    }),
    [t, f],
  );
}
