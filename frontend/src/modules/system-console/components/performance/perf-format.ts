import { useCallback } from 'react';
import { useFormat } from '@core/hooks/useFormat';
import { formatDelta, NO_VALUE, UNIT, type Nullable } from '@core/lib/format';
import type { StatDelta } from '@core/ui/blocks';

/** Đơn vị backend hiệu năng trả về. */
const MB = 'MB';
const PER_SEC = '/s';
const PER_MIN = '/min';
const MS_PER_MIN = 'ms/min';
const JOBS = 'jobs';

/** Định dạng giá trị theo đơn vị backend (`ms`, `%`, `MB`, `/s`, `/min`, `ms/min`, `jobs`). Null → `—`. */
export function usePerfFormat() {
  const f = useFormat();
  return useCallback(
    (value: Nullable<number>, unit: string): string => {
      if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE;
      switch (unit) {
        case UNIT.ms:
          return f.duration(value);
        case UNIT.percent:
          return f.percent(value, value < 10 ? 2 : 1);
        case MB:
          return f.mb(value);
        case PER_SEC:
          return f.rate(value);
        case PER_MIN:
          return f.rate(value, 'min');
        case MS_PER_MIN:
          return `${f.number(value)} ${MS_PER_MIN}`;
        case JOBS:
          return f.number(value);
        default:
          return f.withUnit(value, unit);
      }
    },
    [f],
  );
}

/** % thay đổi so với kỳ trước → delta của StatTile. `higherIsWorse = null` → trung tính. */
export function kpiDelta(change: number | null, higherIsWorse: boolean | null): StatDelta | null {
  const text = formatDelta(change);
  if (text === null || change === null) return null;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return { text, direction, good: higherIsWorse === null || change === 0 ? null : change > 0 !== higherIsWorse };
}

/** `/api/v1/users/:id` → `/users/:id`. */
export const shortRoute = (route: string): string => route.replace(/^\/api\/v\d+(?=\/|$)/, '') || '/';
