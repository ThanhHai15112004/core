import React, { useState } from 'react';
import { Database, Tag, Server } from 'lucide-react';
import { useConsoleData } from '../context/console-data-context';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { StatCard } from '../components/common/StatCard';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { usePackage } from '../hooks/usePackage';
import { useLocale } from '../../../core/i18n/index';

const NO_VALUE = '--';
const FLUSH_ACTION = 'flush_all';

export const CacheSection: React.FC = () => {
  const { t } = useLocale();
  const { executeAction } = useConsoleData();
  const { pkg, metric } = usePackage('cache');
  const [isFlushModalOpen, setIsFlushModalOpen] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);

  const driver = String(metric('driver') ?? NO_VALUE);
  const prefix = String(metric('prefix') ?? NO_VALUE);
  const configuredRedis = String(metric('configuredRedis') ?? NO_VALUE);
  const isInMemory = driver === 'memory';

  const handleFlushCache = async () => {
    try {
      setIsFlushing(true);
      await executeAction('cache', FLUSH_ACTION);
    } finally {
      setIsFlushing(false);
      setIsFlushModalOpen(false);
    }
  };

  return (
    <div>
      <SectionHeader
        title={t('console.cache.title')}
        description={t('console.cache.description')}
        actions={
          <button
            type="button"
            className="scp-btn scp-btn-danger"
            onClick={() => setIsFlushModalOpen(true)}
            disabled={!pkg}
          >
            {t('console.cache.flush')}
          </button>
        }
      />

      {isInMemory && (
        <div className="scp-alert scp-alert-info" role="note">
          {t('console.cache.inMemoryNotice', { redis: configuredRedis })}
        </div>
      )}

      <div className="scp-grid-4">
        <StatCard
          title={t('console.common.status')}
          value={pkg ? t(`console.status.${pkg.statusReport.status}`) : NO_VALUE}
          icon={<Server size={18} />}
          subtext={pkg && <StatusPill status={pkg.statusReport.status} />}
        />
        <StatCard title={t('console.cache.driver')} value={driver.toUpperCase()} icon={<Database size={18} />} />
        <StatCard title={t('console.cache.prefix')} value={prefix} icon={<Tag size={18} />} />
        <StatCard
          title={t('console.cache.configuredRedis')}
          value={configuredRedis}
          icon={<Server size={18} />}
          subtext={isInMemory ? t('console.cache.notConnected') : undefined}
        />
      </div>

      <ConfirmModal
        isOpen={isFlushModalOpen}
        title={t('console.cache.flushConfirmTitle')}
        message={t('console.cache.flushConfirmMessage', { prefix })}
        confirmText={t('console.cache.flushConfirm')}
        isDanger
        isLoading={isFlushing}
        onConfirm={handleFlushCache}
        onCancel={() => setIsFlushModalOpen(false)}
      />
    </div>
  );
};
