import React from 'react';
import { WifiOff } from 'lucide-react';
import { POLL_INTERVAL_MS } from '../../constants/console.constants';
import { useLocale } from '../../../../core/i18n/index';

interface OfflineFallbackBannerProps {
  lastSync: Date | null;
  now: number;
  isShowingLastKnown: boolean;
}

const CAUSES = ['stopped', 'network', 'restarting'] as const;

/** Hiển thị khi không gọi được API: lần kết nối cuối và nguyên nhân khả dĩ; hệ thống tự thử lại. */
export const OfflineFallbackBanner: React.FC<OfflineFallbackBannerProps> = ({ lastSync, now, isShowingLastKnown }) => {
  const { t, formatTime, formatRelative } = useLocale();

  return (
    <section className="ov-offline" role="alert">
      <WifiOff size={24} className="ov-offline-icon" />
      <div className="ov-offline-body">
        <h2>{t('ov.offline.title')}</h2>
        <p>
          {lastSync
            ? t('ov.offline.lastSync', { time: formatTime(lastSync), ago: formatRelative(lastSync, now) })
            : t('ov.offline.neverSynced')}
        </p>
        <p>{isShowingLastKnown ? t('ov.offline.lastKnown') : t('ov.offline.noData')}</p>
        <p className="ov-offline-causes-title">{t('ov.offline.causesTitle')}</p>
        <p className="ov-offline-retry">{t('ov.offline.autoRetry', { seconds: POLL_INTERVAL_MS / 1000 })}</p>
        <ul className="ov-offline-causes">
          {CAUSES.map((c) => (
            <li key={c}>{t(`ov.offline.cause.${c}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
};
