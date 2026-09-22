import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { ConsolePortal } from '../common/ConsolePortal';
import { useLocale } from '../../../../core/i18n/index';

/** Khung drawer chung của trang Database (Escape để đóng). */
export const DbDrawer: React.FC<{ title: React.ReactNode; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ title, meta, onClose, children }) => {
  const { t } = useLocale();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <ConsolePortal>
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <aside className="detail-drawer tr-drawer" role="dialog" aria-modal="true">
          <div className="drawer-header">
            <div className="tr-drawer-title">
              <strong>{title}</strong>
              {meta && <span className="tr-drawer-meta">{meta}</span>}
            </div>
            <button type="button" className="rt-icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
          <div className="drawer-body">
            <div className="tr-drawer-content">{children}</div>
          </div>
        </aside>
      </>
    </ConsolePortal>
  );
};
