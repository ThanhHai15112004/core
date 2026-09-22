import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { StorageOverview, StorageReport, StorageTab } from '../../types/storage.types';
import { StorageKpis } from '../../components/storage/StorageKpis';
import { StorageChart } from '../../components/storage/StorageChart';
import { StorageAlerts } from '../../components/storage/StorageAlerts';
import { StorageEventList } from '../../components/storage/StorageEventList';
import { CapacityCard } from '../../components/storage/CapacityCard';
import { ContainerTable } from '../../components/storage/ContainerTable';
import { OperationsTable, TransferPerfCard } from '../../components/storage/TransferPanels';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit, trendOf } from '../../utils/performance-format';
import { formatGrowth } from '../../utils/storage-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: StorageOverview | null;
  now: number;
  paused: boolean;
  go: (tab: StorageTab, id?: string | null) => void;
  navigate: (path: string) => void;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/**
 * Tổng quan: KPI → biểu đồ → capacity + vấn đề → upload/download → container → hoạt động upload +
 * ảnh hưởng → báo cáo → sự kiện.
 */
export const StorageOverviewView: React.FC<Props> = ({ data, now, paused, go, navigate }) => {
  const { t, locale } = useLocale();
  if (!data) return <StorageKpis data={null} />;
  const reportRow = (key: keyof StorageReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = key === 'growthBytes' ? null : trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`storage.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  const u = data.uploads;
  const impactTrend = trendOf(data.relatedImpact.apiP95Ms.changePercent, true);
  return (
    <>
      <StorageKpis data={data} />
      <StorageChart range={data.range} paused={paused} />

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.capacity.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('usage')}>
              {t('storage.usage.view')} <ArrowRight size={13} />
            </button>
          </header>
          <CapacityCard capacity={data.capacity} growth={data.growth} usedBytes={data.kpis.usedBytes} product={data.provider.product} />
        </section>
        <StorageAlerts data={data} now={now} onOpen={go} />
      </div>

      <div className="ov-split db-split-even">
        <TransferPerfCard dir="upload" perf={data.upload} />
        <TransferPerfCard dir="download" perf={data.download} />
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.ops.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('traffic')}>
            {t('storage.traffic.view')} <ArrowRight size={13} />
          </button>
        </header>
        <OperationsTable rows={data.operations} driver={data.provider.driver} />
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t(`storage.container.title.${data.provider.driver}`)}</h3>
          <button type="button" className="ov-link" onClick={() => go('objects')}>
            {t('storage.container.browseAll')} <ArrowRight size={13} />
          </button>
        </header>
        <ContainerTable rows={data.topContainers} sortable={false} onOpen={(name) => go('containers', name)} emptyText={t('storage.empty')} />
        {data.usageAt && (
          <p className="pf-chart-note">
            {t('storage.usage.scannedAt', { time: new Date(data.usageAt).toLocaleTimeString() })}
            {data.usageTruncated && ` · ${t('storage.usage.truncated')}`}
          </p>
        )}
      </section>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.uploads.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('uploads')}>
              {t('storage.uploads.view')} <ArrowRight size={13} />
            </button>
          </header>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('storage.uploads.active')}</dt>
              <dd>{u.active}</dd>
            </div>
            <div>
              <dt>{t('storage.uploads.completedPerMin')}</dt>
              <dd>{formatUnit(u.completedPerMin, '/min')}</dd>
            </div>
            <div>
              <dt>{t('storage.uploads.failed')}</dt>
              <dd className={u.failed > 0 ? 'is-warn' : ''}>{u.failed}</dd>
            </div>
            <div>
              <dt>{t('storage.uploads.stale')}</dt>
              <dd className={(u.stale ?? 0) > 0 ? 'is-warn' : ''}>{u.stale ?? t('storage.notApplicable')}</dd>
            </div>
          </dl>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.impact.title')}</h3>
            <button type="button" className="ov-link" onClick={() => navigate('performance')}>
              {t('cache.impact.open')} <ArrowRight size={13} />
            </button>
          </header>
          <dl className="db-stat-grid cache-impact">
            <div>
              <dt>{t('storage.impact.apiP95')}</dt>
              <dd>
                {formatUnit(data.relatedImpact.apiP95Ms.current, 'ms')}
                {impactTrend && <span className={`ov-kpi-trend is-${impactTrend.tone}`}>{impactTrend.text}</span>}
              </dd>
              <small>{t('cache.impact.baseline', { value: formatUnit(data.relatedImpact.apiP95Ms.baseline, 'ms') })}</small>
            </div>
            <div>
              <dt>{t('storage.impact.queueWaiting')}</dt>
              <dd>{data.relatedImpact.queueWaiting ?? NO_VALUE}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">{t('storage.impact.note')}</p>
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.report.title')}</h3>
          <span className="ov-section-hint">{t('db.report.hint')}</span>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table tr-kv-table db-report">
            <thead>
              <tr>
                <th />
                <th>{t('db.report.today')}</th>
                <th>{t('db.report.yesterday')}</th>
                <th>{t('db.report.change')}</th>
              </tr>
            </thead>
            <tbody>
              {reportRow('usedBytes', formatBytes, null)}
              {reportRow('growthBytes', formatGrowth, null)}
              {reportRow('objects', (v) => formatCompact(v, locale), null)}
              {reportRow('uploads', (v) => formatCompact(v, locale), null)}
              {reportRow('downloads', (v) => formatCompact(v, locale), null)}
              {reportRow('uploadedBytes', formatBytes, null)}
              {reportRow('downloadedBytes', formatBytes, null)}
              {reportRow('failedOps', (v) => String(v ?? NO_VALUE), true)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.events.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('errors')}>
            {t('db.events.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <StorageEventList events={data.events} onOpen={(tab) => go(tab)} emptyText={t('storage.events.empty')} />
      </section>
    </>
  );
};
