import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { ComponentId, ComponentRow } from '../../types/performance.types';
import { COMPONENT_TONE } from '../../constants/performance';
import { formatUnit } from '../../utils/performance-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Hiệu năng theo thành phần: tải, latency, lỗi, trạng thái. Bấm để mở chi tiết. */
export const ComponentTable: React.FC<{ rows: ComponentRow[]; onOpen: (id: ComponentId) => void }> = ({ rows, onOpen }) => {
  const { t } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.components.title')}</h3>
        <span className="ov-section-hint">{t('perf.components.hint')}</span>
      </header>
      <div className="scp-table-wrap">
        <table className="scp-table pf-component-table">
          <thead>
            <tr>
              <th>{t('perf.components.component')}</th>
              <th>{t('perf.components.load')}</th>
              <th>{t('perf.components.latency')}</th>
              <th>{t('perf.components.errors')}</th>
              <th>{t('perf.components.status')}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="is-clickable" onClick={() => onOpen(r.id)}>
                <td>
                  <strong>{t(`perf.component.${r.id}`)}</strong>
                  {r.note && <small className="pf-row-note">{r.note}</small>}
                </td>
                <td>{formatUnit(r.load, r.loadUnit)}</td>
                <td>
                  {r.latencyMs === null ? NO_VALUE : formatUnit(r.latencyMs, 'ms')}
                  {r.latencyMs !== null && <small className="pf-row-note">{t(`perf.components.latencyKind.${r.latencyKind}`)}</small>}
                </td>
                <td>{formatUnit(r.errorPercent, '%')}</td>
                <td>
                  <span className={`pf-chip ov-tone-${COMPONENT_TONE[r.status]}`}>
                    <span className="ov-dot" aria-hidden="true" />
                    {t(`perf.componentStatus.${r.status}`)}
                  </span>
                </td>
                <td>
                  <button type="button" className="rt-icon-btn" aria-label={t('perf.components.open', { name: t(`perf.component.${r.id}`) })}>
                    <ChevronRight size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
