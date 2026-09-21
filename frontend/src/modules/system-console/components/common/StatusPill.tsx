import React from 'react';

interface StatusPillProps {
  status: string;
  label?: string;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, label, className = '' }) => {
  const normalized = (status || 'idle').toLowerCase();
  const displayLabel = label || normalized;

  return (
    <span className={`status-pill status-${normalized} ${className}`}>
      <span className="status-dot" />
      <span>{displayLabel}</span>
    </span>
  );
};
