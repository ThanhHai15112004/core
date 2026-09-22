import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { RestartMode, RuntimeSummary } from '../../types/runtime.types';
import { BUSY_METRICS } from '../../constants/runtime-metrics';
import { formatMetric } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';
import { ConsolePortal } from '../common/ConsolePortal';

export type ModalAction = 'restart' | 'stop';

interface RuntimeActionModalProps {
  runtime: RuntimeSummary;
  action: ModalAction;
  onCancel: () => void;
  onConfirm: (options: { mode?: RestartMode; confirm?: string }) => void;
}

const STOP_CONFIRM = 'STOP';

/**
 * Xác nhận Restart (chọn graceful/force) hoặc Stop (gõ STOP).
 * Ngữ cảnh ("12 active requests", "5 jobs đang chạy"...) lấy từ metric thật của runtime.
 */
export const RuntimeActionModal: React.FC<RuntimeActionModalProps> = ({ runtime, action, onCancel, onConfirm }) => {
  const { t } = useLocale();
  const [mode, setMode] = useState<RestartMode>('graceful');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const busy = BUSY_METRICS[runtime.id].map((key) => ({ key, value: runtime.metrics[key] }));
  const canConfirm = action === 'restart' || typed === STOP_CONFIRM;
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

            {action === 'restart' ? (
              <fieldset className="rt-modal-modes">
                <legend>{t('rt.modal.restart.modeLabel')}</legend>
                {(['graceful', 'force'] as const).map((m) => (
                  <label key={m} className={mode === m ? 'is-selected' : ''}>
                    <input type="radio" name="restart-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                    <span>
                      <strong>{t(`rt.modal.restart.${m}.label`)}</strong>
                      <small>{t(`rt.modal.restart.${m}.description.${runtime.id}`)}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
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
            )}
          </div>

          <footer className="rt-modal-foot">
            <button type="button" className="scp-btn scp-btn-secondary" onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-danger"
              disabled={!canConfirm}
              onClick={() => onConfirm(action === 'restart' ? { mode } : { confirm: typed })}
            >
              {t(`rt.modal.${action}.confirm`)}
            </button>
          </footer>
        </div>
      </div>
    </ConsolePortal>
  );
};
