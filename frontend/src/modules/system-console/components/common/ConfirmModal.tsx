import React from 'react';

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
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDanger = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ color: isDanger ? 'var(--scp-danger)' : 'inherit' }}>
            {isDanger ? '⚠️ ' : ''}
            {title}
          </h3>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--scp-text-muted)',
              fontSize: '1.2rem',
              lineHeight: 1,
            }}
          >
            ✕
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
            {cancelText}
          </button>
          <button
            type="button"
            className={`scp-btn ${isDanger ? 'scp-btn-danger' : 'scp-btn-primary'}`}
            disabled={isLoading}
            onClick={onConfirm}
          >
            {isLoading ? 'Executing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
