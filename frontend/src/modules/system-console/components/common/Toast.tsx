import React from 'react';
import { useConsoleData } from '../../context/ConsoleDataContext';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useConsoleData();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--scp-text-primary)' }}>
              {toast.title}
            </div>
            {toast.message && (
              <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-secondary)', marginTop: '0.2rem' }}>
                {toast.message}
              </div>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--scp-text-muted)',
              fontSize: '1rem',
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
