import { useEffect, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { Badge, Input } from '@core/ui/primitives';
import { PanelState, StatusDot } from '@core/ui/blocks';
import { schedulerApi } from '../../services/scheduler.api';
import { CRON_DEBOUNCE_MS, CRON_DEFAULT_EXPRESSION, CRON_EXPRESSION_MAX, TIMEZONE_MAX } from '../../constants/scheduler';
import { formatDateTime, formatIn, secondsUntil } from '../../utils/scheduler-format';
import { schedulerKeys } from '../../sections/scheduler/scheduler-keys';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Cron Inspector: biểu thức → mô tả cho người đọc + các lần chạy kế tiếp theo múi giờ (chỉ đọc). */
export function CronInspector({ defaultTimezone }: { defaultTimezone: string }) {
  const { t, locale } = useLocale();
  const [expression, setExpression] = useState(CRON_DEFAULT_EXPRESSION);
  const [timezone, setTimezone] = useState(defaultTimezone);
  useEffect(() => setTimezone(defaultTimezone), [defaultTimezone]);
  const expr = useDebounced(expression.trim(), CRON_DEBOUNCE_MS);
  const tz = useDebounced(timezone.trim(), CRON_DEBOUNCE_MS);
  const query = useLiveQuery(schedulerKeys.cron(expr, tz), () => schedulerApi.cron(expr, tz || undefined), { tier: 'static', enabled: expr !== '', keepPrevious: true });
  const r = query.data;
  const now = query.dataUpdatedAt;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('sch.cron.expression')}
          <Input value={expression} onChange={(e) => setExpression(e.target.value)} spellCheck={false} maxLength={CRON_EXPRESSION_MAX} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('sch.cron.timezone')}
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} spellCheck={false} maxLength={TIMEZONE_MAX} className="font-mono" />
        </label>
      </div>
      {query.isError ? (
        <PanelState status="error" error={query.error} onRetry={() => void query.refetch()} compact />
      ) : r ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={r.valid ? 'ok' : 'crit'}>
              <StatusDot tone={r.valid ? 'ok' : 'crit'} size="xs" />
              {r.valid ? t('sch.cron.valid') : t('sch.cron.invalid')}
            </Badge>
            <span className="text-fg">{r.valid ? r.description : r.error}</span>
            <span className="font-mono text-xs text-faint">
              {r.timezone} ({r.utcOffset})
            </span>
          </div>
          {r.next.length > 0 && (
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
              {r.next.map((at) => (
                <li key={at} className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums">
                  <span className="text-fg-2">{formatDateTime(at, locale, false)}</span>
                  <span className="text-faint">{formatIn(secondsUntil(at, now))}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : expr !== '' ? (
        <PanelState status="loading" skeleton="block" />
      ) : null}
    </div>
  );
}
