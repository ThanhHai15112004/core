import React from 'react';
import type { StorageOverview } from '../../types/storage.types';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatGrowth, formatRate } from '../../utils/storage-format';
import type { StatusTone } from '../../utils/status-tone';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** 8 KPI: dung lượng, object, upload/download, tỷ lệ lỗi, thao tác lỗi, tăng hôm nay, container. */
export const StorageKpis: React.FC<{ data: StorageOverview | null }> = ({ data }) => {
  const { t, locale } = useLocale();
  if (!data) {
    return (
      <div className="ov-kpi-grid db-kpi-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }
  const k = data.kpis;
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
  };
  const range = t(`tr.range.${data.range}`);
  const cap = data.capacity.available ? data.capacity.data : null;
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'used',
      value: formatBytes(k.usedBytes),
      sub: cap?.totalBytes
        ? t('storage.kpi.usedOf', { percent: formatUnit(cap.percent, '%'), total: formatBytes(cap.totalBytes) })
        : t('storage.kpi.providerManaged'),
      tone: alert('CAPACITY') ?? 'unknown',
    },
    {
      key: 'objects',
      value: k.objects === null ? NO_VALUE : `${formatCompact(k.objects, locale)}${k.objectsTruncated ? '+' : ''}`,
      sub: data.growth.createdToday === null ? NO_VALUE : t('storage.kpi.createdToday', { count: formatCompact(data.growth.createdToday, locale) }),
      tone: 'unknown',
    },
    {
      key: 'upload',
      value: formatRate(k.uploadBytesPerSec),
      sub: t('storage.kpi.transferSub', { ops: formatUnit(data.upload.opsPerMin, '/min'), range }),
      tone: 'unknown',
    },
    {
      key: 'download',
      value: formatRate(k.downloadBytesPerSec),
      sub: t('storage.kpi.transferSub', { ops: formatUnit(data.download.opsPerMin, '/min'), range }),
      tone: 'unknown',
    },
    {
      key: 'errorRate',
      value: formatUnit(k.errorRatePercent, '%'),
      sub: t('storage.kpi.opsSub', { ops: formatUnit(k.opsPerSec, '/s') }),
      tone: alert('UPLOAD_FAILURE_RATE', 'DOWNLOAD_FAILURE_RATE') ?? (k.errorRatePercent === null ? 'unknown' : k.errorRatePercent > 0 ? 'warn' : 'ok'),
    },
    { key: 'failed', value: String(k.failedOps), sub: t('storage.kpi.failedSub', { range }), tone: k.failedOps > 0 ? 'warn' : 'ok' },
    {
      key: 'growth',
      value: formatGrowth(k.growthTodayBytes),
      sub: k.growthTodayBytes === null ? t('storage.kpi.noHistory') : t('storage.kpi.growthSub'),
      tone: alert('RAPID_GROWTH') ?? 'unknown',
    },
    {
      key: 'containers',
      value: k.containers === null ? NO_VALUE : String(k.containers),
      sub: t(`storage.kpi.containersSub.${data.provider.driver}`),
      tone: 'unknown',
    },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`storage.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};
