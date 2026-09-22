import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { RuntimeId } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { usePolling } from '../../hooks/usePolling';
import { useLocale } from '../../../../core/i18n/index';

const LEVELS = ['', 'info', 'warn', 'error', 'debug'] as const;

interface RuntimeLogsPanelProps {
  runtime: RuntimeId | 'cli';
  limit?: number;
  onOpenLogViewer?: () => void;
}

/** Log gần nhất của một runtime (ring buffer Redis), lọc sẵn theo runtime. */
export const RuntimeLogsPanel: React.FC<RuntimeLogsPanelProps> = ({ runtime, limit = 100, onOpenLogViewer }) => {
  const { t, formatTime } = useLocale();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('');
  const { data, error } = usePolling(() => runtimesApi.logs(runtime, limit, level || undefined), `${runtime}:${level}:${limit}`);

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.logs.title')}</h3>
        <div className="ov-segmented" role="tablist">
          {LEVELS.map((l) => (
            <button key={l || 'all'} type="button" role="tab" aria-selected={level === l} className={level === l ? 'is-active' : ''} onClick={() => setLevel(l)}>
              {l ? l.toUpperCase() : t('console.logs.level.all')}
            </button>
          ))}
        </div>
      </header>

      <div className="log-viewer-stream rt-log-stream">
        {error && !data && <div className="rt-log-empty">{error.message}</div>}
        {data?.length === 0 && <div className="rt-log-empty">{t('rt.logs.empty')}</div>}
        {data?.map((l, i) => (
          <div key={`${l.t}-${i}`} className="log-line">
            <span className="log-time">{formatTime(l.t)}</span>
            <span className={`log-chip level-${l.level === 'fatal' ? 'error' : l.level}`}>{l.level}</span>
            {l.context && <span className="log-source">[{l.context}]</span>}
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </div>

      {onOpenLogViewer && (
        <footer className="ov-section-foot">
          <button type="button" className="ov-link" onClick={onOpenLogViewer}>
            {t('rt.logs.openViewer')} <ArrowRight size={13} />
          </button>
        </footer>
      )}
    </section>
  );
};
