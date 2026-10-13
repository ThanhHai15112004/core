import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { changePercent, formatDelta, NO_VALUE } from '../../lib/format';

export interface ComparisonRow {
  id: string;
  label: string;
  current: number | null;
  previous: number | null;
  format: (v: number | null) => string;
  /** Tăng là xấu (lỗi, độ trễ) → tăng tô đỏ. `null` = trung tính. */
  higherIsWorse?: boolean | null;
}

/** So sánh kỳ này / kỳ trước (mặc định hôm nay / hôm qua) với % thay đổi. */
export function ComparisonTable({ rows, labels, className }: { rows: ComparisonRow[]; labels?: { current?: string; previous?: string }; className?: string }) {
  const { t } = useLocale();
  return (
    <table className={cn('w-full text-sm', className)}>
      <thead>
        <tr className="border-b border-border text-xs text-muted">
          <th className="py-1.5 text-left font-medium">{t('ui.compare.metric')}</th>
          <th className="py-1.5 text-right font-medium">{labels?.current ?? t('ui.compare.current')}</th>
          <th className="py-1.5 text-right font-medium">{labels?.previous ?? t('ui.compare.previous')}</th>
          <th className="py-1.5 text-right font-medium">{t('ui.compare.change')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const change = changePercent(r.current, r.previous);
          const text = formatDelta(change);
          const worse = change !== null && r.higherIsWorse !== null && r.higherIsWorse !== undefined && change !== 0 ? (change > 0) === r.higherIsWorse : null;
          return (
            <tr key={r.id} className="border-b border-border last:border-b-0">
              <td className="py-1.5 text-fg-2">{r.label}</td>
              <td className="py-1.5 text-right font-mono text-xs tabular-nums text-fg">{r.format(r.current)}</td>
              <td className="py-1.5 text-right font-mono text-xs tabular-nums text-muted">{r.format(r.previous)}</td>
              <td className={cn('py-1.5 text-right font-mono text-xs tabular-nums', worse === null ? 'text-muted' : worse ? 'text-crit-fg' : 'text-ok-fg')}>{text ?? NO_VALUE}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
