import React from 'react';
import { useLocale } from '../../../../core/i18n/index';

interface StatusPillProps {
  status: string;
  /** Mặc định dùng nhãn dịch của `status` (`console.status.<status>`). */
  label?: string;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, label, className = '' }) => {
  const { t } = useLocale();
  const normalized = (status || 'idle').toLowerCase();

  return (
    <span className={`status-pill status-${normalized} ${className}`}>
      <span className="status-dot" />
      <span>{label ?? t(`console.status.${normalized}`)}</span>
    </span>
  );
};
