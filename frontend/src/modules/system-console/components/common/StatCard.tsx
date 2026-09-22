import React from 'react';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  subtext?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  subtext,
  children,
  className = '',
}) => {
  return (
    <div className={`stat-card ${className}`}>
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        {icon && <span className="stat-card-icon">{icon}</span>}
      </div>
      <div className="stat-card-value">{value}</div>
      {subtext && <div className="stat-card-subtext">{subtext}</div>}
      {children && <div style={{ marginTop: '0.75rem' }}>{children}</div>}
    </div>
  );
};
