import React from 'react';
import type { SystemEnvironment } from '../../types/console.types';
import { useLocale } from '../../../../core/i18n/index';

interface EnvironmentBadgeProps {
  environment: SystemEnvironment | null;
  size?: 'sm' | 'md';
}

/** Badge môi trường; production dùng màu đỏ để tránh thao tác nhầm môi trường. */
export const EnvironmentBadge: React.FC<EnvironmentBadgeProps> = ({ environment, size = 'md' }) => {
  const { t } = useLocale();
  const env = environment ?? 'unknown';

  return (
    <span className={`env-badge env-${env} env-${size}`} title={t('ov.env.tooltip')}>
      <span className="env-badge-dot" aria-hidden="true" />
      {t(`ov.env.${env}`)}
    </span>
  );
};
