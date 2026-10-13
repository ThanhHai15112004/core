import React from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import type { LogRow } from '../../types/logs.types';
import { LevelChip } from './LogBits';
import { contextOf, logTime, shortId } from '../../utils/logs-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Bảng log: Time · Level · Source · Context · Message (không 15 cột một lúc) — metadata / stack xem khi bấm vào dòng.
 */
export const LogTable: React.FC<{
  rows: LogRow[];
  onOpen: (id: string) => void;
  selectedId?: string | null;
  /** ID dòng mới (live) để tô nhẹ. */
  freshIds?: Set<string>;
  compact?: boolean;
}> = ({ rows, onOpen, selectedId, freshIds, compact = false }) => {
  const { t } = useLocale();
  return (
    <div className="scp-table-wrap lg-table-wrap">
      <table className={`scp-table lg-table ${compact ? 'lg-table-compact' : ''}`}>
        <thead>
          <tr>
            <th className="lg-col-time">{t('logs.col.time')}</th>
            <th className="lg-col-level">{t('logs.col.level')}</th>
            <th className="lg-col-source">{t('logs.col.source')}</th>
            <th className="lg-col-context">{t('logs.col.context')}</th>
            <th>{t('logs.col.message')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ctx = contextOf(r);
            return (
              <tr
                key={r.id}
                className={`lg-row lg-row-${r.level} ${selectedId === r.id ? 'is-selected' : ''} ${freshIds?.has(r.id) ? 'is-fresh' : ''}`}
                onClick={() => onOpen(r.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
              >
                <td className="lg-col-time">
                  <time dateTime={r.at}>{logTime(r.at)}</time>
                </td>
                <td className="lg-col-level">
                  <LevelChip level={r.level} />
                </td>
                <td className="lg-col-source">{r.runtime ?? '—'}</td>
                <td className="lg-col-context">
                  {ctx ? (
                    <code title={`${t(`logs.ctx.${ctx.kind}`)} ${ctx.id}`}>
                      {/^[a-z]{2,8}_/i.test(ctx.id) ? '' : t(`logs.ctxShort.${ctx.kind}`)}
                      {shortId(ctx.id)}
                    </code>
                  ) : (
                    <span className="ov-muted">—</span>
                  )}
                </td>
                <td className="lg-col-message">
                  {r.module && <span className="lg-module">[{r.module}]</span>}
                  <span className="lg-message">{r.message}</span>
                  {r.errorType && <span className="lg-tag lg-tag-err">{r.errorType}</span>}
                  {r.hasStack && <AlertTriangle size={12} className="lg-icon" aria-label={t('logs.detail.stack')} />}
                  {r.hasMetadata && <Layers size={12} className="lg-icon" aria-label={t('logs.detail.metadata')} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
