import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = '🔍',
  title,
  description,
  action,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
        textAlign: 'center',
        backgroundColor: 'var(--scp-bg-surface)',
        borderRadius: '12px',
        border: '1px dashed var(--scp-border-subtle)',
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{icon}</div>
      <h4 style={{ margin: '0 0 0.35rem', color: 'var(--scp-text-primary)', fontSize: '1.05rem', fontWeight: 600 }}>
        {title}
      </h4>
      {description && (
        <p style={{ margin: '0 0 1rem', color: 'var(--scp-text-muted)', fontSize: '0.85rem', maxWidth: '420px' }}>
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};
