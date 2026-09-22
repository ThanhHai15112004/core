import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ConsolePortal } from '../common/ConsolePortal';
import { useLocale } from '../../../../core/i18n/index';

interface DbActionModalProps {
  title: string;
  /** Các dòng ngữ cảnh (session, thời gian chạy, query…). */
  context: { label: string; value: React.ReactNode }[];
  warning: string;
  confirmLabel: string;
  /** Từ phải gõ để xác nhận (thao tác nguy hiểm); không có → chỉ cần bấm. */
  confirmWord?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}

/** Xác nhận thao tác database (Cancel Query, Terminate Session, Run Migrations). */
export const DbActionModal: React.FC<DbActionModalProps> = ({ title, context, warning, confirmLabel, confirmWord, busy, onCancel, onConfirm }) => {
  const { t } = useLocale();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canConfirm = !busy && (!confirmWord || typed === confirmWord);
  return (
    <ConsolePortal>
      <div className="rt-modal-backdrop" onClick={onCancel}>
        <div className="rt-modal" role="dialog" aria-modal="true" aria-labelledby="db-modal-title" onClick={(e) => e.stopPropagation()}>
          <header className="rt-modal-head">
            <h3 id="db-modal-title">
              <AlertTriangle size={18} />
              {title}
            </h3>
            <button type="button" className="rt-icon-btn" onClick={onCancel} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </header>
          <div className="rt-modal-body">
            <dl className="db-modal-context">
              {context.map((c) => (
                <div key={c.label}>
                  <dt>{c.label}</dt>
                  <dd>{c.value}</dd>
                </div>
              ))}
            </dl>
            <p className="rt-modal-warning">{warning}</p>
            {confirmWord && (
              <label className="rt-modal-confirm">
                <span>{t('db.modal.typeToConfirm', { word: confirmWord })}</span>
                <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord} aria-label={t('db.modal.typeToConfirm', { word: confirmWord })} />
              </label>
            )}
          </div>
          <footer className="rt-modal-foot">
            <button type="button" className="scp-btn scp-btn-secondary" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="scp-btn scp-btn-danger" disabled={!canConfirm} onClick={() => onConfirm(typed)}>
              {confirmLabel}
            </button>
          </footer>
        </div>
      </div>
    </ConsolePortal>
  );
};
