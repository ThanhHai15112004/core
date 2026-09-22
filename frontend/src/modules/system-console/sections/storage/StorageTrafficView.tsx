import React from 'react';
import type { StorageRange } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { StorageChart } from '../../components/storage/StorageChart';
import { OperationsTable, TransferPerfCard } from '../../components/storage/TransferPanels';
import { SectionState } from '../../components/database/SectionState';
import { BarList } from '../../components/cache/TtlDistribution';
import { formatUnit } from '../../utils/performance-format';
import { useLocale } from '../../../../core/i18n/index';

/** Traffic: hiệu năng upload/download, bảng theo thao tác, phân bố HTTP status & mã lỗi (S3), lỗi theo loại. */
export const StorageTrafficView: React.FC<{ range: StorageRange; paused: boolean; driver: string; product: string }> = ({ range, paused, driver, product }) => {
  const { t } = useLocale();
  const { data } = usePolling(() => storageApi.traffic(range), `traffic:${range}`, undefined, paused);
  return (
    <>
      {data && (
        <div className="ov-split db-split-even">
          <TransferPerfCard dir="upload" perf={data.upload} />
          <TransferPerfCard dir="download" perf={data.download} />
        </div>
      )}
      <StorageChart range={range} paused={paused} initial="latency" />
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('storage.ops.title')}</h3>
        </header>
        {data && <OperationsTable rows={data.operations} driver={driver} />}
      </section>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.traffic.http')}</h3>
          </header>
          {data && (
            <SectionState section={data.http} driver={product} scope="storage">
              {(h) => (
                <>
                  <dl className="db-stat-grid db-stat-compact">
                    {h.classes.map((c) => (
                      <div key={c.cls}>
                        <dt>{c.cls}</dt>
                        <dd className={c.cls !== '2xx' && c.count > 0 ? 'is-warn' : ''}>
                          {c.count} <small>({formatUnit(c.percent, '%')})</small>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <h4>{t('storage.traffic.topErrors')}</h4>
                  {h.topErrors.length === 0 ? (
                    <p className="cache-ok-line">{t('storage.errors.none')}</p>
                  ) : (
                    <BarList items={h.topErrors.map((e) => ({ id: e.code, label: <code>{e.code}</code>, value: e.count, text: String(e.count) }))} />
                  )}
                </>
              )}
            </SectionState>
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('storage.errors.byKind')}</h3>
          </header>
          {data && (
            <BarList items={Object.entries(data.errorsByKind).map(([k, n]) => ({ id: k, label: t(`storage.errors.kind.${k}`), value: n, text: String(n) }))} />
          )}
        </section>
      </div>
    </>
  );
};
