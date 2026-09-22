import React from 'react';
import { Terminal } from 'lucide-react';
import type { RuntimesOverview } from '../../types/runtime.types';
import { formatDurationMs } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** CLI là runtime chạy theo yêu cầu: hiển thị lịch sử thực thi thay vì uptime. */
export const CliRuntimePanel: React.FC<{ cli: RuntimesOverview['cli'] | null; now: number }> = ({ cli, now }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const last = cli?.lastExecution;

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>
          <Terminal size={16} /> {t('rt.cli.title')}
        </h3>
        <span className="ov-section-hint">{t('rt.cli.hint')}</span>
      </header>

      {!cli || !last ? (
        <p className="ov-empty-line">{t('rt.cli.empty')}</p>
      ) : (
        <>
          <dl className="rt-kv rt-kv-inline">
            <div>
              <dt>{t('rt.cli.lastExecuted')}</dt>
              <dd>{formatRelative(last.startedAt, now)}</dd>
            </div>
            <div>
              <dt>{t('rt.cli.command')}</dt>
              <dd>
                <code className="code-badge">{[last.command, ...last.args].join(' ')}</code>
              </dd>
            </div>
            <div>
              <dt>{t('rt.cli.duration')}</dt>
              <dd>{formatDurationMs(last.durationMs)}</dd>
            </div>
            <div>
              <dt>{t('rt.cli.result')}</dt>
              <dd className={last.result === 'success' ? 'rt-ok' : 'rt-bad'}>{t(`rt.cli.${last.result}`)}</dd>
            </div>
            <div>
              <dt>{t('rt.cli.today')}</dt>
              <dd>{cli.executionsToday}</dd>
            </div>
            <div>
              <dt>{t('rt.cli.failures')}</dt>
              <dd className={cli.failuresToday > 0 ? 'rt-bad' : ''}>{cli.failuresToday}</dd>
            </div>
          </dl>

          <details className="rt-cli-history">
            <summary>{t('rt.cli.history', { count: cli.recent.length })}</summary>
            <div className="scp-table-wrap">
              <table className="scp-table">
                <tbody>
                  {cli.recent.map((e) => (
                    <tr key={e.id}>
                      <td className="cell-muted">{formatTime(e.startedAt)}</td>
                      <td>
                        <code>{[e.command, ...e.args].join(' ')}</code>
                      </td>
                      <td>{formatDurationMs(e.durationMs)}</td>
                      <td className={e.result === 'success' ? 'rt-ok' : 'rt-bad'} title={e.error}>
                        {t(`rt.cli.${e.result}`)} ({e.exitCode})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
};
