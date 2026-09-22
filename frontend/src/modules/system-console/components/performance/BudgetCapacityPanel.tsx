import React from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { Budget, Capacity } from '../../types/performance.types';
import { formatUnit } from '../../utils/performance-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Mục tiêu hiệu năng (✓/✕ so với target cấu hình) và mức sử dụng tài nguyên có giới hạn thật. */
export const BudgetCapacityPanel: React.FC<{ budgets: Budget[]; capacity: Capacity[] }> = ({ budgets, capacity }) => {
  const { t } = useLocale();
  return (
    <div className="ov-split">
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('perf.budgets.title')}</h3>
          <span className="ov-section-hint">{t('perf.budgets.hint')}</span>
        </header>
        <ul className="pf-budgets">
          {budgets.map((b) => (
            <li key={b.key} className={b.met === null ? 'is-unknown' : b.met ? 'is-met' : 'is-exceeded'}>
              <span className="pf-budget-icon" aria-hidden="true">
                {b.met === null ? <Minus size={14} /> : b.met ? <Check size={14} /> : <X size={14} />}
              </span>
              <span className="pf-budget-label">
                {t(`perf.budgets.${b.key}`)}
                <small>{t('perf.budgets.target', { value: formatUnit(b.target, b.unit) })}</small>
              </span>
              <strong>{formatUnit(b.current, b.unit)}</strong>
              <span className="pf-budget-verdict">
                {b.met === null ? t('perf.budgets.noData') : b.met ? t('perf.budgets.met') : t('perf.budgets.exceeded')}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('perf.capacity.title')}</h3>
          <span className="ov-section-hint">{t('perf.capacity.hint')}</span>
        </header>
        <ul className="pf-capacity">
          {capacity.map((c) => (
            <li key={c.key}>
              <span className="rt-resource-label">
                <span>
                  {t(`perf.capacity.${c.key}`)}
                  {c.runtime && c.key === 'memory' && ` (${t(`rt.name.${c.runtime}`)})`}
                </span>
                <b>
                  {c.percent === null
                    ? t('perf.capacity.unavailable')
                    : c.unit === '%'
                      ? formatUnit(c.percent, '%')
                      : `${c.unit === 'MB' ? formatUnit(c.used, 'MB') : (c.used ?? NO_VALUE)} / ${c.unit === 'MB' ? formatUnit(c.limit, 'MB') : (c.limit ?? NO_VALUE)} · ${formatUnit(c.percent, '%')}`}
                </b>
              </span>
              <span className={`rt-bar ${c.percent === null ? 'is-empty' : c.percent >= 80 ? 'is-high' : ''}`}>
                {c.percent !== null && <span style={{ width: `${Math.min(100, c.percent)}%` }} />}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
