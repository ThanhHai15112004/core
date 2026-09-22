import React from 'react';
import { createPortal } from 'react-dom';
import { useConsoleData } from '../../context/ConsoleDataContext';
import { X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useConsoleData();

  if (toasts.length === 0 || typeof document === 'undefined') return null;

  return createPortal(
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
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px',
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
};
