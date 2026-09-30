import React from 'react';
import type { FailureGroup } from '../../types/jobs.types';
import type { Section } from '../../types/worker.types';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Failure Groups: gộp lỗi cùng loại — bấm → Explorer lọc đúng loại lỗi. */
export const FailureGroups: React.FC<{
  groups: Section<FailureGroup[]> | null;
  onOpen: (g: FailureGroup) => void;
  now: number;
  limit?: number;
  detailed?: boolean;
}> = ({ groups, onOpen, now, limit, detailed }) => {
  const { t, formatRelative } = useLocale();
  if (!groups) return <p className="ov-empty-line">…</p>;
  if (!groups.available)
    return (
      <p className="ov-empty-line">
        {t('jobs.unavailableSection', {
          reason: t(`jobs.reason.${groups.reason}`),
        })}
      </p>
    );
  const rows = limit ? groups.data.slice(0, limit) : groups.data;
  if (!rows.length) return <p className="ov-empty-line">{t('jobs.failures.noGroups')}</p>;
  const max = Math.max(...rows.map((g) => g.count));
  return (
    <div className="scp-table-wrap">
      <table className="scp-table job-groups">
        <thead>
          <tr>
            <th>{t('jobs.failures.col.error')}</th>
            <th>{t('jobs.failures.col.count')}</th>
            {detailed && <th>{t('jobs.failures.col.types')}</th>}
            <th>{t('jobs.failures.col.retry')}</th>
            {detailed && <th>{t('jobs.failures.col.last')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.errorType} className="is-clickable" onClick={() => onOpen(g)}>
              <td>
                <code>{g.errorType}</code>
                {g.dependency && <small className="pf-row-note">{t(`jobs.dependency.${g.dependency}`)}</small>}
              </td>
              <td className="job-bar-cell">
                <span className="job-bar" style={{ width: `${Math.max(4, (g.count / max) * 100)}%` }} />
                <span>{g.count}</span>
              </td>
              {detailed && <td>{g.types.join(', ')}</td>}
              <td>
                {g.retryable === false ? (
                  <span className="is-warn">{t('jobs.retryable.no')}</span>
                ) : g.retryable ? (
                  t('jobs.retryable.yes')
                ) : (
                  t('jobs.retryable.unknown')
                )}
              </td>
              {detailed && <td>{g.lastAt ? formatRelative(new Date(g.lastAt), now) : NO_VALUE}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
