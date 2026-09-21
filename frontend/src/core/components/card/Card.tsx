import React from 'react';

export interface CardProps {
  title: string;
  description: string;
  icon: string;
  badge?: string;
}

export const Card: React.FC<CardProps> = ({ title, description, icon, badge }) => {
  return (
    <div
      className="glass"
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: '28px',
        transition: 'var(--transition-smooth)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: '700',
            borderRadius: '20px',
            background: 'rgba(99, 102, 241, 0.15)',
            color: '#818cf8',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}
        >
          {badge}
        </span>
      )}
      <div
        style={{
          fontSize: '28px',
          marginBottom: '16px',
          width: '52px',
          height: '52px',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border-color)',
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontSize: '18px',
          fontWeight: '600',
          marginBottom: '8px',
          color: 'var(--text-main)',
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
        {description}
      </p>
    </div>
  );
};
