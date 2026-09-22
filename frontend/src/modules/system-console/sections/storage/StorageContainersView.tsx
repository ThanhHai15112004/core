import React from 'react';
import type { StorageRange, StorageTab } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { ContainerTable } from '../../components/storage/ContainerTable';
import { useLocale } from '../../../../core/i18n/index';

/** Container: prefix cấp 1 trong bucket (S3) hoặc thư mục gốc (local) — do backend gom từ lần quét usage. */
export const StorageContainersView: React.FC<{
  range: StorageRange;
  paused: boolean;
  driver: string;
  reloadKey: number;
  go: (tab: StorageTab, id?: string | null) => void;
}> = ({ range, paused, driver, reloadKey, go }) => {
  const { t } = useLocale();
  const { data, error } = usePolling(() => storageApi.containers(range), `containers:${range}:${reloadKey}`, 30_000, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t(`storage.container.title.${driver === 's3' ? 's3' : 'local'}`)}</h3>
        {data && (
          <span className="ov-section-hint">
            <code>{data.location}</code>
            {data.usageAt && ` · ${t('storage.usage.scannedAt', { time: new Date(data.usageAt).toLocaleTimeString() })}`}
            {data.truncated && ` · ${t('storage.usage.truncated')}`}
          </span>
        )}
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && <ContainerTable rows={data.containers} onOpen={(name) => go('containers', name)} emptyText={t('storage.empty')} />}
      <p className="pf-chart-note">{t('storage.container.note', { range: t(`tr.range.${range}`) })}</p>
    </section>
  );
};
