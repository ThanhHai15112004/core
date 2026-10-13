import { Info } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { PanelState, QueryView } from '@core/ui/blocks';
import { databaseApi } from '../../services/database.api';
import { PLAN_INDENT_PX } from '../../constants/database';
import { dbKeys } from '../../sections/database/database-keys';

const KNOWN_REASONS = ['notExplainable', 'unsupported', 'disconnected'];

/** Execution plan dạng cây (EXPLAIN, không thực thi); chỉ đánh dấu dữ kiện (full scan, nhiều dòng…) — không tự khuyến nghị. */
export function ExplainPlan({ id }: { id: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(dbKeys.explain(id), () => databaseApi.explain(id), { tier: 'static', keepPrevious: false });
  return (
    <QueryView query={query}>
      {(explain) => {
        if (!explain.available || !explain.plan) {
          const reason = explain.reason && KNOWN_REASONS.includes(explain.reason) ? explain.reason : 'error';
          return <PanelState status="no-source" compact message={t(`db.explain.unavailable.${reason}`, { message: explain.reason ?? '' })} />;
        }
        return (
          <>
            <div className="mb-3 flex items-center gap-1.5 text-sm text-fg-2">
              {t('db.explain.cost', { cost: explain.plan.totalCost ?? NO_VALUE })}
            </div>
            <ol className="flex flex-col gap-1.5">
              {explain.plan.steps.map((s, i) => (
                <li
                  key={i}
                  style={{ marginLeft: s.depth * PLAN_INDENT_PX }}
                  className={`rounded-md border px-2.5 py-2 ${s.flags.includes('full_scan') ? 'border-warn-border bg-warn-bg' : 'border-border'}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-fg">{s.operation}</span>
                    {s.table && <span className="font-mono text-xs text-fg-2">{s.table}</span>}
                    {s.flags.map((flag) => (
                      <Badge key={flag} tone="warn" size="xs">
                        {t(`db.explain.flag.${flag}`)}
                      </Badge>
                    ))}
                  </div>
                  {s.table && (
                    <div className="mt-0.5 font-mono text-xs text-muted">
                      {t('db.explain.rows', { rows: f.compact(s.rows) })}
                      {s.filteredPercent !== null && ` · ${t('db.explain.filtered', { percent: s.filteredPercent })}`}
                      {` · ${t('db.explain.key', { key: s.key ?? t('db.explain.noKey') })}`}
                      {s.possibleKeys.length > 0 && ` · ${t('db.explain.possible', { keys: s.possibleKeys.join(', ') })}`}
                      {s.cost !== null && ` · ${t('db.explain.stepCost', { cost: s.cost })}`}
                    </div>
                  )}
                  {s.condition && <div className="mt-1 break-words font-mono text-xs text-code">{s.condition}</div>}
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t('db.explain.note')}
            </p>
          </>
        );
      }}
    </QueryView>
  );
}
