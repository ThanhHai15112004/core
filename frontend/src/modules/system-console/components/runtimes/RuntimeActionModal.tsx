import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { RuntimeSummary } from '../../types/runtime.types';
import { BUSY_METRICS } from '../../constants/runtime-metrics';
import { formatMetric } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';
import { ConsolePortal } from '../common/ConsolePortal';

export type ModalAction = 'stop';

interface RuntimeActionModalProps {
  runtime: RuntimeSummary;
  action: ModalAction;
  onCancel: () => void;
  onConfirm: (options: { confirm: string }) => void;
}

const STOP_CONFIRM = 'STOP';

/**
 * Xác nhận Stop (gõ STOP). Restart do Docker / supervisor quản lý, không điều khiển từ Console.
 * Ngữ cảnh ("12 active requests", "5 jobs đang chạy"...) lấy từ metric thật của runtime.
 */
export const RuntimeActionModal: React.FC<RuntimeActionModalProps> = ({ runtime, action, onCancel, onConfirm }) => {
  const { t } = useLocale();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const busy = BUSY_METRICS[runtime.id].map((key) => ({ key, value: runtime.metrics[key] }));
  const canConfirm = typed === STOP_CONFIRM;
  const name = runtime.name;

  return (
    <ConsolePortal>
      <div className="rt-modal-backdrop" onClick={onCancel}>
        <div className="rt-modal" role="dialog" aria-modal="true" aria-labelledby="rt-modal-title" onClick={(e) => e.stopPropagation()}>
          <header className="rt-modal-head">
            <h3 id="rt-modal-title">
              <AlertTriangle size={18} />
              {t(`rt.modal.${action}.title`, { name })}
            </h3>
            <button type="button" className="rt-icon-btn" onClick={onCancel} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </header>

          <div className="rt-modal-body">
            <p className="rt-modal-context-title">{t('rt.modal.current')}</p>
            <ul className="rt-modal-context">
              {busy.map(({ key, value }) => (
                <li key={key}>
                  <strong>{formatMetric(value)}</strong> {t(`rt.metric.${key}`)}
                </li>
              ))}
            </ul>
            <p className="rt-modal-warning">{t(`rt.modal.${action}.impact.${runtime.id}`)}</p>

              <label className="rt-modal-confirm">
                <span>{t('rt.modal.stop.typeToConfirm', { word: STOP_CONFIRM })}</span>
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={STOP_CONFIRM}
                  aria-label={t('rt.modal.stop.typeToConfirm', { word: STOP_CONFIRM })}
                />
              </label>
          </div>

          <footer className="rt-modal-foot">
            <button type="button" className="scp-btn scp-btn-secondary" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-danger"
              disabled={!canConfirm}
              onClick={() => onConfirm({ confirm: typed })}
            >
              {t(`rt.modal.${action}.confirm`)}
            </button>
          </footer>
        </div>
      </div>
    </ConsolePortal>
  );
};
