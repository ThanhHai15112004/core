import React, { useState, useMemo } from 'react';
import { Sliders, Play, Pause, Download, Trash2, X } from 'lucide-react';
import type { OpsEventLog } from '../types/console.types';
import { useConsoleData } from '../context/console-data-context';
import { SectionHeader } from '../components/common/SectionHeader';
import { usePackage } from '../hooks/usePackage';
import { useLocale } from '../../../core/i18n/index';
import { useConsoleRoute } from '../context/console-route-context';
import { RuntimeLogsPanel } from '../components/runtimes/RuntimeLogsPanel';

const LOG_SOURCES = ['session', 'api', 'worker', 'scheduler', 'cli'] as const;
type LogSource = (typeof LOG_SOURCES)[number];
const isLogSource = (v: string | null): v is LogSource => LOG_SOURCES.includes(v as LogSource);

const LEVEL_FILTERS = ['all', 'info', 'warn', 'error', 'success'] as const;
type LevelFilter = (typeof LEVEL_FILTERS)[number];

function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const LogViewerSection: React.FC = () => {
  const { t, formatTime } = useLocale();
  const { route, navigate } = useConsoleRoute();
  const querySource = route.query.get('runtime');
  const source: LogSource = isLogSource(querySource) ? querySource : 'session';
  const correlationId = route.query.get('correlationId') ?? undefined;
  const { events, clearEvents, executeAction } = useConsoleData();
  const { pkg: loggingPkg, metric } = usePackage('logging');

  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pausedSnapshot, setPausedSnapshot] = useState<OpsEventLog[] | null>(null);
  const [isChangingLevel, setIsChangingLevel] = useState(false);

  const currentLogLevel = String(metric('currentLevel') ?? '--');
  const visibleEvents = pausedSnapshot ?? events;

  const filteredEvents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return visibleEvents.filter(
      (evt) =>
        (selectedLevel === 'all' || evt.level === selectedLevel) &&
        (!q || evt.message.toLowerCase().includes(q) || evt.source.toLowerCase().includes(q)),
    );
  }, [visibleEvents, selectedLevel, searchQuery]);

  const handleRunLoggingAction = async (actionId: string) => {
    try {
      setIsChangingLevel(true);
      await executeAction('logging', actionId);
    } finally {
      setIsChangingLevel(false);
    }
  };

  return (
    <div>
      <SectionHeader title={t('console.logs.title')} description={t('console.logs.description')} />

      <div className="ov-segmented" role="tablist" aria-label={t('console.logs.source')} style={{ marginBottom: '1rem' }}>
        {LOG_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={source === s}
            className={source === s ? 'is-active' : ''}
            onClick={() => navigate(s === 'session' ? 'logs' : `logs?runtime=${s}`)}
          >
            {s === 'session' ? t('console.logs.sessionSource') : t(`rt.name.${s}`)}
          </button>
        ))}
      </div>

      {source !== 'session' && correlationId && (
        <div className="tr-filter-chip">
          {t('console.logs.correlationFilter')} <code>{correlationId}</code>
          <button type="button" className="rt-icon-btn" aria-label={t('common.close')} onClick={() => navigate(`logs?runtime=${source}`)}>
            <X size={13} />
          </button>
        </div>
      )}

      {source !== 'session' ? (
        <RuntimeLogsPanel runtime={source} limit={500} {...(correlationId ? { correlationId } : {})} />
      ) : (
      <>

      {loggingPkg && (
        <div className="scp-panel" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Sliders size={18} style={{ color: 'var(--scp-primary)' }} />
              <strong style={{ fontSize: '0.9rem', color: 'var(--scp-text-primary)' }}>{t('console.logs.currentLevel')}</strong>
              <span className="code-badge" style={{ textTransform: 'uppercase', fontWeight: 700 }}>
                {currentLogLevel}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {loggingPkg.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={isChangingLevel}
                  title={action.description}
                  className="scp-btn scp-btn-sm scp-btn-secondary"
                  onClick={() => handleRunLoggingAction(action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="log-viewer-wrapper">
        <div className="log-viewer-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {LEVEL_FILTERS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`scp-btn scp-btn-sm ${selectedLevel === lvl ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                onClick={() => setSelectedLevel(lvl)}
                style={{ textTransform: 'uppercase', fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
              >
                {t(`console.logs.level.${lvl}`)}
              </button>
            ))}

            <input
              type="search"
              className="log-viewer-search"
              placeholder={t('console.logs.searchPlaceholder')}
              aria-label={t('console.logs.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => setPausedSnapshot(pausedSnapshot ? null : events)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              {pausedSnapshot ? <Play size={13} /> : <Pause size={13} />}
              <span>{pausedSnapshot ? t('console.logs.resume') : t('console.logs.pause')}</span>
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => downloadJson(events, `system-console-logs-${Date.now()}.json`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Download size={13} />
              <span>{t('console.logs.export')}</span>
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              onClick={() => {
                clearEvents();
                setPausedSnapshot(null);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Trash2 size={13} />
              <span>{t('console.logs.clear')}</span>
            </button>
          </div>
        </div>

        <div className="log-viewer-stream">
          {filteredEvents.map((evt) => (
            <div key={evt.id} className="log-line">
              <span className="log-time">{formatTime(evt.timestamp)}</span>
              <span className={`log-chip level-${evt.level}`}>{evt.level}</span>
              <span className="log-source">[{evt.source}]</span>
              <span className="log-msg">{evt.message}</span>
            </div>
          ))}

          {filteredEvents.length === 0 && (
            <div style={{ color: 'var(--scp-text-muted)', textAlign: 'center', padding: '3rem 0', fontStyle: 'italic' }}>
              {t('console.logs.empty')}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
};
