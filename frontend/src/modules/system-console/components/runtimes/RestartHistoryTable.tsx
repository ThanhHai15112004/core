import React from 'react';
import type { RestartHistoryItem } from '../../types/runtime.types';
import { formatDurationMs, NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

export const RestartHistoryTable: React.FC<{ history: RestartHistoryItem[] }> = ({ history }) => {
  const { t, formatTime } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.restartHistory.title')}</h3>
      </header>
      {history.length === 0 ? (
        <p className="ov-empty-line">{t('rt.restartHistory.empty')}</p>
      ) : (
        <div className="scp-table-wrap">
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('rt.restartHistory.time')}</th>
                <th>{t('rt.restartHistory.reason')}</th>
                <th>{t('rt.restartHistory.downtime')}</th>
                <th>{t('rt.restartHistory.exitCode')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.at}>
                  <td className="cell-muted">
                    {new Date(h.at).toLocaleDateString()} {formatTime(h.at)}
                  </td>
                  <td className={h.reasonCode === 'crash' || h.reasonCode === 'unexpected' ? 'rt-bad' : ''}>{h.reason}</td>
                  <td>{formatDurationMs(h.downtimeMs)}</td>
                  <td>{h.exitCode ?? NO_VALUE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
