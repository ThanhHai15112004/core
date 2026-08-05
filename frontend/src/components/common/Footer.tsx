import React from 'react';
import { APP_NAME } from '../../utils/constants';

export const Footer: React.FC = () => {
  return (
    <footer style={{
      marginTop: 'auto',
      borderTop: '1px solid var(--border-color)',
      padding: '40px 32px 24px',
      background: 'rgba(10, 12, 16, 0.8)'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <p style={{ color: 'var(--text-dim)', fontSize: '14px' }}>
          © {new Date().getFullYear()} {APP_NAME}. Built with React, Vite & TypeScript.
        </p>
        <div style={{ display: 'flex', gap: '20px' }}>
          <a href="#" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '14px' }}>Privacy</a>
          <a href="#" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '14px' }}>Terms</a>
          <a href="#" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '14px' }}>GitHub</a>
        </div>
      </div>
    </footer>
  );
};
