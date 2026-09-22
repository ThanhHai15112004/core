import { useLocale } from '../../../../core/i18n/index';
import { AlertOctagon } from 'lucide-react';

interface OfflineFallbackBannerProps {
  lastSync: Date | null;
  onRetry: () => void;
  isRetrying: boolean;
}

export const OfflineFallbackBanner: React.FC<OfflineFallbackBannerProps> = ({
  lastSync,
  onRetry,
  isRetrying,
}) => {
  const { t } = useLocale();
  const syncTimeStr = lastSync ? lastSync.toLocaleTimeString() : 'Unknown';

  return (
    <div className="offline-warning-banner" role="alert">
      <div className="offline-warning-left">
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: 'var(--scp-danger)',
            color: 'var(--scp-text-inverse)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <AlertOctagon size={22} />
        </div>

        <div>
          <h3 className="offline-warning-title">{t('overview.connectionLost')}</h3>
          <p className="offline-warning-desc">
            {t('overview.lastSync')}: <strong>{syncTimeStr}</strong>. {t('overview.offlineNotice')}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="scp-btn scp-btn-danger"
        onClick={onRetry}
        disabled={isRetrying}
      >
        {isRetrying ? t('common.loading') : t('overview.retryConnection')}
      </button>
    </div>
  );
};
