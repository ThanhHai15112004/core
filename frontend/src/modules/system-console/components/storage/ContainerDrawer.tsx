import React from 'react';
import { Search, Timer } from 'lucide-react';
import type { StorageRange } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { DbDrawer } from '../database/DbDrawer';
import { LineChart } from '../common/LineChart';
import { BarList } from '../cache/TtlDistribution';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatGrowth, toStorageChart } from '../../utils/storage-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết container: KPI, tăng trưởng, traffic, loại file, object lớn, lỗi gần đây, Browse / Lifecycle. */
export const ContainerDrawer: React.FC<{
  name: string;
  range: StorageRange;
  canLifecycle: boolean;
  onClose: () => void;
  onBrowse: (container: string) => void;
  onLifecycle: () => void;
  onOpenObject: (key: string) => void;
}> = ({ name, range, canLifecycle, onClose, onBrowse, onLifecycle, onOpenObject }) => {
  const { t, locale, formatTime } = useLocale();
  const { data, error } = usePolling(() => storageApi.container(name, range), `${name}:${range}`, 30_000);
  const c = data?.container;
  const history = data
    ? toStorageChart([{ id: 'bytes', label: t('storage.usage.size'), unit: 'B', points: data.history.map((h) => ({ t: h.t, value: h.bytes })) }])
    : null;
  const traffic = data ? toStorageChart([data.traffic.upload, data.traffic.download]) : null;
  return (
    <DbDrawer title={<code>{name === '(root)' ? t('storage.container.root') : `${name}/`}</code>} meta={t('storage.container.drawerMeta')} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {c && data && (
        <>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('storage.container.objects')}</dt>
              <dd>{formatCompact(c.objects, locale)}</dd>
            </div>
            <div>
              <dt>{t('storage.container.size')}</dt>
              <dd>{formatBytes(c.bytes)}</dd>
            </div>
            <div>
              <dt>{t('storage.container.growth')}</dt>
              <dd>{formatGrowth(c.growth24hBytes)}</dd>
            </div>
            <div>
              <dt>{t('storage.container.createdToday')}</dt>
              <dd>{formatCompact(c.createdToday, locale)}</dd>
            </div>
            <div>
              <dt>{t('storage.transfer.upload')}</dt>
              <dd>{formatBytes(c.uploadBytes)}</dd>
            </div>
            <div>
              <dt>{t('storage.transfer.download')}</dt>
              <dd>{formatBytes(c.downloadBytes)}</dd>
            </div>
          </dl>
          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onBrowse(name)}>
              <Search size={13} /> {t('storage.container.browse')}
            </button>
            {canLifecycle && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={onLifecycle}>
                <Timer size={13} /> {t('storage.container.lifecycle')}
              </button>
            )}
          </div>
          {history && (
            <div className="cache-mini-chart">
              <h4>{t('storage.usage.growthChart')}</h4>
              <LineChart
                series={history.series}
                unit={history.unit}
                height={140}
                formatTime={(ts) => formatTime(ts)}
                emptyText={t('storage.usage.noHistory')}
                ariaLabel={t('storage.usage.growthChart')}
              />
            </div>
          )}
          {traffic && (
            <div className="cache-mini-chart">
              <h4>{t('storage.container.trafficChart')}</h4>
              <LineChart
                series={traffic.series}
                unit={traffic.unit}
                height={140}
                formatTime={(ts) => formatTime(ts, range === '15m')}
                emptyText={t('storage.chart.empty')}
                ariaLabel={t('storage.container.trafficChart')}
              />
            </div>
          )}
          {data.byKind.length > 0 && (
            <>
              <h4>{t('storage.usage.byKind')}</h4>
              <BarList
                items={data.byKind.map((k) => ({
                  id: k.kind,
                  label: t(`storage.kind.${k.kind}`),
                  value: k.bytes,
                  text: `${formatBytes(k.bytes)} · ${formatCompact(k.objects, locale)}`,
                }))}
              />
            </>
          )}
          {data.largest.length > 0 && (
            <>
              <h4>{t('storage.usage.largest')}</h4>
              <ul className="cache-key-list">
                {data.largest.slice(0, 10).map((o) => (
                  <li key={o.key}>
                    <button type="button" className="ov-link" onClick={() => onOpenObject(o.key)}>
                      <code>{o.key}</code>
                    </button>
                    <span className={o.large ? 'is-warn' : ''}>{formatBytes(o.size)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>{t('storage.errors.recent')}</h4>
          {data.recentErrors.length === 0 ? (
            <p className="cache-ok-line">{t('storage.errors.noneContainer')}</p>
          ) : (
            <ul className="cache-key-list">
              {data.recentErrors.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span>
                    {e.op.toUpperCase()} <code>{e.key}</code>
                  </span>
                  <span className="is-warn">{e.code ?? t(`storage.errors.kind.${e.kind}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DbDrawer>
  );
};
