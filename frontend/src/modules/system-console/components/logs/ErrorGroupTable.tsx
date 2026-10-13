import React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react';
import type { ErrorGroupRow } from '../../types/logs.types';
import { MiniSpark } from './LogBits';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

export const TrendBadge: React.FC<{ g: ErrorGroupRow }> = ({ g }) => {
  const { t } = useLocale();
  if (g.trend === 'new' || g.isNew)
    return (
      <span className="pf-chip ov-tone-warn">
        <Sparkles size={11} /> {t('logs.trend.new')}
      </span>
    );
  const Icon = g.trend === 'up' ? ArrowUpRight : g.trend === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span className={`pf-chip ov-tone-${g.spiking || g.trend === 'up' ? 'crit' : g.trend === 'down' ? 'ok' : 'unknown'}`}>
      <Icon size={11} /> {g.changePercent !== null && g.trend !== 'flat' ? `${g.changePercent > 0 ? '+' : ''}${g.changePercent}%` : t(`logs.trend.${g.trend}`)}
      {g.spiking && ` · ${t('logs.trend.spike')}`}
    </span>
  );
};

/** Error Groups: gom 10.000 log cùng lỗi thành một dòng — số lần, lần cuối, xu hướng, runtime / job bị ảnh hưởng. */
export const ErrorGroupTable: React.FC<{ rows: ErrorGroupRow[]; onOpen: (fp: string) => void; now: number; compact?: boolean }> = ({
  rows,
  onOpen,
  now,
  compact = false,
}) => {
  const { t, formatRelative, locale } = useLocale();
  return (
    <div className="scp-table-wrap">
      <table className="scp-table lg-groups">
        <thead>
          <tr>
            <th>{t('logs.groups.error')}</th>
            <th className="num">{t('logs.groups.count')}</th>
            <th>{t('logs.groups.lastSeen')}</th>
            <th>{t('logs.groups.trend')}</th>
            {!compact && <th>{t('logs.groups.affected')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr
              key={g.fingerprint}
              className="lg-row"
              onClick={() => onOpen(g.fingerprint)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(g.fingerprint)}
            >
              <td className="lg-group-cell">
                <strong>{g.errorType ?? t('logs.groups.untyped')}</strong>
                <span className="lg-group-template">{g.template}</span>
                {g.module && (
                  <small className="pf-row-note">
                    {g.module}
                    {g.frame ? ` · ${g.frame}` : ''}
                  </small>
                )}
              </td>
              <td className="num">
                <strong>{formatCompact(g.count, locale)}</strong>
                {g.total > g.count && <small className="pf-row-note">{t('logs.groups.total', { count: formatCompact(g.total, locale) })}</small>}
              </td>
              <td>
                {g.lastSeen ? formatRelative(g.lastSeen, now) : '—'}
                {g.firstSeen && <small className="pf-row-note">{t('logs.groups.firstSeen', { when: formatRelative(g.firstSeen, now) })}</small>}
              </td>
              <td>
                <TrendBadge g={g} />
                {!compact && <MiniSpark values={g.spark} />}
              </td>
              {!compact && (
                <td className="lg-affected">
                  {[...g.runtimes, ...g.jobTypes.slice(0, 2), ...g.routes.slice(0, 1)].map((x) => (
                    <span key={x} className="lg-tag">
                      {x}
                    </span>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
