import React from 'react';
import { APP_NAME } from '../constants/index';

export const Header: React.FC = () => {
  return (
    <header className="glass" style={{ position: 'sticky', top: 0, zIndex: 100, padding: '16px 32px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            color: '#fff',
            fontSize: '18px',
          }}>
            C
          </div>
          <span style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }} className="gradient-text">
            {APP_NAME}
          </span>
        </div>

        <nav style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <a href="#features" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: '500', transition: 'var(--transition-fast)' }}>Features</a>
          <a href="#architecture" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: '500', transition: 'var(--transition-fast)' }}>Architecture</a>
          <a href="#docs" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: '500', transition: 'var(--transition-fast)' }}>Docs</a>
          <button className="btn-primary" style={{ padding: '8px 18px', fontSize: '14px' }}>Get Started</button>
        </nav>
      </div>
    </header>
  );
};
