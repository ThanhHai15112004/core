import React from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  badge,
  actions,
}) => {
  return (
    <div className="section-header">
      <div className="section-title-group">
        <h2 className="section-title">
          <span>{title}</span>
          {badge}
        </h2>
        {description && <p className="section-description">{description}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
};
