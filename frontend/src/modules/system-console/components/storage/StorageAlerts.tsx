import React from 'react';
import { ArrowRight, CheckCircle2, Info } from 'lucide-react';
import type { StorageOverview, StorageTab } from '../../types/storage.types';
import { useLocale } from '../../../../core/i18n/index';

/** Vấn đề hiện tại + các kiểm tra đang ổn (dung lượng, upload lỗi, multipart treo). */
export const StorageAlerts: React.FC<{ data: StorageOverview; now: number; onOpen: (tab: StorageTab, id?: string | null) => void }> = ({
  data,
  now,
  onOpen,
}) => {
  const { t, formatRelative } = useLocale();
  const rules = new Set(data.alerts.map((a) => a.rule));
  const ok: string[] = [];
  if (data.health.state === 'connected') ok.push(t('storage.alerts.connected'));
  if (data.capacity.available && data.capacity.data.percent !== null && !rules.has('CAPACITY')) ok.push(t('storage.alerts.capacityOk'));
  if (data.upload.ops > 0 && data.upload.failures === 0) ok.push(t('storage.alerts.noFailedUploads'));
  if (data.uploads.stale === 0) ok.push(t('storage.alerts.noStale'));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('storage.alerts.title')}</h3>
        {data.alerts.length > 0 && <span className="ov-count">{data.alerts.length}</span>}
      </header>
      <ul className="db-alerts">
        {data.alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'unknown'}`}>
            {a.severity === 'info' ? <Info size={14} /> : <span className="ov-dot" aria-hidden="true" />}
            <span className="db-alert-body">
              <strong>{a.title}</strong>
              <span>{a.message}</span>
              <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a.tab, a.tab === 'containers' ? a.container : null)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
        {data.alerts.length === 0 && ok.length === 0 && <li className="ov-empty-line">{t('storage.alerts.none')}</li>}
        {ok.map((line) => (
          <li key={line} className="ov-tone-ok is-ok">
            <CheckCircle2 size={14} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
