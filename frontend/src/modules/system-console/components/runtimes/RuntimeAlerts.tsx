import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RuntimeSummary } from '../../types/runtime.types';
import { useLocale } from '../../../../core/i18n/index';

/** Cảnh báo ngưỡng + lý do degraded/crashed của từng runtime, kèm thời lượng. */
export const RuntimeAlerts: React.FC<{ runtimes: RuntimeSummary[]; now: number; onNavigate: (path: string) => void }> = ({
  runtimes,
  now,
  onNavigate,
}) => {
  const { t, formatRelative } = useLocale();
  const rows = runtimes.flatMap((r) => [
    ...r.alerts.map((a) => ({ id: `${r.id}-${a.key}`, runtime: r, message: a.message, since: a.since as string | null })),
    ...(r.status === 'crashed' || r.status === 'degraded'
      ? r.reasons
          .filter((reason) => !r.alerts.some((a) => reason.code === `alert.${a.key}`))
          .map((reason) => ({ id: `${r.id}-${reason.code}`, runtime: r, message: reason.message, since: null }))
      : []),
  ]);
  if (rows.length === 0) return null;

  return (
    <section className="rt-alerts" aria-label={t('rt.alerts.title')}>
      {rows.map((row) => (
        <button key={row.id} type="button" className={`rt-alert ov-tone-${row.runtime.status === 'crashed' ? 'crit' : 'warn'}`} onClick={() => onNavigate(`runtimes/${row.runtime.id}`)}>
          <AlertTriangle size={16} />
          <strong>{row.runtime.name}</strong>
          <span>{row.message}</span>
          {row.since && <small>{t('rt.alerts.for', { duration: formatRelative(row.since, now) })}</small>}
        </button>
      ))}
    </section>
  );
};
