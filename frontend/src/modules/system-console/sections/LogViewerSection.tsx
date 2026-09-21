import React, { useState, useMemo } from 'react';
import type { EventLogLevel } from '../types/console.types';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';

export const LogViewerSection: React.FC = () => {
  const { events, clearEvents, addEvent, packages, executeAction } = useConsoleData();

  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isChangingLevel, setIsChangingLevel] = useState(false);

  // Find logging package if registered
  const loggingPkg = packages.find((p) => p.packageId === 'logging');
  const currentLogLevel = String(loggingPkg?.statusReport.metrics['currentLevel'] || 'info');

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      const matchLevel = selectedLevel === 'all' || evt.level === selectedLevel;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        evt.message.toLowerCase().includes(q) ||
        evt.source.toLowerCase().includes(q);
      return matchLevel && matchQuery;
    });
  }, [events, selectedLevel, searchQuery]);

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `system-console-logs-${new Date().toISOString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleSetLogLevel = async (level: 'debug' | 'info' | 'warn') => {
    if (!loggingPkg) return;
    const actionId = `set_level_${level}`;
    try {
      setIsChangingLevel(true);
      await executeAction('logging', actionId);
    } finally {
      setIsChangingLevel(false);
    }
  };

  const handleSimulateLog = () => {
    const sources = ['kernel', 'http', 'database', 'worker', 'auth'];
    const levels: EventLogLevel[] = ['info', 'warn', 'error', 'success'];
    const sampleMsgs = [
      'HTTP GET /api/v1/health 200 OK - 8ms',
      'Slow query detected on users table - 120ms',
      'Worker processor [NotificationProcessor] processed job #1042 in 45ms',
      'JWT token validated successfully for sub:usr_8928',
      'Redis connection pool idle timeout refreshed',
    ];

    const randomSource = sources[Math.floor(Math.random() * sources.length)] || 'kernel';
    const randomLevel = levels[Math.floor(Math.random() * levels.length)] || 'info';
    const randomMsg = sampleMsgs[Math.floor(Math.random() * sampleMsgs.length)] || 'Sample log entry';

    addEvent(randomLevel, randomSource, randomMsg);
  };

  return (
    <div>
      <SectionHeader
        title="Structured Log Viewer & Audit Stream"
        description="Inspect application events, fastify access logs, correlation traces, and adjust Pino structured logging levels on the fly."
      />

      {/* Log Level Control Panel */}
      {loggingPkg && (
        <div className="scp-panel" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.2rem' }}>🎛️</span>
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--scp-text-primary)' }}>
                  Active Logging Engine Level:
                </strong>{' '}
                <span className="code-badge" style={{ textTransform: 'uppercase', fontWeight: 700 }}>
                  {currentLogLevel}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)', marginLeft: '0.5rem' }}>
                  (Dynamic Pino runtime reconfiguration)
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                className={`scp-btn scp-btn-sm ${currentLogLevel === 'debug' ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                disabled={isChangingLevel}
                onClick={() => handleSetLogLevel('debug')}
              >
                Set DEBUG
              </button>
              <button
                type="button"
                className={`scp-btn scp-btn-sm ${currentLogLevel === 'info' ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                disabled={isChangingLevel}
                onClick={() => handleSetLogLevel('info')}
              >
                Set INFO
              </button>
              <button
                type="button"
                className={`scp-btn scp-btn-sm ${currentLogLevel === 'warn' ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                disabled={isChangingLevel}
                onClick={() => handleSetLogLevel('warn')}
              >
                Set WARN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Log Viewer Box */}
      <div className="log-viewer-wrapper">
        {/* Toolbar */}
        <div className="log-viewer-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Level filters */}
            {['all', 'info', 'warn', 'error', 'success'].map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`scp-btn scp-btn-sm ${selectedLevel === lvl ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                onClick={() => setSelectedLevel(lvl)}
                style={{ textTransform: 'uppercase', fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
              >
                {lvl}
              </button>
            ))}

            {/* Search */}
            <input
              type="text"
              placeholder="Search in logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '0.25rem 0.6rem',
                borderRadius: '4px',
                border: '1px solid var(--scp-terminal-border)',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                color: '#fff',
                fontSize: '0.75rem',
                width: '180px',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={handleSimulateLog}
              title="Add a sample log line"
            >
              + Emit Test Log
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={handleExportJson}
            >
              💾 Export JSON
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              onClick={clearEvents}
            >
              🗑 Clear
            </button>
          </div>
        </div>

        {/* Log Lines Stream */}
        <div className="log-viewer-stream">
          {filteredEvents.map((evt) => (
            <div key={evt.id} className="log-line">
              <span className="log-time">{evt.timestamp.toLocaleTimeString()}</span>
              <span className={`log-chip level-${evt.level}`}>{evt.level}</span>
              <span className="log-source">[{evt.source}]</span>
              <span className="log-msg">{evt.message}</span>
            </div>
          ))}

          {filteredEvents.length === 0 && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '3rem 0', fontStyle: 'italic' }}>
              No log lines matching current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
