import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLocale } from '../../../../core/i18n/index';
import { ConsolePortal } from './ConsolePortal';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  isDanger = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useLocale();
  if (!isOpen || typeof document === 'undefined') return null;

  return (
    <ConsolePortal>
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ color: isDanger ? 'var(--scp-danger)' : 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isDanger && <AlertTriangle size={18} />}
            <span>{title}</span>
          </h3>
          <button
            onClick={onCancel}
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
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="scp-btn scp-btn-secondary"
            disabled={isLoading}
            onClick={onCancel}
          >
            {cancelText ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={`scp-btn ${isDanger ? 'scp-btn-danger' : 'scp-btn-primary'}`}
            disabled={isLoading}
            onClick={onConfirm}
          >
            {isLoading ? t('console.common.executing') : (confirmText ?? t('common.confirm'))}
          </button>
        </div>
      </div>
    </div>
    </ConsolePortal>
  );
};
