import React from 'react';
import type { DbExplain } from '../../types/database.types';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Execution plan dạng cây; chỉ đánh dấu dữ kiện (full scan, nhiều dòng…) — không tự khuyến nghị tạo index. */
export const ExplainPlan: React.FC<{ explain: DbExplain | null }> = ({ explain }) => {
  const { t, locale } = useLocale();
  if (!explain) return <p className="ov-empty-line">{t('common.loading')}</p>;
  if (!explain.available || !explain.plan)
    return <p className="tr-note">{t(`db.explain.unavailable.${explain.reason === 'notExplainable' || explain.reason === 'unsupported' || explain.reason === 'disconnected' ? explain.reason : 'error'}`, { message: explain.reason ?? '' })}</p>;
  return (
    <>
      <p className="db-explain-cost">{t('db.explain.cost', { cost: explain.plan.totalCost ?? NO_VALUE })}</p>
      <ol className="db-explain">
        {explain.plan.steps.map((s, i) => (
          <li key={i} style={{ paddingLeft: `${s.depth * 18}px` }} className={s.flags.includes('full_scan') ? 'is-warn' : ''}>
            <span className="db-explain-op">
              <strong>{s.operation}</strong>
              {s.table && <code>{s.table}</code>}
              {s.flags.map((f) => (
                <span key={f} className="pf-chip ov-tone-warn">
                  {t(`db.explain.flag.${f}`)}
                </span>
              ))}
            </span>
            {s.table && (
              <span className="db-explain-meta">
                {t('db.explain.rows', { rows: formatCompact(s.rows, locale) })}
                {s.filteredPercent !== null && ` · ${t('db.explain.filtered', { percent: s.filteredPercent })}`}
                {` · ${t('db.explain.key', { key: s.key ?? t('db.explain.noKey') })}`}
                {s.possibleKeys.length > 0 && ` · ${t('db.explain.possible', { keys: s.possibleKeys.join(', ') })}`}
                {s.cost !== null && ` · ${t('db.explain.stepCost', { cost: s.cost })}`}
              </span>
            )}
            {s.condition && <code className="db-explain-cond">{s.condition}</code>}
          </li>
        ))}
      </ol>
      <p className="pf-chart-note">{t('db.explain.note')}</p>
    </>
  );
};
