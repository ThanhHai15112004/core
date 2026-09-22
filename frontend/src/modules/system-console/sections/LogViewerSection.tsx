import React, { useState, useMemo } from 'react';
import type { EventLogLevel } from '../types/console.types';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { Sliders, Play, Pause, Download, Trash2, PlusCircle } from 'lucide-react';

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

  const handleSetLogLevel = async (level: string) => {
    try {
      setIsChangingLevel(true);
      await executeAction('logging', 'set_level', { level });
      addEvent('info', 'logging', `Log level dynamically set to ${level.toUpperCase()}`);
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

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(events, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `system-console-logs-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div>
      <SectionHeader
        title="Structured Log Viewer"
        description="Live operational telemetry, structured log message streams, level filtering, and dynamic Pino reconfiguration."
        badge="Real-time"
      />

      {/* Log Level Control Panel */}
      {loggingPkg && (
        <div className="scp-panel" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Sliders size={18} style={{ color: 'var(--scp-primary)' }} />
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
              {['debug', 'info', 'warn', 'error'].map((lvl) => {
                const isCurrent = currentLogLevel.toLowerCase() === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    disabled={isChangingLevel || isCurrent}
                    className={`scp-btn scp-btn-sm ${isCurrent ? 'scp-btn-primary' : 'scp-btn-secondary'}`}
                    onClick={() => handleSetLogLevel(lvl)}
                    style={{ textTransform: 'uppercase', fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                  >
                    Set {lvl}
                  </button>
                );
              })}
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
                color: 'var(--scp-terminal-text)',
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <PlusCircle size={13} />
              <span>Emit Test Log</span>
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() => setIsPaused(!isPaused)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={handleExportJson}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Download size={13} />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              onClick={clearEvents}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Trash2 size={13} />
              <span>Clear</span>
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
            <div style={{ color: 'var(--scp-text-muted)', textAlign: 'center', padding: '3rem 0', fontStyle: 'italic' }}>
              No log lines matching current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
